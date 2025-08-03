# Project Structure

## Root Level Organization

```
├── client/                 # Frontend applications
├── server/                 # Backend infrastructure and services
├── scripts/                # Deployment and utility scripts
├── images/                 # Documentation assets
└── docs/                   # Documentation files
```

## Client Applications (`client/`)

### AdminWeb-React (`client/AdminWeb-React/`)
React application for SaaS provider administration
```
src/
├── components/
│   └── Layout/             # Layout components
├── contexts/               # React contexts (Auth, etc.)
├── pages/
│   ├── Auth/               # Authentication pages
│   ├── Dashboard/          # Admin dashboard
│   └── Tenants/            # Tenant management
│       ├── TenantList.tsx  # Tenant listing
│       ├── TenantCreate.tsx # Tenant creation
│       └── TenantDetail.tsx # Tenant details
└── App.tsx                 # Main app component
```

### Application-React (`client/Application-React/`)
React SaaS application for end users
```
src/
├── components/
│   └── Layout/             # Layout components
├── contexts/               # React contexts (Auth, Tenant)
├── pages/
│   ├── Auth/               # Authentication pages
│   ├── Dashboard/          # User dashboard
│   ├── Error/              # Error pages (unauthorized, etc.)
│   ├── Orders/             # Order management
│   ├── Products/           # Product management
│   └── Users/              # User management
└── App.tsx                 # Main app component
```

## Server Infrastructure (`server/`)

### CDK Infrastructure (`server/lib/`)
```
lib/
├── bootstrap-template/     # Initial infrastructure templates
├── cdknag/                # CDK NAG compliance rules
├── interfaces/            # TypeScript interfaces
├── shared-infra/          # Shared infrastructure components
├── tenant-template/       # Tenant-specific infrastructure
└── utilities/             # Helper functions and utilities
```

### Application Services (`server/application/`)
```
├── libs/                   # Shared libraries
│   ├── auth/              # Authentication module
│   └── client-factory/    # AWS client factory
├── microservices/         # Business logic services
│   ├── order/             # Order management service
│   ├── product_dynamodb/  # Product service (DynamoDB)
│   ├── product_mysql/     # Product service (MySQL)
│   └── user/              # User management service
└── reverseproxy/          # Nginx reverse proxy configuration
```

## Key Architectural Patterns

### Microservices Structure
Each microservice follows NestJS conventions:
```
src/
├── main.ts                # Service entry point
└── <service>/
    ├── dto/               # Data Transfer Objects
    ├── entities/          # Data models
    ├── <service>.controller.ts
    ├── <service>.module.ts
    └── <service>.service.ts
```

### Infrastructure as Code
- **CDK Stacks**: Organized by concern (shared-infra, tenant-template, control-plane)
- **Environment-specific**: Configurations separated by stage (prod, dev)
- **Tier-based**: Different infrastructure patterns for Basic/Advanced/Premium tiers

### Multi-tenant Isolation Patterns
- **Pool Model**: Shared resources with logical isolation (Basic tier)
- **Silo Model**: Dedicated resources per tenant (Advanced/Premium tiers)
- **Bridge Model**: Hybrid approach for specific use cases

## Configuration Files

### Build Configuration
- `package.json`: Dependencies and scripts at each level
- `tsconfig.json`: TypeScript compilation settings
- `Dockerfile`: Container definitions for React applications
- `nginx.conf`: Nginx configuration for production builds
- `nest-cli.json`: NestJS CLI configuration

### Infrastructure Configuration
- `cdk.json`: CDK application configuration
- `service-info.json`: Service registry and configuration
- Dockerfile.*: Container definitions for each service

### Deployment Scripts (`scripts/`)
- `build-application.sh`: Builds and pushes Docker images
- `install.sh`: Deploys complete infrastructure
- `cleanup.sh`: Removes all deployed resources
- `provision-tenant.sh`: Onboards new tenants
- `deprovision-tenant.sh`: Removes tenants

## Naming Conventions

### Files and Directories
- **kebab-case**: For file and directory names
- **PascalCase**: For Angular components and services
- **camelCase**: For TypeScript variables and functions

### AWS Resources
- **Stack Names**: `<component>-<tier>-stack` (e.g., `tenant-template-basic-stack`)
- **Service Names**: `<service>-<tier>` (e.g., `product-basic`)
- **Resource Naming**: Consistent prefixing with environment and tier

### Database Schemas
- **DynamoDB**: Single table design with partition keys for tenant isolation
- **MySQL**: Schema-per-tenant pattern for Advanced tier isolation

## Development Workflow

1. **Infrastructure Changes**: Modify CDK code in `server/lib/`
2. **Service Changes**: Update microservices in `server/application/microservices/`
3. **Frontend Changes**: Update Angular apps in `client/`
4. **Build Process**: Use `scripts/build-application.sh` for containerization
5. **Deployment**: Use `scripts/install.sh` for full deployment