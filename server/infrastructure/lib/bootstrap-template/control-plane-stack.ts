import { Stack, type StackProps, CfnOutput } from 'aws-cdk-lib';
import { type Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as control_plane from '@cdklabs/sbt-aws';
import { CognitoAuth } from '@cdklabs/sbt-aws';
import { StaticSiteDistro } from './static-site-distro';
import path = require('path');
import { StaticSite } from './static-site';
import { ControlPlaneNag } from '../cdknag/control-plane-nag';

interface ControlPlaneStackProps extends StackProps {
  controlPlaneEventSource: string
  applicationPlaneEventSource: string
  idpName: string
  systemAdminRoleName: string
  systemAdminEmail: string
}

export class ControlPlaneStack extends Stack {
  public readonly regApiGatewayUrl: string;
  public readonly eventBusArn: string;
  public readonly auth: CognitoAuth;
  public readonly adminSiteUrl: string;
  public readonly StaticSite: StaticSite;

  constructor (scope: Construct, id: string, props: ControlPlaneStackProps) {
    super(scope, id, props);

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

    const cognitoAuth = new CognitoAuth(this, 'CognitoAuth', {
      idpName: props.idpName,
      systemAdminRoleName: props.systemAdminRoleName,
      systemAdminEmail: props.systemAdminEmail,
      controlPlaneCallbackURL: this.adminSiteUrl
    });

    const controlPlane = new control_plane.ControlPlane(this, 'controlplane-sbt', {
      applicationPlaneEventSource: props.applicationPlaneEventSource,
      controlPlaneEventSource: props.controlPlaneEventSource,
      auth: cognitoAuth
    });

    this.regApiGatewayUrl = controlPlane.controlPlaneAPIGatewayUrl;
    this.eventBusArn = controlPlane.eventBusArn;
    this.auth = cognitoAuth;

    this.StaticSite = new StaticSite(this, 'AdminWebUi', {
      name: 'AdminSite',
      assetDirectory: path.join(__dirname, '../../../../client/AdminWeb/'),
      production: true,
      clientId: this.auth.clientId,
      issuer: this.auth.authorizationServer,
      apiUrl: this.regApiGatewayUrl,
      wellKnownEndpointUrl: this.auth.wellKnownEndpointUrl,
      distribution: distro.cloudfrontDistribution,
      appBucket: distro.siteBucket,
      accessLogsBucket
    });

    new CfnOutput(this, 'adminSiteUrl', {
      value: this.adminSiteUrl
    });

    new ControlPlaneNag(this, 'controlplane-nag');
  }
}
