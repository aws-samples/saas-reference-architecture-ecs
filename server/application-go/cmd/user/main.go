package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"saas-ecs-microservices/pkg/auth"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/cognitoidentityprovider"
	"github.com/aws/aws-sdk-go-v2/service/cognitoidentityprovider/types"
)

type User struct {
	Username string    `json:"username"`
	Email    string    `json:"email"`
	UserRole string    `json:"user_role"`
	Status   string    `json:"status"`
	Enabled  bool      `json:"enabled"`
	Created  time.Time `json:"created"`
	Modified time.Time `json:"modified"`
}

type UserDto struct {
	UserName  string `json:"userName"`
	UserEmail string `json:"userEmail"`
	UserRole  string `json:"userRole"`
}

type UpdateUserDto struct {
	UserEmail string `json:"userEmail"`
	UserRole  string `json:"userRole"`
}

type CognitoService struct {
	client     *cognitoidentityprovider.Client
	userPoolId string
}

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

func (c *CognitoService) ListUsersInGroup(ctx context.Context, tenantId string) ([]User, error) {
	input := &cognitoidentityprovider.ListUsersInGroupInput{
		UserPoolId: aws.String(c.userPoolId),
		GroupName:  aws.String(tenantId),
	}

	result, err := c.client.ListUsersInGroup(ctx, input)
	if err != nil {
		log.Printf("Error listing users in group: %v", err)
		return []User{}, nil // Return empty array instead of error
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

		// Extract attributes
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

	// Create group if not exists and add user to group
	groupInput := &cognitoidentityprovider.GetGroupInput{
		GroupName:  aws.String(tenantId),
		UserPoolId: aws.String(c.userPoolId),
	}

	_, err = c.client.GetGroup(ctx, groupInput)
	if err != nil {
		// Group doesn't exist, create it
		createGroupInput := &cognitoidentityprovider.CreateGroupInput{
			GroupName:   aws.String(tenantId),
			UserPoolId:  aws.String(c.userPoolId),
			Description: aws.String(tenantId + "'s group"),
			Precedence:  aws.Int32(0),
		}
		_, err = c.client.CreateGroup(ctx, createGroupInput)
		if err != nil {
			return err
		}
	}

	// Add user to group
	addToGroupInput := &cognitoidentityprovider.AdminAddUserToGroupInput{
		GroupName:  aws.String(tenantId),
		UserPoolId: aws.String(c.userPoolId),
		Username:   aws.String(userDto.UserName),
	}

	_, err = c.client.AdminAddUserToGroup(ctx, addToGroupInput)
	return err
}

func extractTenantFromToken(authHeader string) (string, string, error) {
	if authHeader == "" {
		return "", "", nil // No auth header, return empty
	}

	// Remove "Bearer " prefix
	token := strings.TrimPrefix(authHeader, "Bearer ")
	if token == authHeader {
		return "", "", nil // No Bearer prefix found
	}

	// Use auth package to validate JWT
	claims, err := auth.ValidateJWT(token)
	if err != nil {
		log.Printf("Error validating JWT: %v", err)
		return "", "", nil
	}

	return claims.TenantID, claims.Username, nil
}

var cognitoService *CognitoService

func main() {
	var err error
	cognitoService, err = NewCognitoService()
	if err != nil {
		log.Printf("Warning: Failed to initialize Cognito service: %v", err)
		log.Printf("User service will run with limited functionality")
	}

	mux := http.NewServeMux()
	handler := corsMiddleware(mux)

	mux.HandleFunc("/users/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok"}`))
	})

	mux.HandleFunc("/users", auth.JWTMiddleware(handleUsers))
	mux.HandleFunc("/users/", auth.JWTMiddleware(handleUserByID))

	port := getEnvOrDefault("PORT", "3010")
	log.Printf("User service starting on port %s", port)

	if err := http.ListenAndServe(":"+port, handler); err != nil {
		log.Fatal("Failed to start server:", err)
	}
}

func handleUsers(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// Get tenant info from JWT middleware
	tenantID := auth.GetTenantFromRequest(r)
	user := auth.GetUserFromRequest(r)
	
	log.Printf("Request from tenant: %s, user: %s", tenantID, user.Email)

	switch r.Method {
	case "GET":
		log.Printf("Getting All Users for Tenant: %s (requested by: %s)", tenantID, user.Email)

		var users []User
		if cognitoService != nil {
			var err error
			users, err = cognitoService.ListUsersInGroup(context.Background(), tenantID)
			if err != nil {
				log.Printf("Error getting users from Cognito: %v", err)
				users = []User{}
			}
		} else {
			users = []User{} // Empty array if Cognito not available
		}

		usersJSON, err := json.Marshal(users)
		if err != nil {
			log.Printf("JSON marshal error: %v", err)
			http.Error(w, `{"error":"Internal server error"}`, http.StatusInternalServerError)
			return
		}

		w.Write(usersJSON)

	case "POST":
		var userDto UserDto
		if err := json.NewDecoder(r.Body).Decode(&userDto); err != nil {
			http.Error(w, `{"error":"Invalid JSON"}`, http.StatusBadRequest)
			return
		}

		log.Printf("Creating user: %+v for tenant: %s", userDto, tenantID)

		if cognitoService != nil {
			err := cognitoService.CreateUser(context.Background(), userDto, tenantID)
			if err != nil {
				log.Printf("Error creating user in Cognito: %v", err)
				http.Error(w, `{"error":"Failed to create user"}`, http.StatusInternalServerError)
				return
			}
		}

		w.WriteHeader(http.StatusCreated)
		response := map[string]interface{}{
			"User": map[string]interface{}{
				"Username":   userDto.UserName,
				"UserStatus": "FORCE_CHANGE_PASSWORD",
				"Enabled":    true,
			},
		}
		responseJSON, _ := json.Marshal(response)
		w.Write(responseJSON)

	default:
		http.Error(w, `{"error":"Method not allowed"}`, http.StatusMethodNotAllowed)
	}
}

func handleUserByID(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	path := strings.TrimPrefix(r.URL.Path, "/users/")
	if path == "" {
		http.Error(w, `{"error":"Username required"}`, http.StatusBadRequest)
		return
	}

	switch r.Method {
	case "GET":
		http.Error(w, `{"error":"User not found"}`, http.StatusNotFound)

	case "PUT":
		var updateDto UpdateUserDto
		if err := json.NewDecoder(r.Body).Decode(&updateDto); err != nil {
			http.Error(w, `{"error":"Invalid JSON"}`, http.StatusBadRequest)
			return
		}

		updateJSON, _ := json.Marshal(updateDto)
		w.Write(updateJSON)

	case "DELETE":
		w.WriteHeader(http.StatusNoContent)

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