import { aws_cognito, type StackProps, Tags } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { type IdentityDetails } from '../interfaces/identity-details';

interface IdentityProviderStackProps extends StackProps {
  tenantId: string
  tenantName: string
  tier: string
  appSiteUrl: string
  useFederation: string
}

export class IdentityProvider extends Construct {
  public readonly tenantUserPool: aws_cognito.UserPool;
  public readonly tenantUserPoolClient: aws_cognito.UserPoolClient;
  public readonly identityDetails: IdentityDetails;
  constructor (scope: Construct, id: string, props: IdentityProviderStackProps) {
    super(scope, id);
    this.tenantUserPool = new aws_cognito.UserPool(this, props.tenantId, {
      autoVerify: { email: true },
      advancedSecurityMode: aws_cognito.AdvancedSecurityMode.OFF,
      selfSignUpEnabled: props.useFederation.toLowerCase() === 'true',

      accountRecovery: aws_cognito.AccountRecovery.EMAIL_ONLY,
      signInAliases: {
        email: true,
        username: false
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: true
        }
      },
      // password policy
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true
      },
      customAttributes: {
        tenantId: new aws_cognito.StringAttribute({
          mutable: true
        }),
        userRole: new aws_cognito.StringAttribute({
          mutable: true
        }),
        apiKey: new aws_cognito.StringAttribute({
          mutable: true
        }),
        // adding this new custom attribute so that we can determine which API Key
        // to use without having to hit an external db in the lambda tenant_authorizer function
        tenantTier: new aws_cognito.StringAttribute({
          mutable: true
        }),
        tenantName: new aws_cognito.StringAttribute({
          mutable: true
        })

      },
      userInvitation: {
        emailSubject: props.tenantName !== 'basic'
          ? `[${props.tenantName}] Your temporary password`
          : 'Your temporary password',
        emailBody: props.tenantName !== 'basic'
          ? `Welcome to ${props.tenantName}!\n\nLogin at ${props.appSiteUrl}?tenant=${props.tenantName}\n\nUsername:\n{username}\n\nTemporary password:\n{####}\n\nPlease change your password after first login.`
          : `Welcome!\n\nLogin at ${props.appSiteUrl}\n\nUsername:\n{username}\n\nTemporary password:\n{####}\n\nPlease change your password after first login.`,
        smsMessage:
          `Tenant: ${props.tenantName}, Username: {username}, Temp PW: {####}`,
      }
    });

    // Override logical ID to remove hash and include tier info
    const cleanTenantId = props.tenantId.replace(/[^a-zA-Z0-9]/g, '');
    (this.tenantUserPool.node.defaultChild as aws_cognito.CfnUserPool).overrideLogicalId(`${props.tier.toLowerCase()}UserPool${cleanTenantId}`);

    // Add tags for cleanup identification
    Tags.of(this.tenantUserPool).add('SaaSFactory', 'ECS-SaaS-Ref');

    const writeAttributes = new aws_cognito.ClientAttributes()
      .withStandardAttributes({ email: true })
      .withCustomAttributes('tenantId', 'userRole', 'apiKey', 'tenantTier', 'tenantName');

    this.tenantUserPoolClient = new aws_cognito.UserPoolClient(this, 'tenantUserPoolClient', {
      userPool: this.tenantUserPool,
      generateSecret: false,
      authFlows: {
        userPassword: true,
        adminUserPassword: false,
        userSrp: true,
        custom: false
      },
      writeAttributes: writeAttributes,
      oAuth: {
        scopes: [
          aws_cognito.OAuthScope.EMAIL,
          aws_cognito.OAuthScope.OPENID,
          aws_cognito.OAuthScope.PROFILE
        ],
        flows: {
          authorizationCodeGrant: true,
          implicitCodeGrant: true
        },
        callbackUrls: [props.appSiteUrl],
        logoutUrls: [props.appSiteUrl],
      }
    });

    this.identityDetails = {
      name: 'Cognito',
      details: {
        userPoolId: this.tenantUserPool.userPoolId,
        appClientId: this.tenantUserPoolClient.userPoolClientId
      }
    };

    // Add Cognito Hosted UI domain (required for OIDC authorization code flow)
    this.tenantUserPool.addDomain('CognitoDomain', {
      cognitoDomain: {
        domainPrefix: this.tenantUserPoolClient.userPoolClientId
      }
    });
  }
}
