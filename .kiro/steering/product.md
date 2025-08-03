# Product Overview

This is an Amazon ECS SaaS Reference Architecture that demonstrates multi-tenant SaaS implementation patterns using Amazon Elastic Container Service (ECS). The solution provides a comprehensive example of building scalable, secure SaaS applications with different tenant isolation strategies.

## Key Features

- **Multi-tier SaaS Architecture**: Three distinct tiers (Basic, Advanced, Premium) with different isolation strategies
- **AWS SaaS Builder Toolkit Integration**: Leverages SBT for control plane services like tenant onboarding/offboarding
- **Sample E-commerce Application**: Demonstrates real-world SaaS patterns with order, product, and user microservices
- **Multiple Database Support**: Supports both DynamoDB and MySQL for different isolation patterns
- **Comprehensive Admin Console**: Angular-based admin interface for tenant management

## Tenant Isolation Models

- **Basic Tier**: Shared ECS services across all tenants (Pool model)
- **Advanced Tier**: Dedicated ECS services per tenant in shared cluster (Silo model)  
- **Premium Tier**: Dedicated ECS cluster per tenant (Full Silo model)

## Target Use Cases

This reference architecture is designed for SaaS providers who need to:
- Implement secure multi-tenant isolation strategies
- Scale from shared to dedicated infrastructure based on tenant tiers
- Integrate with AWS managed services for identity, storage, and compute
- Follow AWS Well-Architected SaaS best practices