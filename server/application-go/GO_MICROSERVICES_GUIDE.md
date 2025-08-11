# Go 마이크로서비스 구조 및 소스 코드 가이드

## 📋 목차
1. [프로젝트 구조 개요](#프로젝트-구조-개요)
2. [Go 기본 개념](#go-기본-개념)
3. [공통 인증 미들웨어](#공통-인증-미들웨어)
4. [Product 마이크로서비스](#product-마이크로서비스)
5. [Order 마이크로서비스](#order-마이크로서비스)
6. [User 마이크로서비스](#user-마이크로서비스)
7. [Reverse Proxy 서비스](#reverse-proxy-서비스)
8. [빌드 및 배포](#빌드-및-배포)
9. [Go vs NestJS 비교](#go-vs-nestjs-비교)

---

## 프로젝트 구조 개요

```
server/application-go/
├── cmd/                    # 실행 가능한 애플리케이션들
│   ├── order/main.go      # Order 마이크로서비스
│   ├── product/main.go    # Product 마이크로서비스
│   ├── user/main.go       # User 마이크로서비스
│   └── rproxy/main.go     # Reverse Proxy 서비스
├── pkg/                   # 공유 라이브러리
│   └── auth/middleware.go # 인증 미들웨어
├── vendor/               # Go 의존성 (go mod vendor로 생성)
├── go.mod               # Go 모듈 정의
├── go.sum               # 의존성 체크섬
└── Dockerfile.*         # 각 서비스별 Docker 파일
```

### 🏗️ 아키텍처 패턴
- **마이크로서비스 아키텍처**: 각 서비스가 독립적으로 실행
- **멀티테넌트 SaaS**: 테넌트별로 데이터 격리
- **RESTful API**: HTTP 기반 API 제공
- **JWT 인증**: 토큰 기반 인증 시스템

---

## Go 기본 개념

### 📦 패키지 시스템
```go
package main  // 실행 가능한 프로그램의 진입점

import (
    "fmt"           // 표준 라이브러리
    "net/http"      // HTTP 서버/클라이언트
    "encoding/json" // JSON 처리
)
```

### 🔧 주요 Go 특징
- **정적 타입**: 컴파일 시 타입 검사
- **가비지 컬렉션**: 자동 메모리 관리
- **고루틴**: 경량 스레드로 동시성 처리
- **인터페이스**: 덕 타이핑 지원
- **포인터**: 메모리 주소 직접 접근 가능

---

## 공통 인증 미들웨어

### 📁 파일: `pkg/auth/middleware.go`

```go
package auth

import (
    "net/http"
    "strings"
)

// Claims 구조체: JWT 토큰에서 추출한 사용자 정보
type Claims struct {
    TenantID string `json:"custom:tenantId"` // 테넌트 ID
    UserRole string `json:"custom:userRole"` // 사용자 역할
    Email    string `json:"email"`           // 이메일
    Username string `json:"cognito:username"` // 사용자명
}
```

#### 🔐 JWT 검증 함수
```go
// ValidateJWT: JWT 토큰을 검증하고 Claims 반환
func ValidateJWT(tokenString string) (*Claims, error) {
    // 실제 구현에서는 JWT 라이브러리를 사용해 토큰 검증
    // 데모용으로 목 데이터 반환
    return &Claims{
        TenantID: "demo-tenant",
        UserRole: "TenantAdmin", 
        Email:    "demo@example.com",
        Username: "demo-user",
    }, nil
}
```

#### 🛡️ JWT 미들웨어
```go
// JWTMiddleware: HTTP 핸들러를 래핑하여 JWT 인증 추가
func JWTMiddleware(next http.HandlerFunc) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        // 헬스체크는 인증 생략
        if r.URL.Path == "/health" || strings.HasSuffix(r.URL.Path, "/health") {
            next(w, r)
            return
        }

        // Authorization 헤더 확인
        authHeader := r.Header.Get("Authorization")
        if authHeader == "" {
            http.Error(w, `{"error":"Authorization header required"}`, 
                      http.StatusUnauthorized)
            return
        }

        // Bearer 토큰 추출
        parts := strings.Split(authHeader, " ")
        if len(parts) != 2 || parts[0] != "Bearer" {
            http.Error(w, `{"error":"Invalid authorization header format"}`, 
                      http.StatusUnauthorized)
            return
        }

        // JWT 토큰 검증
        claims, err := ValidateJWT(parts[1])
        if err != nil {
            http.Error(w, `{"error":"Invalid token"}`, 
                      http.StatusUnauthorized)
            return
        }

        // 요청 헤더에 사용자 정보 추가
        r.Header.Set("X-Tenant-ID", claims.TenantID)
        r.Header.Set("X-User-Role", claims.UserRole)
        r.Header.Set("X-User-Email", claims.Email)
        r.Header.Set("X-Username", claims.Username)

        next(w, r) // 다음 핸들러 호출
    }
}
```

---

## Product 마이크로서비스

### 📁 파일: `cmd/product/main.go`

#### 📊 데이터 구조
```go
// Product: 제품 정보를 담는 구조체
type Product struct {
    ProductID string  `json:"productId"` // 제품 ID
    TenantID  string  `json:"tenantId"`  // 테넌트 ID (멀티테넌시)
    Name      string  `json:"name"`      // 제품명
    Price     float64 `json:"price"`     // 가격
    Sku       string  `json:"sku"`       // SKU 코드
    Category  string  `json:"category"`  // 카테고리
}

// CreateProductDto: 제품 생성 요청 데이터
type CreateProductDto struct {
    Name     string  `json:"name"`
    Price    float64 `json:"price"`
    Sku      string  `json:"sku"`
    Category string  `json:"category"`
}
```

#### 💾 인메모리 데이터 저장소
```go
// 테넌트별로 분리된 제품 데이터 저장
// map[tenantId]map[productId]Product 구조
var products = make(map[string]map[string]Product)
var productCounter = 1 // 제품 ID 생성용 카운터
```

#### 🚀 메인 함수
```go
func main() {
    mux := http.NewServeMux() // HTTP 라우터 생성

    // CORS 미들웨어 적용
    handler := corsMiddleware(mux)

    // 헬스체크 엔드포인트 (인증 불필요)
    mux.HandleFunc("/products/health", func(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("Content-Type", "application/json")
        w.WriteHeader(http.StatusOK)
        w.Write([]byte(`{"status":"ok"}`))
    })

    // 보호된 엔드포인트 (JWT 인증 필요)
    mux.HandleFunc("/products", auth.JWTMiddleware(handleProducts))
    mux.HandleFunc("/products/", auth.JWTMiddleware(handleProductByID))

    port := getEnvOrDefault("PORT", "3010")
    log.Printf("Product service starting on port %s", port)
    
    // HTTP 서버 시작
    if err := http.ListenAndServe(":"+port, handler); err != nil {
        log.Fatal("Failed to start server:", err)
    }
}
```

#### 📝 제품 목록/생성 핸들러
```go
func handleProducts(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")
    
    // JWT에서 테넌트 정보 추출
    tenantID := auth.GetTenantFromRequest(r)
    user := auth.GetUserFromRequest(r)
    
    log.Printf("Request from tenant: %s, user: %s", tenantID, user.Email)
    
    switch r.Method {
    case "GET":
        // 테넌트별 제품 목록 조회
        tenantProducts := products[tenantID]
        var productList []Product
        for _, product := range tenantProducts {
            productList = append(productList, product)
        }
        if productList == nil {
            productList = []Product{} // 빈 배열 보장
        }
        
        // JSON 응답
        productsJSON, _ := json.Marshal(productList)
        w.Write(productsJSON)
        
    case "POST":
        // 새 제품 생성
        var createDto CreateProductDto
        if err := json.NewDecoder(r.Body).Decode(&createDto); err != nil {
            http.Error(w, `{"error":"Invalid JSON"}`, http.StatusBadRequest)
            return
        }
        
        // 제품 ID 생성 및 제품 객체 생성
        productID := generateID()
        product := Product{
            ProductID: productID,
            TenantID:  tenantID,
            Name:      createDto.Name,
            Price:     createDto.Price,
            Sku:       createDto.Sku,
            Category:  createDto.Category,
        }
        
        // 테넌트별 맵 초기화 (필요시)
        if products[tenantID] == nil {
            products[tenantID] = make(map[string]Product)
        }
        
        // 제품 저장
        products[tenantID][productID] = product
        w.WriteHeader(http.StatusCreated)
        json.NewEncoder(w).Encode(product)
        
    default:
        http.Error(w, `{"error":"Method not allowed"}`, http.StatusMethodNotAllowed)
    }
}
```

#### 🔍 개별 제품 핸들러
```go
func handleProductByID(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")
    
    tenantID := auth.GetTenantFromRequest(r)
    
    // URL에서 제품 ID 추출
    path := strings.TrimPrefix(r.URL.Path, "/products/")
    if path == "" {
        http.Error(w, `{"error":"Product ID required"}`, http.StatusBadRequest)
        return
    }
    
    // NestJS 호환성을 위한 ID 형식 처리 (tenantId:productId)
    productID := path
    if strings.Contains(path, ":") {
        parts := strings.Split(path, ":")
        if len(parts) > 1 {
            productID = parts[1]
        }
    }
    
    switch r.Method {
    case "GET":
        // 제품 조회
        tenantProducts := products[tenantID]
        if tenantProducts == nil {
            http.Error(w, `{"error":"Product not found"}`, http.StatusNotFound)
            return
        }
        
        product, exists := tenantProducts[productID]
        if !exists {
            http.Error(w, `{"error":"Product not found"}`, http.StatusNotFound)
            return
        }
        
        productJSON, _ := json.Marshal(product)
        w.Write(productJSON)
        
    case "PUT":
        // 제품 수정 로직...
        
    default:
        http.Error(w, `{"error":"Method not allowed"}`, http.StatusMethodNotAllowed)
    }
}
```

---

## Order 마이크로서비스

### 📁 파일: `cmd/order/main.go`

#### 📊 데이터 구조
```go
// Order: 주문 정보
type Order struct {
    OrderID       string           `json:"orderId"`
    TenantID      string           `json:"tenantId"`
    OrderName     string           `json:"orderName"`
    OrderProducts []OrderProductDto `json:"orderProducts"`
}

// OrderProductDto: 주문 내 제품 정보
type OrderProductDto struct {
    ProductID string  `json:"productId"`
    Price     float64 `json:"price"`
    Quantity  int     `json:"quantity"`
}
```

#### 💾 데이터 저장 및 핸들러
```go
// 테넌트별 주문 데이터 저장
var orders = make(map[string]map[string]Order)
var orderCounter = 1

func handleOrders(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")
    
    tenantID := auth.GetTenantFromRequest(r)
    user := auth.GetUserFromRequest(r)
    
    switch r.Method {
    case "GET":
        // 테넌트별 주문 목록 조회
        tenantOrders := orders[tenantID]
        var orderList []Order
        
        if tenantOrders != nil {
            for _, order := range tenantOrders {
                orderList = append(orderList, order)
            }
        }
        
        if orderList == nil {
            orderList = []Order{} // 빈 배열 보장
        }
        
        ordersJSON, err := json.Marshal(orderList)
        if err != nil {
            http.Error(w, `{"error":"Internal server error"}`, 
                      http.StatusInternalServerError)
            return
        }
        
        w.Write(ordersJSON)
        
    case "POST":
        // 새 주문 생성
        var createDto CreateOrderDto
        if err := json.NewDecoder(r.Body).Decode(&createDto); err != nil {
            http.Error(w, `{"error":"Invalid JSON"}`, http.StatusBadRequest)
            return
        }
        
        orderID := generateID()
        order := Order{
            OrderID:       orderID,
            TenantID:      tenantID,
            OrderName:     createDto.OrderName,
            OrderProducts: createDto.OrderProducts,
        }
        
        // 테넌트별 맵 초기화
        if orders[tenantID] == nil {
            orders[tenantID] = make(map[string]Order)
        }
        
        orders[tenantID][orderID] = order
        w.WriteHeader(http.StatusCreated)
        
        orderJSON, _ := json.Marshal(order)
        w.Write(orderJSON)
    }
}
```

---

## User 마이크로서비스

### 📁 파일: `cmd/user/main.go`

#### 🔧 AWS Cognito 통합
```go
import (
    "github.com/aws/aws-sdk-go-v2/config"
    "github.com/aws/aws-sdk-go-v2/service/cognitoidentityprovider"
)

// CognitoService: AWS Cognito 클라이언트 래퍼
type CognitoService struct {
    client     *cognitoidentityprovider.Client
    userPoolId string
}

// NewCognitoService: Cognito 서비스 초기화
func NewCognitoService() (*CognitoService, error) {
    cfg, err := config.LoadDefaultConfig(context.TODO())
    if err != nil {
        return nil, err
    }

    client := cognitoidentityprovider.NewFromConfig(cfg)
    userPoolId := getEnvOrDefault("COGNITO_USER_POOL_ID", "")

    return &CognitoService{
        client:     client,
        userPoolId: userPoolId,
    }, nil
}
```

#### 👥 사용자 관리 기능
```go
// ListUsersInGroup: 테넌트 그룹의 사용자 목록 조회
func (c *CognitoService) ListUsersInGroup(ctx context.Context, tenantId string) ([]User, error) {
    input := &cognitoidentityprovider.ListUsersInGroupInput{
        UserPoolId: aws.String(c.userPoolId),
        GroupName:  aws.String(tenantId), // 테넌트 ID를 그룹명으로 사용
    }

    result, err := c.client.ListUsersInGroup(ctx, input)
    if err != nil {
        log.Printf("Error listing users in group: %v", err)
        return []User{}, nil // 에러 시 빈 배열 반환
    }

    var users []User
    for _, cognitoUser := range result.Users {
        user := User{
            Username: aws.ToString(cognitoUser.Username),
            Status:   string(cognitoUser.UserStatus),
            Enabled:  cognitoUser.Enabled,
            Created:  aws.ToTime(cognitoUser.UserCreateDate),
            Modified: aws.ToTime(cognitoUser.UserLastModifiedDate),
        }

        // 사용자 속성 추출
        for _, attr := range cognitoUser.Attributes {
            switch aws.ToString(attr.Name) {
            case "email":
                user.Email = aws.ToString(attr.Value)
            case "custom:userRole":
                user.UserRole = aws.ToString(attr.Value)
            }
        }

        users = append(users, user)
    }

    return users, nil
}
```

#### 🆕 사용자 생성
```go
// CreateUser: 새 사용자 생성 및 테넌트 그룹에 추가
func (c *CognitoService) CreateUser(ctx context.Context, userDto UserDto, tenantId string) error {
    input := &cognitoidentityprovider.AdminCreateUserInput{
        UserPoolId: aws.String(c.userPoolId),
        Username:   aws.String(userDto.UserName),
        DesiredDeliveryMediums: []types.DeliveryMediumType{
            types.DeliveryMediumTypeEmail,
        },
        UserAttributes: []types.AttributeType{
            {
                Name:  aws.String("email"),
                Value: aws.String(userDto.UserEmail),
            },
            {
                Name:  aws.String("email_verified"),
                Value: aws.String("true"),
            },
            {
                Name:  aws.String("custom:userRole"),
                Value: aws.String(userDto.UserRole),
            },
            {
                Name:  aws.String("custom:tenantId"),
                Value: aws.String(tenantId),
            },
        },
    }

    _, err := c.client.AdminCreateUser(ctx, input)
    if err != nil {
        return err
    }

    // 테넌트 그룹에 사용자 추가
    addToGroupInput := &cognitoidentityprovider.AdminAddUserToGroupInput{
        GroupName:  aws.String(tenantId),
        UserPoolId: aws.String(c.userPoolId),
        Username:   aws.String(userDto.UserName),
    }

    _, err = c.client.AdminAddUserToGroup(ctx, addToGroupInput)
    return err
}
```

---

## Reverse Proxy 서비스

### 📁 파일: `cmd/rproxy/main.go`

#### 🔄 프록시 설정
```go
type ProxyConfig struct {
    Namespace string // ECS 서비스 디스커버리 네임스페이스
}

func main() {
    namespace := os.Getenv("NAMESPACE")
    if namespace == "" {
        log.Fatal("NAMESPACE environment variable is required")
    }

    config := &ProxyConfig{
        Namespace: namespace,
    }

    mux := http.NewServeMux()

    // 각 마이크로서비스로의 라우팅 설정
    mux.HandleFunc("/orders", createDynamicProxy(config, "orders-api"))
    mux.HandleFunc("/orders/", createDynamicProxy(config, "orders-api"))
    mux.HandleFunc("/products", createDynamicProxy(config, "products-api"))
    mux.HandleFunc("/products/", createDynamicProxy(config, "products-api"))
    mux.HandleFunc("/users", createDynamicProxy(config, "users-api"))
    mux.HandleFunc("/users/", createDynamicProxy(config, "users-api"))

    port := getEnvOrDefault("PORT", "80")
    log.Printf("Reverse proxy starting on port %s", port)
    log.Printf("Service discovery pattern: {service}.%s.sc:3010", namespace)
    
    if err := http.ListenAndServe(":"+port, mux); err != nil {
        log.Fatal("Failed to start reverse proxy:", err)
    }
}
```

#### 🎯 동적 프록시 생성
```go
func createDynamicProxy(config *ProxyConfig, serviceName string) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        // HTTP 메서드 검증
        if !isValidMethod(r.Method) {
            http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
            return
        }

        // ECS 서비스 디스커버리 URL 생성
        // 형식: http://service-name.namespace.sc:3010
        serviceURL := fmt.Sprintf("http://%s.%s.sc:3010", serviceName, config.Namespace)
        
        target, err := url.Parse(serviceURL)
        if err != nil {
            log.Printf("Invalid service URL: %s, error: %v", serviceURL, err)
            http.Error(w, "Service unavailable", http.StatusServiceUnavailable)
            return
        }

        // Go 표준 라이브러리의 리버스 프록시 생성
        proxy := httputil.NewSingleHostReverseProxy(target)
        
        // 에러 핸들러 설정
        proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
            log.Printf("Proxy error for %s: %v", serviceURL, err)
            http.Error(w, "Service unavailable", http.StatusServiceUnavailable)
        }

        // 프록시 헤더 설정 (nginx와 유사)
        originalDirector := proxy.Director
        proxy.Director = func(req *http.Request) {
            originalDirector(req)
            req.Header.Set("X-Forwarded-Proto", "http")
            req.Header.Set("X-Forwarded-Host", r.Host)
            req.Header.Set("X-Real-IP", getClientIP(r))
        }

        log.Printf("Proxying %s %s to %s", r.Method, r.URL.Path, serviceURL)
        proxy.ServeHTTP(w, r) // 실제 프록시 실행
    }
}
```

#### 🌐 CORS 처리
```go
func corsMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        // CORS 헤더 설정
        w.Header().Set("Access-Control-Allow-Origin", "*")
        w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
        
        // OPTIONS 요청 (preflight) 처리
        if r.Method == "OPTIONS" {
            w.WriteHeader(http.StatusNoContent)
            return
        }
        
        next.ServeHTTP(w, r) // 다음 핸들러 호출
    })
}
```

---

## 빌드 및 배포

### 📁 파일: `scripts/build-application-go.sh`

#### 🐳 Docker 빌드 최적화
```bash
# BuildKit 활성화로 빌드 속도 향상
export DOCKER_BUILDKIT=1
export BUILDKIT_PROGRESS=auto
export DOCKER_DEFAULT_PLATFORM=linux/amd64

# Go 프록시 설정으로 일관된 빌드
export GOPROXY=direct
export GOSUMDB=off
```

#### 📦 Go 모듈 관리
```bash
# Go 모듈 정리 및 벤더 디렉토리 생성
echo "Initializing Go modules..."
go mod tidy    # 불필요한 의존성 제거, 누락된 의존성 추가

echo "Creating vendor directory..."
go mod vendor  # 모든 의존성을 vendor/ 디렉토리에 복사
```

#### 🚀 서비스별 빌드 및 배포
```bash
deploy_service() {
    local SERVICE_NAME="$1"
    local VERSION="$2"
    
    local SERVICEECR="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/$SERVICE_NAME"
    
    # Docker 이미지 빌드
    docker build \
        --build-arg GOPROXY=direct \
        --build-arg GOSUMDB=off \
        --progress=auto --no-cache \
        -t $SERVICEECR \
        -f Dockerfile.$SERVICE_NAME .
    
    # 태그 지정 및 ECR 푸시
    docker tag "$SERVICEECR" "$SERVICEECR:$VERSION"
    docker push "$SERVICEECR:$VERSION"
}
```

---

## Go vs NestJS 비교

### 📊 성능 비교

| 항목 | Go | NestJS |
|------|----|---------| 
| **이미지 크기** | 8-15MB | ~55MB |
| **메모리 사용량** | 10-20MB | 50-100MB |
| **시작 시간** | <1초 | 2-5초 |
| **처리량** | 높음 | 중간 |
| **CPU 사용률** | 낮음 | 높음 |

### 🔧 개발 경험

#### Go 장점
- **단순함**: 문법이 간단하고 명확
- **성능**: 컴파일된 바이너리로 빠른 실행
- **동시성**: 고루틴으로 쉬운 병렬 처리
- **배포**: 단일 바이너리로 간편한 배포

#### Go 단점
- **생태계**: NestJS 대비 라이브러리 부족
- **학습곡선**: 포인터, 인터페이스 개념 필요
- **제네릭**: 최근 추가되어 아직 성숙하지 않음

### 💡 언제 Go를 선택할까?

✅ **Go 선택 시기**
- 높은 성능이 필요한 마이크로서비스
- 컨테이너 환경에서 리소스 효율성 중요
- 단순한 API 서버 구축
- 동시성 처리가 많은 서비스

❌ **NestJS 선택 시기**
- 복잡한 비즈니스 로직
- 풍부한 생태계 활용 필요
- 빠른 프로토타이핑
- TypeScript 기반 개발팀

---

## 🎯 학습 포인트

### 1. **Go 기본 문법**
- 패키지 시스템과 import
- 구조체와 메서드
- 인터페이스와 덕 타이핑
- 에러 처리 패턴

### 2. **HTTP 서버 구축**
- `net/http` 패키지 활용
- 미들웨어 패턴
- JSON 처리
- 라우팅 구현

### 3. **마이크로서비스 패턴**
- 서비스 간 통신
- 인증/인가 처리
- 에러 핸들링
- 로깅과 모니터링

### 4. **AWS 통합**
- AWS SDK 사용법
- Cognito 연동
- ECS 서비스 디스커버리
- ECR 이미지 관리

---

## 📚 추가 학습 자료

1. **Go 공식 문서**: https://golang.org/doc/
2. **Go by Example**: https://gobyexample.com/
3. **AWS SDK for Go**: https://aws.github.io/aws-sdk-go-v2/
4. **마이크로서비스 패턴**: https://microservices.io/

---

*이 가이드는 Go 마이크로서비스 개발의 기초를 다루며, 실제 프로덕션 환경에서는 추가적인 보안, 모니터링, 테스팅 고려사항이 필요합니다.*