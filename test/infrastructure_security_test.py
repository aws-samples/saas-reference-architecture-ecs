import re
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
API_GATEWAY = REPO_ROOT / 'server/lib/shared-infra/api-gateway.ts'
IDENTITY_PROVIDER = REPO_ROOT / 'server/lib/tenant-template/identity-provider.ts'
TENANT_TEMPLATE = REPO_ROOT / 'server/lib/tenant-template/tenant-template-stack.ts'
TOKEN_VENDING_MACHINE = REPO_ROOT / 'server/application/libs/auth/src/token-vending-machine.ts'
CLIENT_FACTORY = REPO_ROOT / 'server/application/libs/client-factory/src/client-factory.service.ts'
PROVISION_SCRIPT = REPO_ROOT / 'server/lib/provision-scripts/provision-tenant.sh'
DEPROVISION_SCRIPT = REPO_ROOT / 'server/lib/provision-scripts/deprovision-tenant.sh'
OPENAPI = REPO_ROOT / 'server/lib/tenant-api-prod.json'


class InfrastructureSecurityTest(unittest.TestCase):
    def test_authorizer_has_no_sts_access_role_or_credentials(self):
        source = API_GATEWAY.read_text()
        self.assertNotIn('AuthorizerAccessRole', source)
        self.assertNotIn('AUTHORIZER_ACCESS_ROLE', source)
        self.assertNotIn('sts:AssumeRole', source)

    def test_cognito_describe_access_is_pool_and_tag_scoped(self):
        source = API_GATEWAY.read_text()
        self.assertIn("actions: ['dynamodb:GetItem']", source)
        self.assertIn('props.tenantRegistryTable.tableArn', source)
        self.assertIn(
            'TRUSTED_TENANT_REGISTRY_TABLE: props.tenantRegistryTable.tableName',
            source,
        )
        self.assertIn("'cognito-idp:DescribeUserPool'", source)
        self.assertIn("'cognito-idp:DescribeUserPoolClient'", source)
        self.assertIn(':userpool/*', source)
        self.assertIn("'aws:ResourceTag/SaaSFactory': 'ECS-SaaS-Ref'", source)

    def test_api_key_get_access_is_not_wildcard(self):
        source = API_GATEWAY.read_text()
        self.assertIn('::/apikeys/${apiKeyId}', source)
        get_statement = re.search(
            r"actions: \['apigateway:GET'\],[\s\S]*?resources: ([\s\S]*?)\n\s*}\)",
            source,
        )
        self.assertIsNotNone(get_statement)
        self.assertNotIn("['*']", get_statement.group(1))

    def test_tenant_registry_records_exact_pool_client_and_tier(self):
        source = TENANT_TEMPLATE.read_text()
        self.assertIn(
            'userPoolId: { S: identityProvider.tenantUserPool.userPoolId }',
            source,
        )
        self.assertIn(
            'appClientId: { S: identityProvider.tenantUserPoolClient.userPoolClientId }',
            source,
        )
        self.assertIn('tenantTier: { S: props.tier }', source)

    def test_shared_pool_lifecycle_registers_and_deletes_each_tenant(self):
        provision = PROVISION_SCRIPT.read_text()
        deprovision = DEPROVISION_SCRIPT.read_text()
        self.assertIn('aws dynamodb update-item', provision)
        self.assertIn('tokensValidAfter = :tokensValidAfter', provision)
        self.assertIn('appClientId = :appClientId', provision)
        self.assertIn('aws dynamodb delete-item', deprovision)
        self.assertIn('TENANT_STACK_MAPPING_TABLE', deprovision)

    def test_token_vending_machine_uses_verified_id_token_for_session_tags(self):
        tvm_source = TOKEN_VENDING_MACHINE.read_text()
        factory_source = CLIENT_FACTORY.read_text()
        self.assertIn('const verifiedToken = jwt.verify', tvm_source)
        self.assertIn('verifiedToken.token_use !== "id"', tvm_source)
        self.assertNotIn('jwt.decode(jwtToken)', tvm_source)
        self.assertNotIn('new TokenVendingMachine(false)', factory_source)

    def test_public_client_cannot_write_authorization_attributes(self):
        source = IDENTITY_PROVIDER.read_text()
        write_block = re.search(
            r'const writeAttributes = ([\s\S]*?);\n\n', source)
        self.assertIsNotNone(write_block)
        self.assertIn('email: true', write_block.group(1))
        for attribute in ('tenantId', 'userRole', 'tenantTier'):
            self.assertNotIn(attribute, write_block.group(1))

    def test_self_signup_is_disabled(self):
        source = IDENTITY_PROVIDER.read_text()
        self.assertIn('selfSignUpEnabled: false', source)

    def test_authorizer_cache_key_uses_authorization_header_only(self):
        source = OPENAPI.read_text()
        self.assertIn(
            '"identitySource": "method.request.header.Authorization"',
            source,
        )
        self.assertNotIn('method.request.querystring._jwt', source)
        self.assertNotIn('method.request.header.Cookie', source)


if __name__ == '__main__':
    unittest.main()
