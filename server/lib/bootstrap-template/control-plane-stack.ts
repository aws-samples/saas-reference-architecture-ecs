import * as cdk from 'aws-cdk-lib';
import { type Construct } from 'constructs';
import { StaticSiteDistro } from './static-site-distro';
import path = require('path');
import { StaticSite } from './static-site';
import { ControlPlaneNag } from '../cdknag/control-plane-nag';
import * as sbt from '@cdklabs/sbt-aws';
import { addTemplateTag } from '../utilities/helper-functions';

interface ControlPlaneStackProps extends cdk.StackProps {
  systemAdminRoleName: string
  systemAdminEmail: string
}

export class ControlPlaneStack extends cdk.Stack {
  public readonly regApiGatewayUrl: string;
  public readonly eventManager: sbt.IEventManager;
  public readonly auth: sbt.CognitoAuth;
  public readonly adminSiteUrl: string;
  public readonly StaticSite: StaticSite;

  constructor (scope: Construct, id: string, props: ControlPlaneStackProps) {
    super(scope, id, props);
    addTemplateTag(this, 'ControlPlaneStack');
    const accessLogsBucket = new cdk.aws_s3.Bucket(this, 'AccessLogsBucket', {
      enforceSSL: true,
      autoDeleteObjects: true,
      accessControl: cdk.aws_s3.BucketAccessControl.LOG_DELIVERY_WRITE,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    const distro = new StaticSiteDistro(this, 'StaticSiteDistro', {
      allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
      accessLogsBucket
    });

    this.adminSiteUrl = `https://${distro.cloudfrontDistribution.domainName}`;

    const cognitoAuth = new sbt.CognitoAuth(this, 'CognitoAuth', {
      // Avoid checking scopes for API endpoints. Done only for testing purposes.
      // setAPIGWScopes: false,
      controlPlaneCallbackURL: this.adminSiteUrl
    });

    const controlPlane = new sbt.ControlPlane(this, 'controlplane-sbt', {
      systemAdminEmail: props.systemAdminEmail,
      auth: cognitoAuth,
      apiCorsConfig: {
        allowOrigins: ['https://*'],
        allowCredentials: true,
        allowHeaders: ['*'],
        allowMethods: [cdk.aws_apigatewayv2.CorsHttpMethod.ANY],
        maxAge: cdk.Duration.seconds(300),
      },
    });

    this.eventManager = controlPlane.eventManager;
    this.regApiGatewayUrl = controlPlane.controlPlaneAPIGatewayUrl;
    this.auth = cognitoAuth;

    this.StaticSite = new StaticSite(this, 'AdminWebUi', {
      name: 'AdminSite',
      assetDirectory: path.join(__dirname, '../../../client/AdminWeb/'),
      production: true,
      clientId: this.auth.userClientId,  //.clientId,
      issuer: this.auth.tokenEndpoint,
      apiUrl: this.regApiGatewayUrl,
      wellKnownEndpointUrl: this.auth.wellKnownEndpointUrl,
      distribution: distro.cloudfrontDistribution,
      appBucket: distro.siteBucket,
      accessLogsBucket
    });
    
    new cdk.CfnOutput(this, 'adminSiteUrl', {
      value: this.adminSiteUrl
    });

    new ControlPlaneNag(this, 'controlplane-nag');
  }
}
