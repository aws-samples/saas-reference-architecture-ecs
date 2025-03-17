import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as cdk from 'aws-cdk-lib';


export interface ContainerInfo {
  name: string
  image: string
  memoryLimitMiB: number
  cpu: number
  containerPort: number
  policy?: string
  database?: {
    kind: string
    sortKey?: string,
    

  },
  portMappings: Array<{
    name: string, 
    containerPort: number
    appProtocol?: ecs.AppProtocol,
    protocol?: ecs.Protocol
  }>,
  environment: {
    TABLE_NAME: string,
    iam_arn?: string,
    resource?: string,
    proxy_endpoint?: string,
    cluster_endpoint_resource?:string
    namespace?: string,
  },
  healthCheck?: {
    command: string[],
    interval?: cdk.Duration,
    timeout?: cdk.Duration,
    retries?: number,
    startPeriod?: cdk.Duration
  }
}