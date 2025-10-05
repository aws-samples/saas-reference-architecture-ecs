package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"saas-ecs-microservices/pkg/auth"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

type Product struct {
	ProductID string  `json:"productId" dynamodbav:"productId"`
	TenantID  string  `json:"tenantId" dynamodbav:"tenantId"`
	Name      string  `json:"name" dynamodbav:"name"`
	Price     float64 `json:"price" dynamodbav:"price"`
	Sku       string  `json:"sku" dynamodbav:"sku"`
	Category  string  `json:"category" dynamodbav:"category"`
}

type CreateProductDto struct {
	Name     string  `json:"name"`
	Price    float64 `json:"price"`
	Sku      string  `json:"sku"`
	Category string  `json:"category"`
}

type UpdateProductDto struct {
	Name     string  `json:"name"`
	Price    float64 `json:"price"`
	Sku      string  `json:"sku"`
	Category string  `json:"category"`
}

type DynamoDBService struct {
	clientFactory *auth.ClientFactory
	tableName     string
}

var dbService *DynamoDBService

func initDynamoDB() error {
	tableName := getEnvOrDefault("TABLE_NAME", "product-table-basic")
	dbService = &DynamoDBService{
		clientFactory: auth.NewClientFactory(),
		tableName:     tableName,
	}
	return nil
}

func (db *DynamoDBService) getProducts(tenantID, jwtToken string) ([]Product, error) {
	log.Printf("Getting All Products for Tenant: %s", tenantID)
	
	client, err := db.clientFactory.GetDynamoDBClient(tenantID, jwtToken)
	if err != nil {
		return nil, err
	}

	// VULNERABILITY DEMO CODE (commented out for production)
	// hackedTenantId := "f7b61bd7-23a4-4181-8432-5895ab49af04"
	// log.Printf("🚨 HACKING: Actually accessing tenant: %s (instead of %s)", hackedTenantId, tenantID)

	input := &dynamodb.QueryInput{
		TableName:              aws.String(db.tableName),
		KeyConditionExpression: aws.String("tenantId=:t_id"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":t_id": &types.AttributeValueMemberS{Value: tenantID}, // ✅ Using correct tenant ID
		 	// ":t_id": &types.AttributeValueMemberS{Value: hackedTenantId}, // 🚨 DEMO: Uncomment for vulnerability test
		},
	}

	result, err := client.Query(context.TODO(), input)
	if err != nil {
		return nil, err
	}

	var products []Product
	err = attributevalue.UnmarshalListOfMaps(result.Items, &products)
	return products, err
}

func (db *DynamoDBService) getProduct(tenantID, productID, jwtToken string) (*Product, error) {
	client, err := db.clientFactory.GetDynamoDBClient(tenantID, jwtToken)
	if err != nil {
		return nil, err
	}

	input := &dynamodb.QueryInput{
		TableName:              aws.String(db.tableName),
		KeyConditionExpression: aws.String("tenantId=:t_id AND productId=:p_id"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":t_id": &types.AttributeValueMemberS{Value: tenantID},
			":p_id": &types.AttributeValueMemberS{Value: productID},
		},
	}

	result, err := client.Query(context.TODO(), input)
	if err != nil {
		return nil, err
	}

	if len(result.Items) == 0 {
		return nil, nil
	}

	var product Product
	err = attributevalue.UnmarshalMap(result.Items[0], &product)
	return &product, err
}

func (db *DynamoDBService) putProduct(product Product, jwtToken string) error {
	client, err := db.clientFactory.GetDynamoDBClient(product.TenantID, jwtToken)
	if err != nil {
		return err
	}

	item, err := attributevalue.MarshalMap(product)
	if err != nil {
		return err
	}

	input := &dynamodb.PutItemInput{
		TableName: aws.String(db.tableName),
		Item:      item,
	}

	_, err = client.PutItem(context.TODO(), input)
	return err
}

func generateID() string {
	return strconv.FormatInt(time.Now().UnixNano(), 10)
}

func main() {
	if err := initDynamoDB(); err != nil {
		log.Printf("CRITICAL: Failed to initialize DynamoDB: %v", err)
		log.Fatal("Cannot start service without DynamoDB connection")
	}

	mux := http.NewServeMux()

	// CORS middleware
	handler := corsMiddleware(mux)

	// Health check endpoint (public - no auth required, same as NestJS)
	mux.HandleFunc("/products/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok"}`))
	})

	// Protected endpoints with JWT authentication
	mux.HandleFunc("/products", auth.JWTMiddleware(handleProducts))
	mux.HandleFunc("/products/", auth.JWTMiddleware(handleProductByID))

	port := getEnvOrDefault("PORT", "3010")
	log.Printf("Product service starting on port %s", port)
	
	if err := http.ListenAndServe(":"+port, handler); err != nil {
		log.Fatal("Failed to start server:", err)
	}
}

func handleProducts(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	
	tenantID := auth.GetTenantFromRequest(r)
	user := auth.GetUserFromRequest(r)
	
	log.Printf("Request from tenant: %s, user: %s", tenantID, user.Email)
	
	switch r.Method {
	case "GET":
		// Get all products for tenant
		log.Printf("Getting All Products for Tenant: %s", tenantID)
		var productList []Product
		if dbService != nil {
			var err error
			// Get JWT token from Authorization header
			authHeader := r.Header.Get("Authorization")
			jwtToken := strings.TrimPrefix(authHeader, "Bearer ")
			
			productList, err = dbService.getProducts(tenantID, jwtToken)
			if err != nil {
				log.Printf("Error getting products: %v", err)
				errorMsg := fmt.Sprintf(`{"error":"%s"}`, err.Error())
				http.Error(w, errorMsg, http.StatusInternalServerError)
				return
			}
		} else {
			productList = []Product{}
		}
		
		if productList == nil {
			productList = []Product{}
		}
		
		// Return as JSON string like NestJS
		productsJSON, _ := json.Marshal(productList)
		w.Write(productsJSON)
		
	case "POST":
		// Create new product
		var createDto CreateProductDto
		if err := json.NewDecoder(r.Body).Decode(&createDto); err != nil {
			http.Error(w, `{"error":"Invalid JSON"}`, http.StatusBadRequest)
			return
		}
		
		productID := generateID()
		product := Product{
			ProductID: productID,
			TenantID:  tenantID,
			Name:      createDto.Name,
			Price:     createDto.Price,
			Sku:       createDto.Sku,
			Category:  createDto.Category,
		}
		
		if dbService != nil {
			// Get JWT token from Authorization header
			authHeader := r.Header.Get("Authorization")
			jwtToken := strings.TrimPrefix(authHeader, "Bearer ")
			
			if err := dbService.putProduct(product, jwtToken); err != nil {
				log.Printf("Error saving product: %v", err)
				errorMsg := fmt.Sprintf(`{"error":"%s"}`, err.Error())
				http.Error(w, errorMsg, http.StatusInternalServerError)
				return
			}
		}
		
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(product)
		
	default:
		http.Error(w, `{"error":"Method not allowed"}`, http.StatusMethodNotAllowed)
	}
}

func handleProductByID(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	
	tenantID := auth.GetTenantFromRequest(r)
	
	// Extract ID from path
	path := strings.TrimPrefix(r.URL.Path, "/products/")
	if path == "" {
		http.Error(w, `{"error":"Product ID required"}`, http.StatusBadRequest)
		return
	}
	
	// Handle NestJS ID format (tenantId:productId)
	productID := path
	if strings.Contains(path, ":") {
		parts := strings.Split(path, ":")
		if len(parts) > 1 {
			productID = parts[1]
		}
	}
	
	switch r.Method {
	case "GET":
		// Get single product
		var product *Product
		if dbService != nil {
			var err error
			// Get JWT token from Authorization header
			authHeader := r.Header.Get("Authorization")
			jwtToken := strings.TrimPrefix(authHeader, "Bearer ")
			
			product, err = dbService.getProduct(tenantID, productID, jwtToken)
			if err != nil {
				log.Printf("Error getting product: %v", err)
				errorMsg := fmt.Sprintf(`{"error":"%s"}`, err.Error())
				http.Error(w, errorMsg, http.StatusInternalServerError)
				return
			}
		}
		
		if product == nil {
			http.Error(w, `{"error":"Product not found"}`, http.StatusNotFound)
			return
		}
		
		// Return as JSON string like NestJS
		productJSON, _ := json.Marshal(product)
		w.Write(productJSON)
		
	case "PUT":
		// Update product
		// Get JWT token from Authorization header
		authHeader := r.Header.Get("Authorization")
		jwtToken := strings.TrimPrefix(authHeader, "Bearer ")
		
		var product *Product
		if dbService != nil {
			var err error
			product, err = dbService.getProduct(tenantID, productID, jwtToken)
			if err != nil {
				log.Printf("Error getting product: %v", err)
				errorMsg := fmt.Sprintf(`{"error":"%s"}`, err.Error())
				http.Error(w, errorMsg, http.StatusInternalServerError)
				return
			}
		}
		
		if product == nil {
			http.Error(w, `{"error":"Product not found"}`, http.StatusNotFound)
			return
		}
		
		var updateDto UpdateProductDto
		if err := json.NewDecoder(r.Body).Decode(&updateDto); err != nil {
			http.Error(w, `{"error":"Invalid JSON"}`, http.StatusBadRequest)
			return
		}
		
		product.Name = updateDto.Name
		product.Price = updateDto.Price
		product.Sku = updateDto.Sku
		product.Category = updateDto.Category
		
		if dbService != nil {
			if err := dbService.putProduct(*product, jwtToken); err != nil {
				log.Printf("Error updating product: %v", err)
				errorMsg := fmt.Sprintf(`{"error":"%s"}`, err.Error())
				http.Error(w, errorMsg, http.StatusInternalServerError)
				return
			}
		}
		
		// Return as JSON string like NestJS
		updateJSON, _ := json.Marshal(updateDto)
		w.Write(updateJSON)
		
	default:
		http.Error(w, `{"error":"Method not allowed"}`, http.StatusMethodNotAllowed)
	}
}





func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		
		next.ServeHTTP(w, r)
	})
}

func getEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}