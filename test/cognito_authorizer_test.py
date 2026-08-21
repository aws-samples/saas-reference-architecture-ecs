import importlib.util
import json
import sys
import types
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
LAYERS_DIR = REPO_ROOT / 'server/lib/shared-infra/layers'
MODULE_PATH = LAYERS_DIR / 'cognito/cognito_authorizer.py'
sys.path.insert(0, str(LAYERS_DIR))


class _Logger:
    def info(self, *args, **kwargs):
        pass


powertools = types.ModuleType('aws_lambda_powertools')
powertools.Logger = _Logger
sys.modules['aws_lambda_powertools'] = powertools

jose = types.ModuleType('jose')
jose.jwk = types.SimpleNamespace(construct=lambda key, algorithm=None: key)
jose.jwt = types.SimpleNamespace()
sys.modules['jose'] = jose

spec = importlib.util.spec_from_file_location('tested_cognito_authorizer', MODULE_PATH)
authorizer_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(authorizer_module)


class FakeJwt:
    def __init__(
        self,
        payload,
        headers=None,
        verified_claims=None,
        decode_error=None,
    ):
        self.payload = payload
        self.headers = headers or {'alg': 'RS256', 'kid': 'trusted-key'}
        self.verified_claims = verified_claims or payload
        self.decode_error = decode_error
        self.decode_calls = []

    def get_unverified_claims(self, token):
        return self.payload

    def get_unverified_headers(self, token):
        return self.headers

    def decode(self, token, key, **kwargs):
        self.decode_calls.append(kwargs)
        if self.decode_error is not None:
            raise self.decode_error
        return self.verified_claims


class FakeCognito:
    def __init__(
        self,
        pool_id,
        client_id,
        tags=None,
        write_attributes=None,
        fail_pool=False,
        fail_client=False,
    ):
        self.pool_id = pool_id
        self.client_id = client_id
        self.tags = tags or {'SaaSFactory': 'ECS-SaaS-Ref'}
        self.write_attributes = ['email'] if write_attributes is None else write_attributes
        self.fail_pool = fail_pool
        self.fail_client = fail_client
        self.pool_calls = []
        self.client_calls = []

    def describe_user_pool(self, **kwargs):
        self.pool_calls.append(kwargs)
        if self.fail_pool:
            raise RuntimeError('pool is not in this AWS account')
        return {
            'UserPool': {
                'Id': self.pool_id,
                'UserPoolTags': self.tags,
            }
        }

    def describe_user_pool_client(self, **kwargs):
        self.client_calls.append(kwargs)
        if self.fail_client:
            raise RuntimeError('client is not in this pool')
        return {
            'UserPoolClient': {
                'UserPoolId': self.pool_id,
                'ClientId': self.client_id,
                'WriteAttributes': self.write_attributes,
            }
        }


class FakeRegistry:
    def __init__(self, tenant_id, tenant_tier, pool_id, client_id):
        self.item = {
            'tenantId': {'S': tenant_id},
            'tenantTier': {'S': tenant_tier},
            'userPoolId': {'S': pool_id},
            'appClientId': {'S': client_id},
            'tokensValidAfter': {'N': '1000'},
        }
        self.calls = []

    def get_item(self, **kwargs):
        self.calls.append(kwargs)
        return {'Item': self.item}


class FakeResponse:
    def __init__(self, body):
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def read(self, size=-1):
        return self.body[:size]


class CognitoAuthorizerTest(unittest.TestCase):
    region = 'us-east-1'
    pool_id = 'us-east-1_Trusted123'
    client_id = 'trusted-client-id'

    def setUp(self):
        authorizer_module._trust_cache.clear()
        authorizer_module._jwks_cache.clear()
        self.issuer = 'https://cognito-idp.us-east-1.amazonaws.com/{}'.format(
            self.pool_id)
        self.payload = {
            'iss': self.issuer,
            'aud': self.client_id,
            'token_use': 'id',
            'auth_time': 2000,
            'sub': 'subject-1',
            'cognito:username': 'user@example.com',
            'cognito:groups': ['tenant-1'],
            'custom:tenantId': 'tenant-1',
            'custom:userRole': 'TenantUser',
            'custom:tenantTier': 'Basic',
        }
        self.registry = FakeRegistry(
            'tenant-1', 'Basic', self.pool_id, self.client_id)
        self.jwks = json.dumps({
            'keys': [{
                'kid': 'trusted-key',
                'alg': 'RS256',
                'kty': 'RSA',
                'use': 'sig',
            }]
        }).encode('utf-8')
        self.urlopen_calls = []

    def make_authorizer(
        self, jwt_impl=None, cognito=None, registry=None, jwks=None
    ):
        authorizer_module.jwt = jwt_impl or FakeJwt(self.payload)
        authorizer_module.jwk = types.SimpleNamespace(
            construct=lambda key, algorithm=None: key)
        cognito = cognito or FakeCognito(self.pool_id, self.client_id)
        body = self.jwks if jwks is None else jwks

        def urlopen(url, timeout):
            self.urlopen_calls.append((url, timeout))
            return FakeResponse(body)

        instance = authorizer_module.CognitoAuthorizer(
            cognito_client=cognito,
            registry_client=registry or self.registry,
            registry_table_name='trusted-tenant-registry',
            urlopen=urlopen,
            region_name=self.region,
        )
        return instance, authorizer_module.jwt, cognito

    def event(self):
        return {
            'jwtToken': 'encoded-token',
            'idpDetails': {
                'trustedPoolTag': {
                    'key': 'SaaSFactory',
                    'value': 'ECS-SaaS-Ref',
                }
            },
        }

    def test_accepts_id_token_from_tagged_pool_and_client_in_account(self):
        instance, jwt_impl, cognito = self.make_authorizer()

        result = instance.validateJWT(self.event())

        self.assertEqual(self.payload, result)
        self.assertEqual([{'UserPoolId': self.pool_id}], cognito.pool_calls)
        self.assertEqual([{
            'UserPoolId': self.pool_id,
            'ClientId': self.client_id,
        }], cognito.client_calls)
        self.assertEqual(1, len(self.urlopen_calls))
        self.assertEqual([{
            'TableName': 'trusted-tenant-registry',
            'Key': {'tenantId': {'S': 'tenant-1'}},
            'ConsistentRead': True,
        }], self.registry.calls)
        self.assertEqual(self.issuer, jwt_impl.decode_calls[0]['issuer'])
        self.assertEqual(self.client_id, jwt_impl.decode_calls[0]['audience'])
        self.assertEqual(['RS256'], jwt_impl.decode_calls[0]['algorithms'])

    def test_caches_trusted_pool_client_and_jwks_within_ttl(self):
        instance, _, cognito = self.make_authorizer()

        self.assertNotEqual(False, instance.validateJWT(self.event()))
        self.assertNotEqual(False, instance.validateJWT(self.event()))

        self.assertEqual(1, len(cognito.pool_calls))
        self.assertEqual(1, len(cognito.client_calls))
        self.assertEqual(1, len(self.registry.calls))
        self.assertEqual(1, len(self.urlopen_calls))

    def test_rejects_unregistered_same_account_tagged_pool(self):
        attacker_pool_id = 'us-east-1_OtherTrusted'
        attacker_issuer = (
            'https://cognito-idp.us-east-1.amazonaws.com/' + attacker_pool_id
        )
        jwt_impl = FakeJwt(dict(self.payload, iss=attacker_issuer))
        cognito = FakeCognito(attacker_pool_id, self.client_id)
        instance, _, _ = self.make_authorizer(
            jwt_impl=jwt_impl, cognito=cognito)

        self.assertFalse(instance.validateJWT(self.event()))
        self.assertEqual([], cognito.pool_calls)
        self.assertEqual([], self.urlopen_calls)

    def test_rejects_unregistered_second_client_in_trusted_pool(self):
        second_client_id = 'second-valid-client'
        jwt_impl = FakeJwt(dict(self.payload, aud=second_client_id))
        cognito = FakeCognito(self.pool_id, second_client_id)
        instance, _, _ = self.make_authorizer(
            jwt_impl=jwt_impl, cognito=cognito)

        self.assertFalse(instance.validateJWT(self.event()))
        self.assertEqual([], cognito.pool_calls)
        self.assertEqual([], self.urlopen_calls)

    def test_rejects_registered_client_with_writable_authorization_claims(self):
        cognito = FakeCognito(
            self.pool_id,
            self.client_id,
            write_attributes=['email', 'custom:userRole'],
        )
        instance, _, _ = self.make_authorizer(cognito=cognito)

        self.assertFalse(instance.validateJWT(self.event()))
        self.assertEqual([], self.urlopen_calls)

    def test_unknown_kid_forces_one_jwks_refresh(self):
        authorizer_module._put_cached(
            authorizer_module._jwks_cache,
            self.issuer,
            [{
                'kid': 'rotated-out-key',
                'alg': 'RS256',
                'kty': 'RSA',
                'use': 'sig',
            }],
            authorizer_module.JWKS_CACHE_TTL_SECONDS,
        )
        instance, _, _ = self.make_authorizer()

        self.assertNotEqual(False, instance.validateJWT(self.event()))
        self.assertEqual(1, len(self.urlopen_calls))

    def test_caches_are_bounded(self):
        for index in range(authorizer_module.MAX_CACHE_ENTRIES + 5):
            authorizer_module._put_cached(
                authorizer_module._trust_cache,
                ('pool', index),
                True,
                authorizer_module.TRUST_CACHE_TTL_SECONDS,
            )

        self.assertEqual(
            authorizer_module.MAX_CACHE_ENTRIES,
            len(authorizer_module._trust_cache),
        )

    def test_jwks_timeout_fails_closed(self):
        instance, _, _ = self.make_authorizer()

        def timeout(*args, **kwargs):
            raise TimeoutError('JWKS request timed out')

        instance._urlopen = timeout
        self.assertFalse(instance.validateJWT(self.event()))

    def test_rejects_attacker_account_pool_before_fetching_jwks(self):
        cognito = FakeCognito(
            self.pool_id, self.client_id, fail_pool=True)
        instance, _, _ = self.make_authorizer(cognito=cognito)

        self.assertFalse(instance.validateJWT(self.event()))
        self.assertEqual([], self.urlopen_calls)
        self.assertEqual([], cognito.client_calls)

    def test_rejects_pool_without_expected_deployment_tag(self):
        cognito = FakeCognito(
            self.pool_id,
            self.client_id,
            tags={'SaaSFactory': 'Other'},
        )
        instance, _, _ = self.make_authorizer(cognito=cognito)

        self.assertFalse(instance.validateJWT(self.event()))
        self.assertEqual([], self.urlopen_calls)
        self.assertEqual([], cognito.client_calls)

    def test_rejects_audience_that_is_not_a_client_of_the_pool(self):
        cognito = FakeCognito(
            self.pool_id, self.client_id, fail_client=True)
        instance, _, _ = self.make_authorizer(cognito=cognito)

        self.assertFalse(instance.validateJWT(self.event()))
        self.assertEqual([], self.urlopen_calls)

    def test_rejects_access_token_before_account_lookup(self):
        payload = dict(self.payload, token_use='access')
        jwt_impl = FakeJwt(payload)
        instance, _, cognito = self.make_authorizer(jwt_impl=jwt_impl)

        self.assertFalse(instance.validateJWT(self.event()))
        self.assertEqual([], cognito.pool_calls)
        self.assertEqual([], self.urlopen_calls)

    def test_rejects_issuer_from_another_region(self):
        payload = dict(
            self.payload,
            iss='https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_Attacker',
        )
        jwt_impl = FakeJwt(payload)
        instance, _, cognito = self.make_authorizer(jwt_impl=jwt_impl)

        self.assertFalse(instance.validateJWT(self.event()))
        self.assertEqual([], cognito.pool_calls)
        self.assertEqual([], self.urlopen_calls)

    def test_rejects_tenant_claim_not_backed_by_cognito_group(self):
        verified = dict(self.payload, **{'cognito:groups': ['tenant-2']})
        jwt_impl = FakeJwt(self.payload, verified_claims=verified)
        instance, _, _ = self.make_authorizer(jwt_impl=jwt_impl)

        self.assertFalse(instance.validateJWT(self.event()))

    def test_rejects_token_issued_before_registry_security_cutoff(self):
        verified = dict(self.payload, auth_time=999)
        jwt_impl = FakeJwt(self.payload, verified_claims=verified)
        instance, _, _ = self.make_authorizer(jwt_impl=jwt_impl)

        self.assertFalse(instance.validateJWT(self.event()))

    def test_rejects_tampered_signature_or_invalid_verified_claims(self):
        jwt_impl = FakeJwt(
            self.payload,
            decode_error=RuntimeError('signature verification failed'),
        )
        instance, _, _ = self.make_authorizer(jwt_impl=jwt_impl)

        self.assertFalse(instance.validateJWT(self.event()))

    def test_rejects_non_rs256_algorithm_before_account_lookup(self):
        jwt_impl = FakeJwt(self.payload, headers={'alg': 'HS256', 'kid': 'key'})
        instance, _, cognito = self.make_authorizer(jwt_impl=jwt_impl)

        self.assertFalse(instance.validateJWT(self.event()))
        self.assertEqual([], cognito.pool_calls)
        self.assertEqual([], self.urlopen_calls)


if __name__ == '__main__':
    unittest.main()
