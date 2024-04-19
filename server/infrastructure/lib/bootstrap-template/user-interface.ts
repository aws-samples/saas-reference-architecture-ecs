import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import { StaticSite } from './static-site';
import { StaticSiteDistro } from './static-site-distro';

export interface UserInterfaceProps {
  regApiGatewayUrl: string
}

export class UserInterface extends Construct {
  public readonly appBucket: cdk.aws_s3.Bucket;
  public readonly appSiteUrl: string;
  constructor (scope: Construct, id: string, props: UserInterfaceProps) {
    super(scope, id);

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

    new StaticSite(this, 'TenantWebUI', {
      name: 'AppSite',
      assetDirectory: path.join(__dirname, '../../../../client/Application/'),
      production: true,
      apiUrl: props.regApiGatewayUrl,
      distribution: distro.cloudfrontDistribution,
      appBucket: distro.siteBucket,
      accessLogsBucket
    });
    this.appSiteUrl = `https://${distro.cloudfrontDistribution.domainName}`;
  }
}
