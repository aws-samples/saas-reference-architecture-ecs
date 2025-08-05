import * as cdk from 'aws-cdk-lib';
import { type Construct } from 'constructs';
import path = require('path');
import { StaticSite } from './static-site';
import { ControlPlaneNag } from '../cdknag/control-plane-nag';
import { addTemplateTag } from '../utilities/helper-functions';
import * as sbt from '@cdklabs/sbt-aws';
import { StaticSiteDistro } from '../shared-infra/static-site-distro';

interface ControlPlaneStackProps extends cdk.StackProps {
  systemAdminEmail: string
  accessLogsBucket: cdk.aws_s3.Bucket
  distro: StaticSiteDistro
  adminSiteUrl: string
}

export class ControlPlaneStack extends cdk.Stack {
  public readonly regApiGatewayUrl: string;
  public readonly eventManager: sbt.IEventManager;
  public readonly auth: sbt.CognitoAuth;
  public readonly adminSiteUrl: string;
  public readonly staticSite: StaticSite;

  constructor (scope: Construct, id: string, props: ControlPlaneStackProps) {
    super(scope, id, props);
    addTemplateTag(this, 'ControlPlaneStack');

    const cognitoAuth = new sbt.CognitoAuth(this, 'CognitoAuth', {
      controlPlaneCallbackURL: props.adminSiteUrl
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

    // Check if AdminWeb directory exists before creating StaticSite
    const adminWebPath = path.join(__dirname, '../../../client/AdminWeb');
    const fs = require('fs');
    
    let staticSite;
    if (fs.existsSync(adminWebPath)) {
      staticSite = new StaticSite(this, 'AdminWebUi', {
        name: 'AdminSite',
        assetDirectory: adminWebPath,
        production: true,
        clientId: this.auth.userClientId,  //.clientId,
        issuer: this.auth.tokenEndpoint,
        apiUrl: this.regApiGatewayUrl,
        wellKnownEndpointUrl: this.auth.wellKnownEndpointUrl,
        distribution: props.distro.cloudfrontDistribution,
        appBucket: props.distro.siteBucket,
        accessLogsBucket: props.accessLogsBucket,
        env: {
          account: this.account,
          region: this.region
        }
      });
    } else {
      console.log('AdminWeb directory not found, skipping StaticSite creation');
    }
    
    new cdk.CfnOutput(this, 'adminSiteUrl', {
      value: props.adminSiteUrl
    });

    // new ControlPlaneNag(this, 'controlplane-nag');
  }
}
