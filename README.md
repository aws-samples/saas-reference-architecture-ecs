# Amazon ECS SaaS - Reference Architecture

**[Developer Documentation](DEVELOPER_GUIDE.md)**

## Introduction
Organizations are moving to the SaaS (Software-as-a-service) delivery model to achieve optimized cost, operational efficiency and overall agility in their software business. SaaS helps to onboard their customers (tenants) into a centrally hosted version of the solution, and manage them via a single pane of glass. These SaaS solutions allow the underneath infrastructure components to be shared across tenants, while demanding mechanisms that can implement the multi-tenancy in the architecture to preserve overall security, performance and other non-functional requirements demanded by the use-case. Often, these strategies and their implementation heavily depend on the underneath technologies and AWS managed services that are being used.

This github solution provides code samples, configurations and best practices that help to implement multi-tenant SaaS reference architecture leveraging Amazon Elastic Container Service (ECS).

The objective here is to dive deeper into design principals and implementation details in building ECS SaaS reference solution covering necessary technical aspects. We will discuss SaaS control plane functionalities with shared services such as tenant onboarding, user management, admin portals, along with the SaaS application plane capabilities such as ECS compute isolation strategies, request routing at scale, service discovery, storage isolation patterns, API throttling and usage plans, and different ways to ensure security and scalability.

## ECS SaaS Reference Solution Overview
The following diagram shows the high-level architecture of the solution that outlines the core components of ECS SaaS. It is a tier-based SaaS, and the three tiers represent three different tenant isolation strategies using Amazon ECS. This would help SaaS providers to have a wide range of technical options to model their SaaS solution based on their tiering requirements.

1. Basic Tier: Shared ECS Services across all the tenants (Pool model)
2. Advanced Tier : Shared ECS Cluster, dedicated ECS services per tenant (Silo model)
3. Premium Tier: Dedicated ECS Cluster per tenant (Silo model)

<p align="center">
<img src="images/archi-high-level.png" alt="High-level Architecture"/>
Fig 1: ECS SaaS - High-level infrastructure
</p>


This reference architecture adopts the latest [AWS SaaS Builder Toolkit](https://github.com/awslabs/sbt-aws) (SBT) that [AWS SaaS Factory](https://aws.amazon.com/partners/programs/saas-factory) has developed. SBT helps to extend the SaaS control plane services such as tenant onboarding, off-boarding, tenant and user management, billing, etc seamlessly into the solution. It also provides an event-based integration to the ECS application plane that enables bi-directional communication for SaaS operations. Read more about AWS SBT [here](https://github.com/awslabs/sbt-aws/blob/main/docs/public/README.md).


## Pre-requisites
This solution can be deployed via your local environment which is connected with your AWS account.

In your local environment, it needs some free storage for artifacts of CDK built. 

- This reference architecture uses Python. Ensure you have Python 3.11 or newer installed.
- Ensure you have [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-install.html) installed (latest version recommended).
- Ensure you have a [Docker](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-docker.html) compatible runtime running (e.g., Docker Desktop, Colima, or Rancher Desktop).
- Ensure you have the latest version of [AWS CDK CLI](https://docs.aws.amazon.com/cdk/latest/guide/cli.html) installed. Using an outdated version may cause deployment issues.
- Ensure that you have Node.js 22 (LTS) or newer.
- Ensure that you have Git installed.

## Deployment Steps

To deploy this ECS SaaS reference solution, you can run the below commands. Replace the ```<admin_email>``` with a real email address that will be used to create an admin user in the solution, and to share the admin credentials that allow to perform administrative tasks such as onboarding new tenants.


```bash
git clone this_repo_url
cd saas-reference-architecture-ecs/scripts
./build-application.sh 
./init-install.sh 
./sbt-install.sh <admin_email>
```

### build-application.sh
Builds Docker container images for the sample SaaS application microservices (order, product, user) and pushes them to Amazon ECR.

### init-install.sh
Deploys the core infrastructure and tenant templates:

**1. Provision Source Setup**
- Creates an S3 bucket to store the reference solution code
- Uploads source code used for dynamic tenant provisioning (Advanced/Premium tiers)

**2. CDK Stack: `shared-infra-stack`** (SharedInfraStack)
- Amazon VPC with 3 Availability Zones
- Application Load Balancers (ALB)
- API Gateway for tenant routing
- CloudFront distributions for admin and application sites
- DynamoDB table for tenant mapping
- S3 buckets for access logs

**3. CDK Stack: `tenant-template-stack-basic`** (TenantTemplateStack)
- ECS Cluster for Basic tier (pooled model)
- ECS Services: order, product, user microservices
- Shared resources across all Basic tier tenants

**4. CDK Stack: `tenant-template-stack-advanced`** (TenantTemplateStack)
- ECS Cluster for Advanced tier (silo model)
- Cluster only - services are provisioned dynamically during tenant onboarding

### sbt-install.sh
Deploys the SaaS control plane and application plane:

**1. CDK Stack: `controlplane-stack`** (ControlPlaneStack)
- AWS SaaS Builder Toolkit (SBT) control plane components
- Amazon Cognito for admin authentication
- EventBridge for tenant lifecycle events
- API Gateway for tenant management APIs
- Admin web UI deployment

**2. CDK Stack: `core-appplane-stack`** (CoreAppPlaneStack)
- SBT core application plane components
- AWS CodeBuild projects for tenant onboarding/offboarding
- EventBridge rules to trigger provisioning workflows
- Application web UI deployment
- Integration with control plane via EventBridge events


## Steps to Clean-up

Run the following script to clean up reference solution resources from your AWS account. Please make sure that [jq](https://jqlang.github.io/jq/download/) JSON processor installed in your environment before invoking below script.

```bash
cd scripts
./cleanup/cleanup.sh
```
## License

This library is licensed under the MIT-0 License. See the [LICENSE](LICENSE) file.

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.