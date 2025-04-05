import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { RemovalPolicy } from 'aws-cdk-lib';
import { addTemplateTag } from '../utilities/helper-functions';

export interface StaticSiteDistroProps {
  readonly allowedMethods: string[]
  accessLogsBucket: s3.Bucket
  env: cdk.Environment
}

export class StaticSiteDistro extends Construct {
  readonly cloudfrontDistribution: cloudfront.Distribution;
  readonly siteBucket: s3.Bucket;

  constructor (scope: Construct, id: string, props: StaticSiteDistroProps) {
    super(scope, id);
    addTemplateTag(this, 'StaticSiteDistro');
    const { distribution, appBucket } = this.createStaticSite(
      id,
      props.allowedMethods,
      props.accessLogsBucket,
      props.env
    );
    this.cloudfrontDistribution = distribution;
    this.siteBucket = appBucket;
  }

  private createStaticSite (id: string, allowedMethods: string[], accessLogsBucket: s3.Bucket, env: cdk.Environment) {
    const domainNamesToUse: string[] = [];

    const appBucket = new s3.Bucket(this, `${id}Bucket`, {
      bucketName: `${id}bucket-${env.account}-${env.region}`,
      enforceSSL: true,
      serverAccessLogsBucket: accessLogsBucket,
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY
    });

    // S3OriginAccessControl 
    const oac = new cloudfront.S3OriginAccessControl(this, 'S3OriginAccessControl', {
      description: 'ECS SaaS Access Control for CloudFront'
    });

    const distribution = new cloudfront.Distribution(this, `${id}Distribution`, {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(appBucket, {
          originAccessControl: oac,
        }),
        allowedMethods: { methods: allowedMethods },
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        compress: true,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS
      },
      defaultRootObject: 'index.html',
      domainNames: domainNamesToUse,
      enabled: true,

      errorResponses: [
        // Needed to support angular routing
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' }
      ],
      httpVersion: cloudfront.HttpVersion.HTTP2,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_ALL,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021
    });

    appBucket.addToResourcePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [appBucket.arnForObjects('*')],
      principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
      conditions: {
        StringEquals: {
          'AWS:SourceArn': `arn:aws:cloudfront::${cdk.Stack.of(this).account}:distribution/${distribution.distributionId}`
        }
      }
    }));
    
    return { distribution, appBucket };
  }
}
