# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

# import re
import json
import os
# import urllib.request
import boto3
# import time
import logger
# from jose import jwk, jwt
# from jose.utils import base64url_decode
# import auth_manager
import utils
import idp_object_factory


region = os.environ['AWS_REGION']
sts_client = boto3.client("sts", region_name=region)

# api keys for different tiers
# for a basic(pooled) deployment
premium_tier_api_key = os.environ.get('PREMIUM_TIER_API_KEY', '')
advanced_tier_api_key = os.environ.get('ADVANCED_TIER_API_KEY', '')
basic_tier_api_key = os.environ.get('BASIC_TIER_API_KEY', '')

authorizer_access_role = os.environ['AUTHORIZER_ACCESS_ROLE']

idp_details=json.loads(os.environ['IDP_DETAILS'])
idp_authorizer_service = idp_object_factory.get_idp_authorizer_object(idp_details['name'])

def lambda_handler(event, context):
    input_details={}
    input_details['idpDetails'] = idp_details

    ##############
    print(event)

    # Retrieve request parameters from the Lambda function input:
    headers = event['headers']
    logger.info("headers: " + str(headers)) 
    queryStringParameters = event['queryStringParameters']
    logger.info("queryStringParameters: " + str(queryStringParameters))
    stageVariables = event['stageVariables']
    requestContext = event['requestContext']

    # Parse the input for the parameter values
    tmp = event['methodArn'].split(':')
    apiGatewayArnTmp = tmp[5].split('/')
    awsAccountId = tmp[4]
    region = tmp[3]
    ApiId = apiGatewayArnTmp[0]
    stage = apiGatewayArnTmp[1]
    route = apiGatewayArnTmp[2]
  
    ##############

    token = headers['Authorization'].split(" ")
    if (token[0] != 'Bearer'):
        raise Exception(
            'Authorization header should have a format Bearer <JWT> Token')
    jwt_bearer_token = token[1]

    input_details['jwtToken']=jwt_bearer_token
    response = idp_authorizer_service.validateJWT(input_details)

    # get authenticated claims
    if (response == False):
        logger.error('Unauthorized')
        raise Exception('Unauthorized')
    else:
        logger.info(response)
        principal_id = response["sub"]
        user_name = response["cognito:username"]
        tenant_id = response["custom:tenantId"]
        user_role = response["custom:userRole"]
        tenant_tier = response["custom:tenantTier"]

    if (tenant_tier.upper() == utils.TenantTier.PREMIUM.value.upper()):
        api_key = premium_tier_api_key
    elif (tenant_tier.upper() == utils.TenantTier.ADVANCED.value.upper()):
        api_key = advanced_tier_api_key
    elif (tenant_tier.upper() == utils.TenantTier.BASIC.value.upper()):
        api_key = basic_tier_api_key

    logger.info("Method ARN: " + event['methodArn'])    

    # tmp = event['methodArn'].split(':') # arn:aws:execute-api:ap-northeast-2:1234567890:3uweihxqul/prod/GET/orders
    # aws_account_id = tmp[4] # 1234567890

    # policy = AuthPolicy(principal_id, aws_account_id)
    # policy.region = tmp[3] # ap-northeast-2
    # api_gateway_arn_tmp = tmp[5].split('/') # 3uweihxqul/prod/GET/orders
    # policy.restApiId = api_gateway_arn_tmp[0] # 3uweihxqul
    # policy.stage = api_gateway_arn_tmp[1] # prod

    # policy.allowAllMethods()
    # authResponse = policy.build()

    

    # iam_policy = auth_manager.getPolicyForUser(
    #     user_role, utils.Service_Identifier.BUSINESS_SERVICES.value, tenant_id, region, aws_account_id)
    # logger.info(iam_policy)


    tenantPath = tenant_id
    if (tenant_tier.upper() == utils.TenantTier.BASIC.value.upper()):
        tenantPath = tenant_tier.lower()
    
    logger.info("Tenant Path: " + tenantPath)
    # pass sts credentials to lambda
    context = {
        # $context.authorizer.key -> value
        'userName': user_name,
        'tenantPath': tenantPath,
        'idpDetials': str(idp_details),
        'apiKey': api_key,
        'userRole': user_role
    }

    response = generateAllow('me', event['methodArn'])
    authResponse = json.loads(response)
    authResponse['context'] = context
    return authResponse
    # authResponse['context'] = context
    # authResponse['usageIdentifierKey'] = api_key
    # print(authResponse)
    # return authResponse


def generatePolicy(principalId, effect, resource):
    authResponse = {}
    authResponse['principalId'] = principalId
    if (effect and resource):
        policyDocument = {}
        policyDocument['Version'] = '2012-10-17'
        policyDocument['Statement'] = []
        statementOne = {}
        statementOne['Action'] = 'execute-api:Invoke'
        statementOne['Effect'] = effect
        statementOne['Resource'] = resource
        policyDocument['Statement'] = [statementOne]
        authResponse['policyDocument'] = policyDocument

    # authResponse['context'] = {
    #     "stringKey": "stringval",
    #     "numberKey": 123,
    #     "booleanKey": True
    # }
    authResponse_JSON = json.dumps(authResponse)
    return authResponse_JSON


def generateAllow(principalId, resource):
    return generatePolicy(principalId, 'Allow', resource)


def generateDeny(principalId, resource):
    return generatePolicy(principalId, 'Deny', resource)


# def isTenantAuthorizedForThisAPI(apigateway_url, current_api_id):
#     if (apigateway_url.split('.')[0] != 'https://' + current_api_id):
#         return False
#     else:
#         return True

# class HttpVerb:
#     GET = "GET"
#     POST = "POST"
#     PUT = "PUT"
#     PATCH = "PATCH"
#     HEAD = "HEAD"
#     DELETE = "DELETE"
#     OPTIONS = "OPTIONS"
#     ALL = "*"

# class AuthPolicy(object):
#     awsAccountId = ""
#     """The AWS account id the policy will be generated for. This is used to create the method ARNs."""
#     principalId = ""
#     """The principal used for the policy, this should be a unique identifier for the end user."""
#     version = "2012-10-17"
#     """The policy version used for the evaluation. This should always be '2012-10-17'"""
#     pathRegex = "^[/.a-zA-Z0-9-\*]+$"
#     """The regular expression used to validate resource paths for the policy"""

#     """these are the internal lists of allowed and denied methods. These are lists
#     of objects and each object has 2 properties: A resource ARN and a nullable
#     conditions statement.
#     the build method processes these lists and generates the approriate
#     statements for the final policy"""
#     allowMethods = []
#     denyMethods = []

#     restApiId = "*"
#     """The API Gateway API id. By default this is set to '*'"""
#     region = "*"
#     """The region where the API is deployed. By default this is set to '*'"""
#     stage = "*"
#     """The name of the stage used in the policy. By default this is set to '*'"""

#     def __init__(self, principal, awsAccountId):
#         self.awsAccountId = awsAccountId
#         self.principalId = principal
#         self.allowMethods = []
#         self.denyMethods = []

#     def _addMethod(self, effect, verb, resource, conditions):
#         """Adds a method to the internal lists of allowed or denied methods. Each object in
#         the internal list contains a resource ARN and a condition statement. The condition
#         statement can be null."""
#         if verb != "*" and not hasattr(HttpVerb, verb):
#             raise NameError("Invalid HTTP verb " + verb +
#                             ". Allowed verbs in HttpVerb class")
#         resourcePattern = re.compile(self.pathRegex)
#         if not resourcePattern.match(resource):
#             raise NameError("Invalid resource path: " + resource +
#                             ". Path should match " + self.pathRegex)

#         if resource[:1] == "/":
#             resource = resource[1:]

#         resourceArn = ("arn:aws:execute-api:" +
#                        self.region + ":" +
#                        self.awsAccountId + ":" +
#                        self.restApiId + "/" +
#                        self.stage + "/" +
#                        verb + "/" +
#                        resource)

#         if effect.lower() == "allow":
#             self.allowMethods.append({
#                 'resourceArn': resourceArn,
#                 'conditions': conditions
#             })
#         elif effect.lower() == "deny":
#             self.denyMethods.append({
#                 'resourceArn': resourceArn,
#                 'conditions': conditions
#             })

#     def _getEmptyStatement(self, effect):
#         """Returns an empty statement object prepopulated with the correct action and the
#         desired effect."""
#         statement = {
#             'Action': 'execute-api:Invoke',
#             'Effect': effect[:1].upper() + effect[1:].lower(),
#             'Resource': []
#         }

#         return statement

#     def _getStatementForEffect(self, effect, methods):
#         """This function loops over an array of objects containing a resourceArn and
#         conditions statement and generates the array of statements for the policy."""
#         statements = []

#         if len(methods) > 0:
#             statement = self._getEmptyStatement(effect)

#             for curMethod in methods:
#                 if curMethod['conditions'] is None or len(curMethod['conditions']) == 0:
#                     statement['Resource'].append(curMethod['resourceArn'])
#                 else:
#                     conditionalStatement = self._getEmptyStatement(effect)
#                     conditionalStatement['Resource'].append(
#                         curMethod['resourceArn'])
#                     conditionalStatement['Condition'] = curMethod['conditions']
#                     statements.append(conditionalStatement)

#             statements.append(statement)

#         return statements

#     def allowAllMethods(self):
#         """Adds a '*' allow to the policy to authorize access to all methods of an API"""
#         self._addMethod("Allow", HttpVerb.ALL, "*", [])

#     def denyAllMethods(self):
#         """Adds a '*' allow to the policy to deny access to all methods of an API"""
#         self._addMethod("Deny", HttpVerb.ALL, "*", [])

#     def allowMethod(self, verb, resource):
#         """Adds an API Gateway method (Http verb + Resource path) to the list of allowed
#         methods for the policy"""
#         self._addMethod("Allow", verb, resource, [])

#     def denyMethod(self, verb, resource):
#         """Adds an API Gateway method (Http verb + Resource path) to the list of denied
#         methods for the policy"""
#         self._addMethod("Deny", verb, resource, [])

#     def allowMethodWithConditions(self, verb, resource, conditions):
#         """Adds an API Gateway method (Http verb + Resource path) to the list of allowed
#         methods and includes a condition for the policy statement. More on AWS policy
#         conditions here: http://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements.html#Condition"""
#         self._addMethod("Allow", verb, resource, conditions)

#     def denyMethodWithConditions(self, verb, resource, conditions):
#         """Adds an API Gateway method (Http verb + Resource path) to the list of denied
#         methods and includes a condition for the policy statement. More on AWS policy
#         conditions here: http://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements.html#Condition"""
#         self._addMethod("Deny", verb, resource, conditions)

#     def build(self):
#         """Generates the policy document based on the internal lists of allowed and denied
#         conditions. This will generate a policy with two main statements for the effect:
#         one statement for Allow and one statement for Deny.
#         Methods that includes conditions will have their own statement in the policy."""
#         if ((self.allowMethods is None or len(self.allowMethods) == 0) and
#                 (self.denyMethods is None or len(self.denyMethods) == 0)):
#             raise NameError("No statements defined for the policy")

#         policy = {
#             'principalId': self.principalId,
#             'policyDocument': {
#                 'Version': self.version,
#                 'Statement': []
#             }
#         }

#         policy['policyDocument']['Statement'].extend(
#             self._getStatementForEffect("Allow", self.allowMethods))
#         policy['policyDocument']['Statement'].extend(
#             self._getStatementForEffect("Deny", self.denyMethods))

#         return policy
