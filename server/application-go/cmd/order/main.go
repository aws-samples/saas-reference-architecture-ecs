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

type Order struct {
	OrderID       string `json:"orderId" dynamodbav:"orderId"`
	TenantID      string `json:"tenantId" dynamodbav:"tenantId"`
	OrderName     string `json:"orderName" dynamodbav:"orderName"`
	OrderProducts string `json:"orderProducts" dynamodbav:"orderProducts"`
}

type OrderProductDto struct {
	ProductID string  `json:"productId"`
	Price     float64 `json:"price"`
	Quantity  int     `json:"quantity"`
}

type CreateOrderDto struct {
	OrderName     string           `json:"orderName"`
	OrderProducts []OrderProductDto `json:"orderProducts"`
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

	tableName := getEnvOrDefault("TABLE_NAME", "order-table-name-basic")
	dbService = &DynamoDBService{
		client:    dynamodb.NewFromConfig(cfg),
		tableName: tableName,
	}
	return nil
}

func (db *DynamoDBService) getOrders(tenantID string) ([]Order, error) {
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

	var orders []Order
	err = attributevalue.UnmarshalListOfMaps(result.Items, &orders)
	return orders, err
}

func (db *DynamoDBService) getOrder(tenantID, orderID string) (*Order, error) {
	input := &dynamodb.QueryInput{
		TableName:              aws.String(db.tableName),
		KeyConditionExpression: aws.String("tenantId=:t_id AND orderId=:o_id"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":t_id": &types.AttributeValueMemberS{Value: tenantID},
			":o_id": &types.AttributeValueMemberS{Value: orderID},
		},
	}

	result, err := db.client.Query(context.TODO(), input)
	if err != nil {
		return nil, err
	}

	if len(result.Items) == 0 {
		return nil, nil
	}

	var order Order
	err = attributevalue.UnmarshalMap(result.Items[0], &order)
	return &order, err
}

func (db *DynamoDBService) putOrder(order Order) error {
	item, err := attributevalue.MarshalMap(order)
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
	mux.HandleFunc("/orders/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok"}`))
	})

	// Protected endpoints with JWT authentication
	mux.HandleFunc("/orders", auth.JWTMiddleware(handleOrders))
	mux.HandleFunc("/orders/", auth.JWTMiddleware(handleOrderByID))

	port := getEnvOrDefault("PORT", "3010")
	log.Printf("Order service starting on port %s", port)
	
	if err := http.ListenAndServe(":"+port, handler); err != nil {
		log.Fatal("Failed to start server:", err)
	}
}

func handleOrders(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	
	tenantID := auth.GetTenantFromRequest(r)
	user := auth.GetUserFromRequest(r)
	
	log.Printf("Request from tenant: %s, user: %s", tenantID, user.Email)
	
	switch r.Method {
	case "GET":
		// Get all orders for tenant
		log.Printf("Get all orders for tenant: %s", tenantID)
		
		var orderList []Order
		if dbService == nil {
			log.Printf("CRITICAL: DynamoDB service not initialized")
			http.Error(w, `{"error":"Service unavailable"}`, http.StatusServiceUnavailable)
			return
		}
		
		var err error
		orderList, err = dbService.getOrders(tenantID)
		if err != nil {
			log.Printf("ERROR: Failed to get orders for tenant %s: %v", tenantID, err)
			http.Error(w, `{"error":"Failed to retrieve orders"}`, http.StatusInternalServerError)
			return
		}
		
		// Guarantee non-nil slice
		if orderList == nil {
			orderList = []Order{}
		}
		
		log.Printf("Returning %d orders", len(orderList))
		
		// Parse orderProducts for each order
		var responseOrders []map[string]interface{}
		for _, order := range orderList {
			var orderProducts []OrderProductDto
			if err := json.Unmarshal([]byte(order.OrderProducts), &orderProducts); err != nil {
				log.Printf("Error parsing orderProducts for order %s: %v", order.OrderID, err)
				orderProducts = []OrderProductDto{}
			}
			
			responseOrders = append(responseOrders, map[string]interface{}{
				"orderId":       order.OrderID,
				"tenantId":      order.TenantID,
				"orderName":     order.OrderName,
				"orderProducts": orderProducts,
			})
		}
		
		// Return as JSON string like NestJS
		ordersJSON, err := json.Marshal(responseOrders)
		if err != nil {
			log.Printf("JSON marshal error: %v", err)
			http.Error(w, `{"error":"Internal server error"}`, http.StatusInternalServerError)
			return
		}
		
		w.Write(ordersJSON)
		
	case "POST":
		// Create new order
		var createDto CreateOrderDto
		if err := json.NewDecoder(r.Body).Decode(&createDto); err != nil {
			http.Error(w, `{"error":"Invalid JSON"}`, http.StatusBadRequest)
			return
		}
		
		orderID := generateID()
		orderProductsJSON, _ := json.Marshal(createDto.OrderProducts)
		order := Order{
			OrderID:       orderID,
			TenantID:      tenantID,
			OrderName:     createDto.OrderName,
			OrderProducts: string(orderProductsJSON),
		}
		
		if dbService == nil {
			log.Printf("CRITICAL: DynamoDB service not initialized")
			http.Error(w, `{"error":"Service unavailable"}`, http.StatusServiceUnavailable)
			return
		}
		
		if err := dbService.putOrder(order); err != nil {
			log.Printf("ERROR: Failed to save order for tenant %s: %v", tenantID, err)
			http.Error(w, `{"error":"Failed to save order"}`, http.StatusInternalServerError)
			return
		}
		
		w.WriteHeader(http.StatusCreated)
		
		// Return response with orderProducts as array
		response := map[string]interface{}{
			"orderId":       order.OrderID,
			"tenantId":      order.TenantID,
			"orderName":     order.OrderName,
			"orderProducts": createDto.OrderProducts,
		}
		
		responseJSON, err := json.Marshal(response)
		if err != nil {
			log.Printf("JSON marshal error: %v", err)
			http.Error(w, `{"error":"Internal server error"}`, http.StatusInternalServerError)
			return
		}
		w.Write(responseJSON)
		
	default:
		http.Error(w, `{"error":"Method not allowed"}`, http.StatusMethodNotAllowed)
	}
}

func handleOrderByID(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	
	tenantID := auth.GetTenantFromRequest(r)
	
	// Extract ID from path
	path := strings.TrimPrefix(r.URL.Path, "/orders/")
	if path == "" {
		http.Error(w, `{"error":"Order ID required"}`, http.StatusBadRequest)
		return
	}
	
	// Handle NestJS ID format (tenantId:orderId)
	orderID := path
	if strings.Contains(path, ":") {
		parts := strings.Split(path, ":")
		if len(parts) > 1 {
			orderID = parts[1]
		}
	}
	
	switch r.Method {
	case "GET":
		// Get single order
		if dbService == nil {
			log.Printf("CRITICAL: DynamoDB service not initialized")
			http.Error(w, `{"error":"Service unavailable"}`, http.StatusServiceUnavailable)
			return
		}
		
		order, err := dbService.getOrder(tenantID, orderID)
		if err != nil {
			log.Printf("ERROR: Failed to get order %s for tenant %s: %v", orderID, tenantID, err)
			http.Error(w, `{"error":"Failed to retrieve order"}`, http.StatusInternalServerError)
			return
		}
		
		if order == nil {
			http.Error(w, `{"error":"Order not found"}`, http.StatusNotFound)
			return
		}
		
		// Parse orderProducts JSON string back to array for response
		var orderProducts []OrderProductDto
		if err := json.Unmarshal([]byte(order.OrderProducts), &orderProducts); err != nil {
			log.Printf("Error parsing orderProducts: %v", err)
			orderProducts = []OrderProductDto{}
		}
		
		// Create response with parsed orderProducts
		response := map[string]interface{}{
			"orderId":       order.OrderID,
			"tenantId":      order.TenantID,
			"orderName":     order.OrderName,
			"orderProducts": orderProducts,
		}
		
		responseJSON, err := json.Marshal(response)
		if err != nil {
			log.Printf("JSON marshal error: %v", err)
			http.Error(w, `{"error":"Internal server error"}`, http.StatusInternalServerError)
			return
		}
		w.Write(responseJSON)
		
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