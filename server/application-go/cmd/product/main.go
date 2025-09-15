package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
	"saas-ecs-microservices/pkg/auth"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
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
	client    *dynamodb.Client
	tableName string
}

var dbService *DynamoDBService

func initDynamoDB() error {
	cfg, err := config.LoadDefaultConfig(context.TODO())
	if err != nil {
		return err
	}

	tableName := getEnvOrDefault("TABLE_NAME", "product-table-name-basic")
	dbService = &DynamoDBService{
		client:    dynamodb.NewFromConfig(cfg),
		tableName: tableName,
	}
	return nil
}

func (db *DynamoDBService) getProducts(tenantID string) ([]Product, error) {
	input := &dynamodb.QueryInput{
		TableName:              aws.String(db.tableName),
		KeyConditionExpression: aws.String("tenantId=:t_id"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":t_id": &types.AttributeValueMemberS{Value: tenantID},
		},
	}

	result, err := db.client.Query(context.TODO(), input)
	if err != nil {
		return nil, err
	}

	var products []Product
	err = attributevalue.UnmarshalListOfMaps(result.Items, &products)
	return products, err
}

func (db *DynamoDBService) getProduct(tenantID, productID string) (*Product, error) {
	input := &dynamodb.QueryInput{
		TableName:              aws.String(db.tableName),
		KeyConditionExpression: aws.String("tenantId=:t_id AND productId=:p_id"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":t_id": &types.AttributeValueMemberS{Value: tenantID},
			":p_id": &types.AttributeValueMemberS{Value: productID},
		},
	}

	result, err := db.client.Query(context.TODO(), input)
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

func (db *DynamoDBService) putProduct(product Product) error {
	item, err := attributevalue.MarshalMap(product)
	if err != nil {
		return err
	}

	input := &dynamodb.PutItemInput{
		TableName: aws.String(db.tableName),
		Item:      item,
	}

	_, err = db.client.PutItem(context.TODO(), input)
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
		var productList []Product
		if dbService != nil {
			var err error
			productList, err = dbService.getProducts(tenantID)
			if err != nil {
				log.Printf("Error getting products: %v", err)
				productList = []Product{}
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
			if err := dbService.putProduct(product); err != nil {
				log.Printf("Error saving product: %v", err)
				http.Error(w, `{"error":"Failed to save product"}`, http.StatusInternalServerError)
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
			product, err = dbService.getProduct(tenantID, productID)
			if err != nil {
				log.Printf("Error getting product: %v", err)
				http.Error(w, `{"error":"Internal server error"}`, http.StatusInternalServerError)
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
		var product *Product
		if dbService != nil {
			var err error
			product, err = dbService.getProduct(tenantID, productID)
			if err != nil {
				log.Printf("Error getting product: %v", err)
				http.Error(w, `{"error":"Internal server error"}`, http.StatusInternalServerError)
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
			if err := dbService.putProduct(*product); err != nil {
				log.Printf("Error updating product: %v", err)
				http.Error(w, `{"error":"Failed to update product"}`, http.StatusInternalServerError)
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