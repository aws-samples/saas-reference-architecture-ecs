import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { RemovalPolicy } from 'aws-cdk-lib';

export interface StaticSiteDistroProps {
  readonly allowedMethods: string[]
  accessLogsBucket: s3.Bucket
}

export class StaticSiteDistro extends Construct {
  readonly cloudfrontDistribution: cloudfront.Distribution;
  readonly siteBucket: s3.Bucket;

  constructor (scope: Construct, id: string, props: StaticSiteDistroProps) {
    super(scope, id);
    const { distribution, appBucket } = this.createStaticSite(
      id,
      props.allowedMethods,
      props.accessLogsBucket
    );
    this.cloudfrontDistribution = distribution;
    this.siteBucket = appBucket;
  }

  private createStaticSite (id: string, allowedMethods: string[], accessLogsBucket: s3.Bucket) {
    const oai = new cloudfront.OriginAccessIdentity(this, `${id}OriginAccessIdentity`, {
      comment: 'Special CloudFront user to fetch S3 contents'
    });

    const domainNamesToUse: string[] = [];

    const appBucket = new s3.Bucket(this, `${id}Bucket`, {
      enforceSSL: true,
      serverAccessLogsBucket: accessLogsBucket,
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY
    });

    appBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        resources: [appBucket.arnForObjects('*')],
        actions: ['s3:GetObject'],
        principals: [
          new iam.CanonicalUserPrincipal(oai.cloudFrontOriginAccessIdentityS3CanonicalUserId)
        ]
      })
    );

    const distribution = new cloudfront.Distribution(this, `${id}Distribution`, {
      defaultBehavior: {
        origin: new origins.S3Origin(appBucket, {
          originAccessIdentity: oai
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

    return { distribution, appBucket };
  }
}
