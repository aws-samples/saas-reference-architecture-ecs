import importlib.util
import json
import os
import sys
import types
import unittest
from enum import Enum
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
RESOURCES_DIR = REPO_ROOT / 'server/lib/shared-infra/Resources'
MODULE_PATH = RESOURCES_DIR / 'tenant_authorizer.py'
sys.path.insert(0, str(RESOURCES_DIR))

os.environ['AWS_REGION'] = 'us-east-1'
os.environ['IDP_DETAILS'] = json.dumps({
    'name': 'Cognito',
    'trustedPoolTag': {
        'key': 'SaaSFactory',
        'value': 'ECS-SaaS-Ref',
    },
})
os.environ['BASIC_TIER_API_KEY'] = 'basic-key-id'
os.environ['ADVANCED_TIER_API_KEY'] = 'advanced-key-id'
os.environ['PREMIUM_TIER_API_KEY'] = 'premium-key-id'


class FakeApiGateway:
    def get_api_key(self, **kwargs):
        return {'value': 'api-key-value'}


boto3_calls = []
fake_boto3 = types.ModuleType('boto3')


def client(service, region_name=None):
    boto3_calls.append((service, region_name))
    if service != 'apigateway':
        raise AssertionError('unexpected boto3 client: {}'.format(service))
    return FakeApiGateway()


fake_boto3.client = client
sys.modules['boto3'] = fake_boto3

fake_logger = types.ModuleType('logger')
fake_logger.info = lambda *args, **kwargs: None
fake_logger.error = lambda *args, **kwargs: None
sys.modules['logger'] = fake_logger


class UserRoles:
    SYSTEM_ADMIN = 'SystemAdmin'
    CUSTOMER_SUPPORT = 'CustomerSupport'
    TENANT_ADMIN = 'TenantAdmin'
    TENANT_USER = 'TenantUser'


fake_auth_manager = types.ModuleType('auth_manager')
fake_auth_manager.UserRoles = UserRoles
fake_auth_manager.isTenantUser = lambda role: role == UserRoles.TENANT_USER
sys.modules['auth_manager'] = fake_auth_manager


class TenantTier(Enum):
    BASIC = 'Basic'
    ADVANCED = 'Advanced'
    PREMIUM = 'Premium'


fake_utils = types.ModuleType('utils')
fake_utils.TenantTier = TenantTier
sys.modules['utils'] = fake_utils


class FakeIdpAuthorizer:
    response = None

    def validateJWT(self, event):
        return self.response


fake_idp_authorizer = FakeIdpAuthorizer()
fake_factory = types.ModuleType('idp_object_factory')
fake_factory.get_idp_authorizer_object = lambda name: fake_idp_authorizer
sys.modules['idp_object_factory'] = fake_factory

spec = importlib.util.spec_from_file_location('tested_tenant_authorizer', MODULE_PATH)
tenant_authorizer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tenant_authorizer)


class TenantAuthorizerTest(unittest.TestCase):
    def setUp(self):
        tenant_authorizer.api_key_cache.clear()
        fake_idp_authorizer.response = {
            'sub': 'subject-1',
            'cognito:username': 'user@example.com',
            'custom:tenantId': 'tenant-1',
            'custom:userRole': 'TenantUser',
            'custom:tenantTier': 'Basic',
        }

    def event(self):
        return {
            'headers': {'Authorization': 'Bearer encoded-token'},
            'queryStringParameters': None,
            'methodArn': (
                'arn:aws:execute-api:us-east-1:111122223333:'
                'api-id/prod/GET/orders'
            ),
        }

    def test_returns_minimal_context_without_aws_credentials(self):
        result = tenant_authorizer.lambda_handler(self.event(), None)

        self.assertEqual({
            'userName': 'user@example.com',
            'tenantPath': 'basic',
            'userRole': 'TenantUser',
        }, result['context'])
        self.assertEqual('api-key-value', result['usageIdentifierKey'])
        self.assertNotIn('accesskey', result['context'])
        self.assertNotIn('secretkey', result['context'])
        self.assertNotIn('sessiontoken', result['context'])
        self.assertEqual([('apigateway', 'us-east-1')], boto3_calls)

    def test_rejects_provider_role_from_tenant_pool(self):
        fake_idp_authorizer.response['custom:userRole'] = 'SystemAdmin'

        with self.assertRaisesRegex(Exception, 'Unauthorized'):
            tenant_authorizer.lambda_handler(self.event(), None)

    def test_rejects_unknown_role_in_verified_token(self):
        fake_idp_authorizer.response['custom:userRole'] = 'ForgedRole'

        with self.assertRaisesRegex(Exception, 'Unauthorized'):
            tenant_authorizer.lambda_handler(self.event(), None)

    def test_rejects_unknown_tier_in_verified_token(self):
        fake_idp_authorizer.response['custom:tenantTier'] = 'ForgedTier'

        with self.assertRaisesRegex(Exception, 'Unauthorized'):
            tenant_authorizer.lambda_handler(self.event(), None)

    def test_rejects_when_jwt_verifier_fails_closed(self):
        fake_idp_authorizer.response = False

        with self.assertRaisesRegex(Exception, 'Unauthorized'):
            tenant_authorizer.lambda_handler(self.event(), None)


if __name__ == '__main__':
    unittest.main()
