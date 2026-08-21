# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

import json
import os
import re

import boto3
import logger
import auth_manager
import utils
import idp_object_factory


region = os.environ['AWS_REGION']
apigateway_client = boto3.client("apigateway", region_name=region)

# API key IDs for different tiers
premium_tier_api_key_id = os.environ.get('PREMIUM_TIER_API_KEY', '')
advanced_tier_api_key_id = os.environ.get('ADVANCED_TIER_API_KEY', '')
basic_tier_api_key_id = os.environ.get('BASIC_TIER_API_KEY', '')

SUPPORTED_ROLES = {
    auth_manager.UserRoles.TENANT_ADMIN,
    auth_manager.UserRoles.TENANT_USER,
}
SUPPORTED_TIERS = {
    utils.TenantTier.PREMIUM.value.upper(),
    utils.TenantTier.ADVANCED.value.upper(),
    utils.TenantTier.BASIC.value.upper(),
}

# Cache for API key values to avoid repeated API calls
api_key_cache = {}


def get_api_key_value(api_key_id):
    """Get API key value from API key ID, with caching."""
    if not api_key_id:
        return ''

    if api_key_id in api_key_cache:
        return api_key_cache[api_key_id]

    try:
        response = apigateway_client.get_api_key(
            apiKey=api_key_id,
            includeValue=True
        )
        api_key_value = response.get('value', '')
        api_key_cache[api_key_id] = api_key_value
        return api_key_value
    except Exception as error:
        logger.error(
            'Failed to get API key value ({})'.format(type(error).__name__))
        return ''


idp_details = json.loads(os.environ['IDP_DETAILS'])
idp_authorizer_service = idp_object_factory.get_idp_authorizer_object(
    idp_details['name'])


def lambda_handler(event, context):
    input_details = {
        'idpDetails': idp_details,
    }

    # The API Gateway REQUEST authorizer uses the Authorization header as its
    # sole identity source and cache key. Never validate a token from a
    # different transport than the configured identity source.
    headers = event.get('headers') or {}
    auth_header = headers.get('Authorization') or headers.get('authorization') or ''
    if not auth_header.startswith('Bearer '):
        raise Exception('Unauthorized')

    jwt_bearer_token = auth_header[7:].strip()
    if not jwt_bearer_token:
        raise Exception('Unauthorized')

    input_details['jwtToken'] = jwt_bearer_token
    response = idp_authorizer_service.validateJWT(input_details)
    if response is False:
        logger.error('Unauthorized')
        raise Exception('Unauthorized')

    try:
        principal_id = response['sub']
        user_name = response['cognito:username']
        tenant_id = response['custom:tenantId']
        user_role = response['custom:userRole']
        tenant_tier = response['custom:tenantTier']
    except (KeyError, TypeError):
        raise Exception('Unauthorized')

    if user_role not in SUPPORTED_ROLES:
        raise Exception('Unauthorized')

    normalized_tier = tenant_tier.upper()
    if normalized_tier not in SUPPORTED_TIERS:
        raise Exception('Unauthorized')

    if normalized_tier == utils.TenantTier.PREMIUM.value.upper():
        api_key = get_api_key_value(premium_tier_api_key_id)
    elif normalized_tier == utils.TenantTier.ADVANCED.value.upper():
        api_key = get_api_key_value(advanced_tier_api_key_id)
    else:
        api_key = get_api_key_value(basic_tier_api_key_id)

    method_arn = event.get('methodArn', '')
    arn_parts = method_arn.split(':')
    if len(arn_parts) < 6:
        raise Exception('Unauthorized')

    aws_account_id = arn_parts[4]
    api_gateway_arn_parts = arn_parts[5].split('/')
    if len(api_gateway_arn_parts) < 3:
        raise Exception('Unauthorized')

    policy = AuthPolicy(principal_id, aws_account_id)
    policy.region = arn_parts[3]
    policy.restApiId = api_gateway_arn_parts[0]
    policy.stage = api_gateway_arn_parts[1]

    policy.allowAllMethods()
    resource_path = api_gateway_arn_parts[3] if len(api_gateway_arn_parts) > 3 else ''
    if auth_manager.isTenantUser(user_role) and resource_path == 'users':
        policy.denyMethod(HttpVerb.ALL, "users")
        policy.denyMethod(HttpVerb.ALL, "users/*")

    auth_response = policy.build()

    tenant_path = tenant_id
    if normalized_tier == utils.TenantTier.BASIC.value.upper():
        tenant_path = tenant_tier.lower()

    # Keep authorizer context minimal. Temporary AWS credentials must never be
    # generated or exposed by an API Gateway authorizer.
    auth_response['context'] = {
        'userName': user_name,
        'tenantPath': tenant_path,
        'userRole': user_role,
    }
    auth_response['usageIdentifierKey'] = api_key

    return auth_response


def isTenantAuthorizedForThisAPI(apigateway_url, current_api_id):
    if (apigateway_url.split('.')[0] != 'https://' + current_api_id):
        return False
    else:
        return True

class HttpVerb:
    GET = "GET"
    POST = "POST"
    PUT = "PUT"
    PATCH = "PATCH"
    HEAD = "HEAD"
    DELETE = "DELETE"
    OPTIONS = "OPTIONS"
    ALL = "*"

class AuthPolicy(object):
    awsAccountId = ""
    """The AWS account id the policy will be generated for. This is used to create the method ARNs."""
    principalId = ""
    """The principal used for the policy, this should be a unique identifier for the end user."""
    version = "2012-10-17"
    """The policy version used for the evaluation. This should always be '2012-10-17'"""
    pathRegex = "^[/.a-zA-Z0-9-\*]+$"
    """The regular expression used to validate resource paths for the policy"""

    """these are the internal lists of allowed and denied methods. These are lists
    of objects and each object has 2 properties: A resource ARN and a nullable
    conditions statement.
    the build method processes these lists and generates the approriate
    statements for the final policy"""
    allowMethods = []
    denyMethods = []

    restApiId = "*"
    """The API Gateway API id. By default this is set to '*'"""
    region = "*"
    """The region where the API is deployed. By default this is set to '*'"""
    stage = "*"
    """The name of the stage used in the policy. By default this is set to '*'"""

    def __init__(self, principal, awsAccountId):
        self.awsAccountId = awsAccountId
        self.principalId = principal
        self.allowMethods = []
        self.denyMethods = []

    def _addMethod(self, effect, verb, resource, conditions):
        """Adds a method to the internal lists of allowed or denied methods. Each object in
        the internal list contains a resource ARN and a condition statement. The condition
        statement can be null."""
        if verb != "*" and not hasattr(HttpVerb, verb):
            raise NameError("Invalid HTTP verb " + verb +
                            ". Allowed verbs in HttpVerb class")
        resourcePattern = re.compile(self.pathRegex)
        if not resourcePattern.match(resource):
            raise NameError("Invalid resource path: " + resource +
                            ". Path should match " + self.pathRegex)

        if resource[:1] == "/":
            resource = resource[1:]

        resourceArn = ("arn:aws:execute-api:" +
                       self.region + ":" +
                       self.awsAccountId + ":" +
                       self.restApiId + "/" +
                       self.stage + "/" +
                       verb + "/" +
                       resource)

        if effect.lower() == "allow":
            self.allowMethods.append({
                'resourceArn': resourceArn,
                'conditions': conditions
            })
        elif effect.lower() == "deny":
            self.denyMethods.append({
                'resourceArn': resourceArn,
                'conditions': conditions
            })

    def _getEmptyStatement(self, effect):
        """Returns an empty statement object prepopulated with the correct action and the
        desired effect."""
        statement = {
            'Action': 'execute-api:Invoke',
            'Effect': effect[:1].upper() + effect[1:].lower(),
            'Resource': []
        }

        return statement

    def _getStatementForEffect(self, effect, methods):
        """This function loops over an array of objects containing a resourceArn and
        conditions statement and generates the array of statements for the policy."""
        statements = []

        if len(methods) > 0:
            statement = self._getEmptyStatement(effect)

            for curMethod in methods:
                if curMethod['conditions'] is None or len(curMethod['conditions']) == 0:
                    statement['Resource'].append(curMethod['resourceArn'])
                else:
                    conditionalStatement = self._getEmptyStatement(effect)
                    conditionalStatement['Resource'].append(
                        curMethod['resourceArn'])
                    conditionalStatement['Condition'] = curMethod['conditions']
                    statements.append(conditionalStatement)

            statements.append(statement)

        return statements

    def allowAllMethods(self):
        """Adds a '*' allow to the policy to authorize access to all methods of an API"""
        self._addMethod("Allow", HttpVerb.ALL, "*", [])

    def denyAllMethods(self):
        """Adds a '*' allow to the policy to deny access to all methods of an API"""
        self._addMethod("Deny", HttpVerb.ALL, "*", [])

    def allowMethod(self, verb, resource):
        """Adds an API Gateway method (Http verb + Resource path) to the list of allowed
        methods for the policy"""
        self._addMethod("Allow", verb, resource, [])

    def denyMethod(self, verb, resource):
        """Adds an API Gateway method (Http verb + Resource path) to the list of denied
        methods for the policy"""
        self._addMethod("Deny", verb, resource, [])

    def allowMethodWithConditions(self, verb, resource, conditions):
        """Adds an API Gateway method (Http verb + Resource path) to the list of allowed
        methods and includes a condition for the policy statement. More on AWS policy
        conditions here: http://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements.html#Condition"""
        self._addMethod("Allow", verb, resource, conditions)

    def denyMethodWithConditions(self, verb, resource, conditions):
        """Adds an API Gateway method (Http verb + Resource path) to the list of denied
        methods and includes a condition for the policy statement. More on AWS policy
        conditions here: http://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements.html#Condition"""
        self._addMethod("Deny", verb, resource, conditions)

    def build(self):
        """Generates the policy document based on the internal lists of allowed and denied
        conditions. This will generate a policy with two main statements for the effect:
        one statement for Allow and one statement for Deny.
        Methods that includes conditions will have their own statement in the policy."""
        if ((self.allowMethods is None or len(self.allowMethods) == 0) and
                (self.denyMethods is None or len(self.denyMethods) == 0)):
            raise NameError("No statements defined for the policy")

        policy = {
            'principalId': self.principalId,
            'policyDocument': {
                'Version': self.version,
                'Statement': []
            }
        }

        policy['policyDocument']['Statement'].extend(
            self._getStatementForEffect("Allow", self.allowMethods))
        policy['policyDocument']['Statement'].extend(
            self._getStatementForEffect("Deny", self.denyMethods))

        return policy
