import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export interface StorageProps  {
  name: string
  partitionKey: string
  sortKey: string
  tableName: string
}

export class Storage extends Construct {
  public readonly table: dynamodb.Table;
  public readonly tableArn: string;

  constructor (scope: Construct, id: string, props: StorageProps) {
    super(scope, id);

    this.table = new dynamodb.Table(this, `${props.tableName}`, {
      tableName: `${props.tableName}`,
      billingMode: dynamodb.BillingMode.PROVISIONED,
      // readCapacity: 5, writeCapacity: 5,
      partitionKey: { name: props.partitionKey, type: dynamodb.AttributeType.STRING },
      sortKey: { name: props.sortKey, type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: true,
    });

    this.tableArn = this.table.tableArn;
    new cdk.CfnOutput(this, `${props.name}TableName`, {
      value: this.table.tableName
    });
  }
}
