package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sts"
	"github.com/aws/aws-sdk-go-v2/service/sts/types"
)

type TokenVendingMachine struct {
	stsClient *sts.Client
	debug     bool
}

type Credentials struct {
	AccessKeyId     string `json:"AccessKeyId"`
	SecretAccessKey string `json:"SecretAccessKey"`
	SessionToken    string `json:"SessionToken"`
}

func NewTokenVendingMachine(debug bool) *TokenVendingMachine {
	cfg, err := config.LoadDefaultConfig(context.TODO())
	if err != nil {
		log.Printf("Failed to load AWS config: %v", err)
		return nil
	}

	return &TokenVendingMachine{
		stsClient: sts.NewFromConfig(cfg),
		debug:     debug,
	}
}

func (tvm *TokenVendingMachine) AssumeRole(jwtToken string, durationSeconds int32) (string, error) {
	if tvm.debug {
		log.Printf("🔐 TokenVendingMachine: Starting AssumeRole process")
	}

	// Extract tenant ID from JWT
	claims, err := ValidateJWT(jwtToken)
	if err != nil {
		return "", fmt.Errorf("failed to validate JWT: %v", err)
	}

	tenantId := claims.TenantID
	if tvm.debug {
		log.Printf("🔐 TokenVendingMachine: Extracted tenantId: %s", tenantId)
	}

	// Get ABAC role ARN from environment
	abacRoleArn := os.Getenv("IAM_ROLE_ARN")
	if abacRoleArn == "" {
		return "", fmt.Errorf("IAM_ROLE_ARN environment variable not set")
	}

	if tvm.debug {
		log.Printf("🔐 TokenVendingMachine: Using ABAC Role: %s", abacRoleArn)
	}

	// Create session name
	sessionName := fmt.Sprintf("TVM-Session-%s", tenantId)

	// Assume role with tenant tag
	input := &sts.AssumeRoleInput{
		RoleArn:         aws.String(abacRoleArn),
		RoleSessionName: aws.String(sessionName),
		DurationSeconds: aws.Int32(durationSeconds),
		Tags: []types.Tag{
			{
				Key:   aws.String("tenant"),  // ✅ Using correct key
				Value: aws.String(tenantId),
			},
		},
	}

	if tvm.debug {
		log.Printf("🔐 TokenVendingMachine: Calling AssumeRole with tenant tag: %s", tenantId)
	}

	result, err := tvm.stsClient.AssumeRole(context.TODO(), input)
	if err != nil {
		log.Printf("❌ TokenVendingMachine: AssumeRole failed: %v", err)
		return "", fmt.Errorf("failed to assume role: %v", err)
	}

	if tvm.debug {
		log.Printf("✅ TokenVendingMachine: AssumeRole successful for tenant: %s", tenantId)
	}

	// Convert to JSON
	creds := Credentials{
		AccessKeyId:     *result.Credentials.AccessKeyId,
		SecretAccessKey: *result.Credentials.SecretAccessKey,
		SessionToken:    *result.Credentials.SessionToken,
	}

	credsJson, err := json.Marshal(creds)
	if err != nil {
		return "", fmt.Errorf("failed to marshal credentials: %v", err)
	}

	return string(credsJson), nil
}