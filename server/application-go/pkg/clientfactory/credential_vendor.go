package clientfactory

import (
	"context"
	"encoding/json"
	"time"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sts"
)

type PolicyType string

const (
	DynamoDBLeadingKey PolicyType = "DynamoDBLeadingKey"
)

type CredentialConfig struct {
	PolicyType PolicyType            `json:"policyType"`
	Attributes map[string]interface{} `json:"attributes"`
}

type Credentials struct {
	AccessKeyId     string    `json:"AccessKeyId"`
	SecretAccessKey string    `json:"SecretAccessKey"`
	SessionToken    string    `json:"SessionToken"`
	Expiration      time.Time `json:"Expiration"`
}

type CredentialVendor struct {
	tenantId string
	stsClient *sts.Client
}

func NewCredentialVendor(tenantId string) (*CredentialVendor, error) {
	cfg, err := config.LoadDefaultConfig(context.TODO())
	if err != nil {
		return nil, err
	}

	return &CredentialVendor{
		tenantId:  tenantId,
		stsClient: sts.NewFromConfig(cfg),
	}, nil
}

func (cv *CredentialVendor) GetCredentials(credentialConfig CredentialConfig) (*Credentials, error) {
	// For now, return default credentials (in real implementation, this would use STS)
	// This is a simplified version - in production, you'd implement proper STS assume role
	cfg, err := config.LoadDefaultConfig(context.TODO())
	if err != nil {
		return nil, err
	}

	creds, err := cfg.Credentials.Retrieve(context.TODO())
	if err != nil {
		return nil, err
	}

	return &Credentials{
		AccessKeyId:     creds.AccessKeyID,
		SecretAccessKey: creds.SecretAccessKey,
		SessionToken:    creds.SessionToken,
		Expiration:      time.Now().Add(time.Hour),
	}, nil
}

func (cv *CredentialVendor) generatePolicyDocument(config CredentialConfig) string {
	switch config.PolicyType {
	case DynamoDBLeadingKey:
		tenant := config.Attributes["tenant"].(string)
		policy := map[string]interface{}{
			"Version": "2012-10-17",
			"Statement": []map[string]interface{}{
				{
					"Effect": "Allow",
					"Action": []string{
						"dynamodb:GetItem",
						"dynamodb:PutItem",
						"dynamodb:Query",
						"dynamodb:UpdateItem",
						"dynamodb:DeleteItem",
					},
					"Resource": "*",
					"Condition": map[string]interface{}{
						"ForAllValues:StringEquals": map[string]interface{}{
							"dynamodb:LeadingKeys": []string{tenant},
						},
					},
				},
			},
		}
		
		policyJson, _ := json.Marshal(policy)
		return string(policyJson)
	}
	
	return "{}"
}