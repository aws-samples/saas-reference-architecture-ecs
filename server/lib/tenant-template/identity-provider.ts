import { aws_cognito, type StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { type IdentityDetails } from '../interfaces/identity-details';
import { addTemplateTag } from '../utilities/helper-functions';

interface IdentityProviderStackProps extends StackProps {
  tenantId: string
  appSiteUrl: string
}

export class IdentityProvider extends Construct {
  public readonly tenantUserPool: aws_cognito.UserPool;
  public readonly tenantUserPoolClient: aws_cognito.UserPoolClient;
  public readonly identityDetails: IdentityDetails;
  constructor (scope: Construct, id: string, props: IdentityProviderStackProps) {
    super(scope, id);
    addTemplateTag(this, 'IdentityProvider');
    this.tenantUserPool = new aws_cognito.UserPool(this, 'TenantUserPool', {
      autoVerify: { email: true },
      selfSignUpEnabled: true,

      accountRecovery: aws_cognito.AccountRecovery.EMAIL_ONLY,
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
        emailSubject: 'Your temporary password tenant UI application',
        emailBody:
          `Login into tenant UI application at ${props.appSiteUrl} with username {username} and temporary password {####}`,
        smsMessage:
          'Login: ${props.appSiteUrl}, tenant: ${tenantName}, username:{username}, temp P.W:{####}',
      }
    });

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
        }
      }
    });

    this.identityDetails = {
      name: 'Cognito',
      details: {
        userPoolId: this.tenantUserPool.userPoolId,
        appClientId: this.tenantUserPoolClient.userPoolClientId
      }
    };
  }
}
