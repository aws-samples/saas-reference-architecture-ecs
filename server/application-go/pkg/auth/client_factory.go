package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"log"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
)

type ClientFactory struct{}

func NewClientFactory() *ClientFactory {
	return &ClientFactory{}
}

func (cf *ClientFactory) GetDynamoDBClient(tenantId, jwtToken string) (*dynamodb.Client, error) {
	log.Printf("🏭 ClientFactory: Creating DynamoDB client for tenant: %s", tenantId)

	// ✅ Use TokenVendingMachine for secure credential generation
	tvm := NewTokenVendingMachine(true)
	if tvm != nil {
		credsJson, err := tvm.AssumeRole(jwtToken, 3600)
		if err != nil {
			log.Printf("❌ TokenVendingMachine failed: %v", err)
			return nil, err
		}
		
		var creds Credentials
		if err := json.Unmarshal([]byte(credsJson), &creds); err != nil {
			return nil, fmt.Errorf("failed to unmarshal credentials: %v", err)
		}
		
		cfg, err := config.LoadDefaultConfig(context.TODO(),
			config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
				creds.AccessKeyId,
				creds.SecretAccessKey,
				creds.SessionToken,
			)),
		)
		if err != nil {
			return nil, err
		}
		
		log.Printf("✅ ClientFactory: Using TokenVendingMachine credentials")
		return dynamodb.NewFromConfig(cfg), nil
	}

	// Fallback to default ECS Task Role (should not happen in production)
	log.Printf("⚠️ FALLBACK: Using default ECS Task Role")
	cfg, err := config.LoadDefaultConfig(context.TODO())
	if err != nil {
		return nil, err
	}

	return dynamodb.NewFromConfig(cfg), nil
}