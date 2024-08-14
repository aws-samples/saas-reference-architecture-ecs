import type * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { type ApiGateway } from './api-gateway';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { Construct } from 'constructs';
import { addTemplateTag } from '../utilities/helper-functions';

export interface ApiMethodsProps {
  serviceName: string
  apiGateway: ApiGateway
  nlb: elbv2.INetworkLoadBalancer
  vpcLink: apigateway.VpcLink
}

export class ApiMethods extends Construct {
  constructor (scope: Construct, id: string, props: ApiMethodsProps) {
    super(scope, id);
    addTemplateTag(this, 'ApiMethods');
    const integration = new apigateway.Integration({
      type: apigateway.IntegrationType.HTTP_PROXY,
      uri: `http://${props.nlb.loadBalancerDnsName}/${props.serviceName}`,
      integrationHttpMethod: 'ANY',
      options: {
        connectionType: apigateway.ConnectionType.VPC_LINK,
        vpcLink: props.vpcLink,
        requestParameters: {
          'integration.request.header.tenantPath': 'context.authorizer.tenantPath'
        }
      }
    });

    const integrationId = new apigateway.Integration({
      type: apigateway.IntegrationType.HTTP_PROXY,
      uri: `http://${props.nlb.loadBalancerDnsName}/${props.serviceName}/{id}`,
      integrationHttpMethod: 'ANY',
      options: {
        connectionType: apigateway.ConnectionType.VPC_LINK,
        vpcLink: props.vpcLink,
        requestParameters: {
          'integration.request.path.id': 'method.request.path.id',
          'integration.request.header.tenantPath': 'context.authorizer.tenantPath'
        }
      }
    });

    const apiGatewayResource = props.apiGateway.restApi.root.addResource(props.serviceName);

    apiGatewayResource.addMethod('GET', integration, {
      requestParameters: {
        'method.request.header.tenantPath': true
      }
    });

    apiGatewayResource.addMethod('POST', integration, {
      requestParameters: {
        'method.request.header.tenantPath': true
      }
    });

    const idResource = apiGatewayResource.addResource('{id}');
    idResource.addMethod('GET', integrationId, {
      requestParameters: {
        'method.request.path.id': true,
        'method.request.header.tenantPath': true
      }
    });

    idResource.addMethod('PUT', integrationId, {
      requestParameters: {
        'method.request.path.id': true,
        'method.request.header.tenantPath': true
      }
    });

    idResource.addMethod('DELETE', integrationId, {
      requestParameters: {
        'method.request.path.id': true,
        'method.request.header.tenantPath': true
      }
    });
  }
}
