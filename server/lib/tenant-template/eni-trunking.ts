import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

export class CustomEniTrunking extends Construct {
  public readonly ec2Role: iam.Role;

  constructor(scope: Construct, id: string, props?: cdk.NestedStackProps) {
    super(scope, id);
    // Lambda function code
    const lambdaFunctionCode = lambda.Code.fromInline(`
      const { ECSClient, PutAccountSettingCommand } = require("@aws-sdk/client-ecs");
      const { STSClient, AssumeRoleCommand } = require("@aws-sdk/client-sts");

      const response = require('cfn-response');

      exports.handler = async function(event, context) {
        console.log(event);

        if (event.RequestType == "Delete") {
          await response.send(event, context, response.SUCCESS);
          return;
        }

        const sts = new STSClient({ region: event.ResourceProperties.Region });

        const assumeRoleResponse = await sts.send(new AssumeRoleCommand({
          RoleArn: event.ResourceProperties.EC2Role,
          RoleSessionName: "eni-trunking-enable-session",
          DurationSeconds: 900
        }));

        // Instantiate an ECS client using the credentials of the EC2 role
        const ecs = new ECSClient({
          region: event.ResourceProperties.Region,
          credentials: {
            accessKeyId: assumeRoleResponse.Credentials.AccessKeyId,
            secretAccessKey: assumeRoleResponse.Credentials.SecretAccessKey,
            sessionToken: assumeRoleResponse.Credentials.SessionToken
          }
        });

        const putAccountResponse = await ecs.send(new PutAccountSettingCommand({
          name: 'awsvpcTrunking',
          value: 'enabled'
        }));
        console.log(putAccountResponse);

        await response.send(event, context, response.SUCCESS);
      };
    `);

    const customEniTrunkingPolicy = new cdk.aws_iam.PolicyDocument({
        statements: [
          new cdk.aws_iam.PolicyStatement({
            actions: ['sts:AssumeRole'],
            resources: ['*'],
            effect: iam.Effect.ALLOW
          }),
        ]
      });
    // Role for the Lambda function
    const customEniTrunkingRole = new iam.Role(this, 'CustomEniTrunkingRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Lambda function
    const customEniTrunkingFunction = new lambda.Function(this, 'CustomEniTrunkingFunction', {
        code: lambdaFunctionCode,
        handler: 'index.handler',
        runtime: Runtime.NODEJS_20_X,
        timeout: cdk.Duration.seconds(30),
        role: customEniTrunkingRole
      });
      
    // Role for the EC2 instances
    this.ec2Role = new iam.Role(this, 'EC2Role', {
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal('ec2.amazonaws.com'),
        new iam.ArnPrincipal(customEniTrunkingRole.roleArn)
    ),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AmazonEC2ContainerServiceforEC2Role'
        ),
      ],
    });
    this.ec2Role.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ecs:PutAccountSetting'],
        resources: ['*'],
      })
    );
    customEniTrunkingRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['sts:AssumeRole'],
        resources: [this.ec2Role.roleArn],
      })
    );

    // Custom resource to trigger the Lambda function
    const customEniTrunking = new cdk.CustomResource(this, 'CustomEniTrunking', {
      serviceToken: customEniTrunkingFunction.functionArn,
      properties: {
        Region: cdk.Stack.of(this).region,
        EC2Role: this.ec2Role.roleArn,
      },
    });
    customEniTrunking.node.addDependency(customEniTrunkingRole);

    // Output the EC2 role
    new cdk.CfnOutput(this, 'EC2RoleArn', {
      value: this.ec2Role.roleArn,
      description: 'The role used by EC2 instances in the cluster',
    });
  }
}
