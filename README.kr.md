# Amazon ECS SaaS - Reference Architecture

**[Developer Documentation](DEVELOPER_GUIDE.md)**

## 소개
조직은 소프트웨어 비즈니스에서 최적화된 비용, 운영 효율성 및 전반적인 민첩성을 달성하기 위해 SaaS(Software-as-a-Service) 제공 모델로 이동하고 있습니다. SaaS는 고객(테넌트)을 솔루션의 중앙 호스팅 버전에 온보딩하고 단일 창을 통해 관리하는 데 도움이 됩니다. 이러한 SaaS 솔루션은 테넌트 간에 기본 인프라 구성 요소를 공유할 수 있게 하는 동시에 사용 사례에서 요구하는 전반적인 보안, 성능 및 기타 비기능적 요구 사항을 유지하기 위해 아키텍처에서 멀티테넌시를 구현할 수 있는 메커니즘을 요구합니다. 종종 이러한 전략과 구현은 사용 중인 기본 기술과 AWS 매니지드 서비스에 크게 의존합니다.

이 Github 솔루션은 Amazon Elastic Container Service(ECS)를 활용하여 멀티테넌트 SaaS 레퍼런스 아키텍처를 구현하는 데 도움이 되는 코드 샘플, 구성 및 모범 사례를 제공합니다.

여기서의 목표는 필요한 기술적 측면을 포함하는 ECS SaaS 레퍼런스 솔루션을 구축하는 데 있어 설계 원칙과 구현 세부 사항을 더 자세히 살펴보는 것입니다. 테넌트 온보딩, 사용자 관리, 관리자 포털과 같은 공유(Shared) 서비스와 함께 SaaS Control Plane 기능과 ECS 컴퓨팅 격리 전략, 대규모 요청 라우팅, 서비스 검색, 스토리지 격리 패턴, API 제한 및 Usage Plan과 같은 SaaS Application Plane 기능과 보안 및 확장성을 보장하는 다양한 방법에 대해 논의합니다.

## ECS SaaS 레퍼런스 솔루션 개요
다음 다이어그램은 ECS SaaS의 핵심 구성 요소를 개략적으로 설명하는 솔루션의 상위 수준 아키텍처를 보여줍니다. 이는 티어에 기반한 SaaS이며, 세 계층은 Amazon ECS를 사용하는 세 가지 다른 테넌트 격리 전략을 나타냅니다. 이를 통해 SaaS 프로바이더는 티어에 따른 요구 사항에 따라 SaaS 솔루션을 모델링하기 위한 광범위한 기술 옵션을 갖게 됩니다.

1. Basic 티어: 모든 테넌트에서 공유되는 ECS 서비스 (Pool 모델)
2. Advanced 티어 : 공유 ECS 클러스터, 테넌트당 전용 ECS 서비스 (Silo 모델)
3. Premium 티어: Dedicated ECS Cluster per tenant (Silo 모델)

<p align="center">
<img src="images/archi-high-level.png" alt="High-level Architecture"/>
Fig 1: ECS SaaS - High-level infrastructure
</p>


이 레퍼런스 아키텍처는 [AWS SaaS Factory](https://aws.amazon.com/partners/programs/saas-factory)에서 개발한 최신 [AWS SaaS Builder Toolkit](https://github.com/awslabs/sbt-aws)(SBT)을 채택합니다. SBT는 테넌트 온보딩, 오프보딩, 테넌트 및 사용자 관리, 청구 등과 같은 SaaS Control Plane 서비스를 솔루션으로 원활하게 확장하는 데 도움이 됩니다. 또한 SaaS 운영을 위한 양방향 통신을 가능하게 하는 ECS Application Plane에 이벤트 기반 통합을 제공합니다. AWS SBT에 대한 자세한 내용은 [여기](https://github.com/awslabs/sbt-aws/blob/main/docs/public/README.kr.md)에서 확인할 수 있습니다.

## 사전 요구사항
이 솔루션은 AWS 계정의 [AWS Cloud9](https://aws.amazon.com/pm/cloud9/) 환경을 통해 배포하거나 랩탑에서 직접 배포할 수 있습니다.

Cloud9를 사용하는 경우 최소 t3.large 인스턴스 크기를 사용하여 EC2에 `Amazon Linux 2023` AMI를 사용해야 합니다. 또한 `./scripts/resize-cloud9.sh` 스크립트를 사용하여 기본 EC2 인스턴스의 볼륨 크기를 50GB(기본 10GB 대신)로 늘립니다. 이는 솔루션을 빌드하는 데 충분한 컴퓨팅과 공간이 있는지 확인하기 위한 것입니다.

- 이 레퍼런스 아키텍처는 Python을 사용합니다. Python 3.8 이상이 설치되어 있는지 확인하세요.
- [AWS CLI 2.14](https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-install.html)의 같거나 상위버전이 설치되어 있는지 확인하세요.
- [Docker Engine](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-docker.html)이 설치되어 있는지 확인하세요.
- [AWS CDK CLI](https://docs.aws.amazon.com/cdk/latest/guide/cli.html)의 최신 버전이 설치되어 있는지 확인하세요. CDK의 릴리스 버전이 없으면 배포 문제가 발생합니다.
- Node 18 이상이 설치되어 있는지 확인하세요.
- Git이 설치되어 있는지 확인하세요.

## 배포 단계

이 ECS SaaS 레퍼런스 솔루션을 배포하려면 아래 명령을 실행할 수 있습니다. ```admin_email```을 솔루션에서 SaaS 프로바이더 관리자를 만들고 새 테넌트 온보딩과 같은 관리 작업을 수행할 수 있는 관리자 자격 증명을 공유하는 데 사용될 실제 이메일 주소로 바꾸세요.

```bash
git clone this_repo_url
cd saas-reference-architecture-ecs/scripts
./build-application.sh 
./install.sh admin_email 
```

```build-application.sh```는 Order, Product 및 User 마이크로서비스로 샘플 SaaS 애플리케이션의 Docker 이미지를 빌드하고 Amazon ECR에 푸시합니다.

그리고 ```install.sh```는 다음을 배포합니다:
 
- AWS 계정에서 AWS S3 버킷을 만들고 이 레퍼런스 솔루션 코드를 버킷에 푸시합니다.
- 프로비저닝하는 CDK 스택 `controlplane-stack`
  - 인프라가 테넌트를 프로비저닝/프로비저닝 해제할 수 있는 SaaS Builder Toolkit(SBT) Control Plane 구성 요소.
- 프로비저닝하는 CDK 스택 `coreappplane-stack`
  - Control Plane 메시지를 수신하면 임의의 작업을 정의하고 실행할 수 있는 선택적 유틸리티인 SaaS Builder Toolkit(SBT) Core Application Plane. 이 레퍼런스 솔루션은 이 유틸리티를 사용하여 테넌트를 온보딩 및 오프보딩하기 위한 AWS CodeBuild 프로젝트를 시작합니다.
- 프로비저닝하는 CDK 스택 `shared-infra-stack`
  - Amazon VPC, Amazon API Gateway 및 Load Balancer와 같은 공유 애플리케이션 인프라.
- 프로비저닝하는 CDK 스택 `tenant-template-stack`
  - `tenant-template-basic`: Basic 티어를 위한 ECS 클러스터 및 ECS 서비스 Order, Product 및 User 마이크로서비스를 설치합니다.
  - `tenant-template-advanced`: Advanced 티어를 위한 ECS 클러스터를 설치합니다.(마이크로 서비스들은 테넌트 온보딩시에 전용으로 설치됩니다.)

## 리소스 정리

다음 스크립트를 실행하여 AWS 계정에서 레퍼런스 솔루션 리소스를 정리하세요. 아래 스크립트를 호출하기 전에 환경에 [jq](https://jqlang.github.io/jq/download/) JSON 프로세서 도구가 설치되어 있는지 확인하세요.

```bash
cd scripts
./cleanup.sh
```
## 라이선스

이 라이브러리는 MIT-0 라이선스에 따라 라이선스가 부여됩니다. [LICENSE](LICENSE) 파일을 참조하세요.

## 보안

자세한 내용은 [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications)을 참조하세요.