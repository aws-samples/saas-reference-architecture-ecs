import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export interface EcsDynamoDBProps  {
  name: string
  partitionKey: string
  sortKey: string
  tableName: string
  tenantName: string
}

export class EcsDynamoDB extends Construct {
  public readonly table: dynamodb.Table;
  // public readonly tableArn: string;
  public readonly policyDocument: cdk.aws_iam.PolicyDocument;

  constructor (scope: Construct, id: string, props: EcsDynamoDBProps) {
    super(scope, id);

    this.table = new dynamodb.Table(this, `${props.tableName}`, {
      tableName: `${props.tableName}`,
      billingMode: dynamodb.BillingMode.PROVISIONED,
      // readCapacity: 5, writeCapacity: 5,
      partitionKey: { name: props.partitionKey, type: dynamodb.AttributeType.STRING },
      sortKey: { name: props.sortKey, type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: true
    });
    cdk.Tags.of(this.table).add('TenantName', props.tenantName);

    // this.tableArn = this.table.tableArn;

    this.policyDocument = new cdk.aws_iam.PolicyDocument({ 
      statements: [new cdk.aws_iam.PolicyStatement({
        actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 
          'dynamodb:UpdateItem', 'dynamodb:DeleteItem', 'dynamodb:Query'],
        resources: [this.table.tableArn],
        effect: cdk.aws_iam.Effect.ALLOW
      })]
    });

    new cdk.CfnOutput(this, `${props.name}TableName`, {
      value: this.table.tableName
    });

  }
}
