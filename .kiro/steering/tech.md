# Technology Stack

## Core Technologies

### Backend

- **AWS CDK**: Infrastructure as Code using TypeScript
- **NestJS**: Node.js framework for microservices (order, product, user)
- **TypeScript**: Primary language for server-side code
- **Node.js**: Runtime environment (>=14.18 || >= 16.13)

### Frontend

- **React**: Two separate applications (AdminWeb-React, Application-React)
- **Material-UI (MUI)**: UI component library
- **TypeScript**: Frontend development language
- **React Router**: Client-side routing

### Infrastructure & AWS Services

- **Amazon ECS**: Container orchestration
- **Amazon ECR**: Container registry
- **AWS API Gateway**: API management with tier-based throttling
- **Amazon Cognito**: Authentication and user management
- **Amazon DynamoDB**: NoSQL database option
- **Amazon RDS (MySQL)**: Relational database option
- **Amazon CloudFront**: CDN for static content
- **Amazon S3**: Static website hosting
- **AWS Lambda**: Serverless functions
- **AWS CodeBuild**: CI/CD pipeline

## Build System & Package Management

### Server (CDK)

- **npm**: Package manager
- **TypeScript compiler**: Build process
- **ts-node**: TypeScript execution

### Application Services

- **npm/yarn**: Package management
- **NestJS CLI**: Application scaffolding and build
- **Docker**: Containerization

### Client Applications

- **Create React App**: Build and development tools
- **npm**: Package manager for both React applications
- **Material-UI**: Component library and theming

## Common Commands

### Initial Setup

```bash
# Build and deploy entire solution
cd scripts
./build-application.sh    # Builds Docker images and pushes to ECR
./install.sh <admin_email>  # Deploys infrastructure

# Database selection during build
# 1) DynamoDB (default)
# 2) MySQL (Advanced tier only)
```

### Development Commands

#### Server/CDK

```bash
cd server
npm install
npm run build          # Compile TypeScript
npm run watch          # Watch mode compilation
npm run cdk            # CDK commands
npx cdk deploy --all   # Deploy all stacks
```

#### Application Services

```bash
cd server/application
npm install
npm run build                    # Build all microservices
npm run start:order             # Start order service
npm run start:product           # Start product service
npm run start:user              # Start user service
```

#### Client Applications

```bash
# Admin Web React
cd client/AdminWeb-React
npm install
npm start              # Development server
npm run build          # Production build

# Application React
cd client/Application-React
npm install
npm start              # Development server
npm run build          # Production build
```

### Docker Commands

```bash
# Build service images (from server/application)
docker build -t <service> -f Dockerfile.<service> .

# ECR login
aws ecr get-login-password --region <region> | docker login --username AWS --password-stdin <account>.dkr.ecr.<region>.amazonaws.com
```

### Cleanup

```bash
cd scripts
./cleanup.sh           # Remove all deployed resources
```

## Environment Requirements

- **Python**: 3.8+ (for CDK and Lambda functions)
- **Node.js**: 18+
- **AWS CLI**: 2.14+
- **Docker Engine**: Latest version
- **AWS CDK CLI**: Latest version
- **Git**: Version control

## Database Configuration

The solution supports two database backends:

- **DynamoDB**: Default, fully managed NoSQL
- **MySQL**: RDS-based, supports schema-per-tenant isolation in Advanced tier

Database selection is made during the build process via interactive prompt.
