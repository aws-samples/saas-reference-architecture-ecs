from abstract_classes.idp_authorizer_abstract_class import IdpAuthorizerAbstractClass
import json
import os
import re
import time
import urllib.request

import boto3
from jose import jwk, jwt
from aws_lambda_powertools import Logger

logger = Logger()

TRUSTED_POOL_TAG_KEY = 'SaaSFactory'
TRUSTED_POOL_TAG_VALUE = 'ECS-SaaS-Ref'
MAX_JWKS_BYTES = 64 * 1024
JWKS_TIMEOUT_SECONDS = 3
TRUST_CACHE_TTL_SECONDS = 300
JWKS_CACHE_TTL_SECONDS = 3600
MAX_CACHE_ENTRIES = 128

_trust_cache = {}
_jwks_cache = {}


def _get_cached(cache, key):
    cached = cache.get(key)
    if cached is None:
        return None
    expires_at, value = cached
    if expires_at <= time.monotonic():
        cache.pop(key, None)
        return None
    return value


def _put_cached(cache, key, value, ttl_seconds):
    if key not in cache and len(cache) >= MAX_CACHE_ENTRIES:
        oldest_key = min(cache, key=lambda item: cache[item][0])
        cache.pop(oldest_key, None)
    cache[key] = (time.monotonic() + ttl_seconds, value)


class CognitoAuthorizer(IdpAuthorizerAbstractClass):
    """Validate ID tokens only from Cognito pools owned by this deployment."""

    def __init__(
        self,
        cognito_client=None,
        registry_client=None,
        registry_table_name=None,
        urlopen=None,
        region_name=None,
    ):
        self._region = (
            region_name
            or os.environ.get('AWS_REGION')
            or boto3.session.Session().region_name
        )
        if not self._region:
            raise ValueError('AWS region is required for Cognito validation')
        self._cognito = cognito_client or boto3.client(
            'cognito-idp', region_name=self._region)
        self._registry = registry_client or boto3.client(
            'dynamodb', region_name=self._region)
        self._registry_table = (
            registry_table_name
            or os.environ.get('TRUSTED_TENANT_REGISTRY_TABLE')
        )
        if not self._registry_table:
            raise ValueError('Trusted tenant registry table is required')
        self._urlopen = urlopen or urllib.request.urlopen

    def validateJWT(self, event):
        """Fail closed unless token trust and all JWT claims are verified."""
        try:
            token = event['jwtToken']
            idp_details = event.get('idpDetails') or {}
            trusted_tag = idp_details.get('trustedPoolTag') or {}
            tag_key = trusted_tag.get('key', TRUSTED_POOL_TAG_KEY)
            tag_value = trusted_tag.get('value', TRUSTED_POOL_TAG_VALUE)

            payload = jwt.get_unverified_claims(token)
            headers = jwt.get_unverified_headers(token)
            issuer = payload.get('iss')
            audience = payload.get('aud')
            tenant_id = payload.get('custom:tenantId')
            tenant_tier = payload.get('custom:tenantTier')

            if headers.get('alg') != 'RS256' or not headers.get('kid'):
                return False
            if payload.get('token_use') != 'id':
                return False
            if not all(isinstance(value, str) and value for value in (
                issuer, audience, tenant_id, tenant_tier
            )):
                return False

            expected_prefix = 'https://cognito-idp.{}.amazonaws.com/'.format(
                self._region)
            if not issuer.startswith(expected_prefix):
                return False

            user_pool_id = issuer[len(expected_prefix):]
            expected_pool_prefix = '{}_'.format(self._region)
            if (
                not user_pool_id.startswith(expected_pool_prefix)
                or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', user_pool_id)
            ):
                return False

            # These account-scoped Cognito calls are the trust boundary. A pool
            # from an attacker's AWS account is not visible to this Lambda role.
            tokens_valid_after = self._is_trusted_pool_and_client(
                tenant_id,
                tenant_tier,
                user_pool_id,
                audience,
                tag_key,
                tag_value,
            )
            if tokens_valid_after is None:
                return False

            keys = self._load_jwks(issuer)
            if not self._has_signing_key(keys, headers['kid']):
                # Cognito can rotate signing keys. Refresh once on an unknown kid.
                keys = self._load_jwks(issuer, force_refresh=True)
            return self._validate_cognito_jwt(
                token,
                issuer,
                audience,
                headers['kid'],
                keys,
                tokens_valid_after,
            )
        except Exception as error:
            # Do not log tokens, claims, issuer values, or remote error text.
            logger.info(
                'JWT validation failed ({})'.format(type(error).__name__))
            return False

    def _is_trusted_pool_and_client(
        self,
        tenant_id,
        tenant_tier,
        user_pool_id,
        audience,
        tag_key,
        tag_value,
    ):
        cache_key = (
            tenant_id,
            tenant_tier,
            user_pool_id,
            audience,
            tag_key,
            tag_value,
        )
        cached_trust = _get_cached(_trust_cache, cache_key)
        if cached_trust is not None:
            return cached_trust

        registry_response = self._registry.get_item(
            TableName=self._registry_table,
            Key={'tenantId': {'S': tenant_id}},
            ConsistentRead=True,
        )
        registry_item = registry_response.get('Item') or {}
        expected_values = {
            'tenantId': tenant_id,
            'tenantTier': tenant_tier,
            'userPoolId': user_pool_id,
            'appClientId': audience,
        }
        if any(
            (registry_item.get(name) or {}).get('S') != expected
            for name, expected in expected_values.items()
        ):
            return None

        try:
            tokens_valid_after = int(
                (registry_item.get('tokensValidAfter') or {})['N'])
        except (KeyError, TypeError, ValueError):
            return None

        pool_response = self._cognito.describe_user_pool(
            UserPoolId=user_pool_id)
        pool = pool_response.get('UserPool') or {}
        if pool.get('Id') != user_pool_id:
            return None
        if (pool.get('UserPoolTags') or {}).get(tag_key) != tag_value:
            return None

        client_response = self._cognito.describe_user_pool_client(
            UserPoolId=user_pool_id,
            ClientId=audience,
        )
        client = client_response.get('UserPoolClient') or {}
        if (
            client.get('UserPoolId') != user_pool_id
            or client.get('ClientId') != audience
        ):
            return None

        forbidden_write_attributes = {
            'custom:tenantId',
            'custom:userRole',
            'custom:tenantTier',
        }
        write_attributes = client.get('WriteAttributes') or []
        if forbidden_write_attributes.intersection(write_attributes):
            return None

        _put_cached(
            _trust_cache,
            cache_key,
            tokens_valid_after,
            TRUST_CACHE_TTL_SECONDS,
        )
        return tokens_valid_after

    @staticmethod
    def _has_signing_key(keys, kid):
        return any(
            key.get('kid') == kid
            and key.get('alg') == 'RS256'
            and key.get('kty') == 'RSA'
            and key.get('use') == 'sig'
            for key in keys
        )

    def _load_jwks(self, issuer, force_refresh=False):
        if not force_refresh:
            cached = _get_cached(_jwks_cache, issuer)
            if cached is not None:
                return cached

        keys_url = '{}/.well-known/jwks.json'.format(issuer)
        with self._urlopen(keys_url, timeout=JWKS_TIMEOUT_SECONDS) as response:
            body = response.read(MAX_JWKS_BYTES + 1)
        if len(body) > MAX_JWKS_BYTES:
            raise ValueError('JWKS response exceeds maximum size')
        keys = json.loads(body.decode('utf-8')).get('keys')
        if not isinstance(keys, list):
            raise ValueError('JWKS response has no keys array')
        _put_cached(_jwks_cache, issuer, keys, JWKS_CACHE_TTL_SECONDS)
        return keys

    def _validate_cognito_jwt(
        self, token, issuer, audience, kid, keys, tokens_valid_after
    ):
        signing_key = next(
            (
                key for key in keys
                if key.get('kid') == kid
                and key.get('alg') == 'RS256'
                and key.get('kty') == 'RSA'
                and key.get('use') == 'sig'
            ),
            None,
        )
        if signing_key is None:
            return False

        public_key = jwk.construct(signing_key, algorithm='RS256')
        claims = jwt.decode(
            token,
            public_key,
            algorithms=['RS256'],
            audience=audience,
            issuer=issuer,
            options={'verify_at_hash': False},
        )

        if claims.get('token_use') != 'id':
            return False
        auth_time = claims.get('auth_time')
        if (
            not isinstance(auth_time, (int, float))
            or auth_time < tokens_valid_after
        ):
            return False

        required_claims = (
            'sub',
            'cognito:username',
            'custom:tenantId',
            'custom:userRole',
            'custom:tenantTier',
        )
        if any(not isinstance(claims.get(name), str) for name in required_claims):
            return False

        # Cognito group membership is server-managed and signed. Binding it to
        # custom:tenantId prevents a user from selecting another tenant merely
        # by changing a custom attribute in a shared Basic-tier user pool.
        groups = claims.get('cognito:groups')
        if not isinstance(groups, list) or claims['custom:tenantId'] not in groups:
            return False

        return claims
