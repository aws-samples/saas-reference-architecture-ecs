package clientfactory

import (
	"context"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
)

type ClientFactory struct{}

func NewClientFactory() *ClientFactory {
	return &ClientFactory{}
}

func (cf *ClientFactory) GetClient(tenantId string, credentialConfig *CredentialConfig) (*dynamodb.Client, error) {
	credentialVendor, err := NewCredentialVendor(tenantId)
	if err != nil {
		return nil, err
	}

	// Use default credential config if not provided
	if credentialConfig == nil {
		credentialConfig = &CredentialConfig{
			PolicyType: DynamoDBLeadingKey,
			Attributes: map[string]interface{}{
				"tenant": tenantId,
			},
		}
	}

	creds, err := credentialVendor.GetCredentials(*credentialConfig)
	if err != nil {
		return nil, err
	}

	// Load default AWS config (includes region detection)
	cfg, err := config.LoadDefaultConfig(context.TODO())
	if err != nil {
		return nil, err
	}

	// Override with tenant-specific credentials
	cfg.Credentials = credentials.NewStaticCredentialsProvider(
		creds.AccessKeyId,
		creds.SecretAccessKey,
		creds.SessionToken,
	)

	return dynamodb.NewFromConfig(cfg), nil
}

func (cf *ClientFactory) Query(tenantId string, input *dynamodb.QueryInput) (*dynamodb.QueryOutput, error) {
	client, err := cf.GetClient(tenantId, nil)
	if err != nil {
		return nil, err
	}
	return client.Query(context.TODO(), input)
}

func (cf *ClientFactory) PutItem(tenantId string, input *dynamodb.PutItemInput) (*dynamodb.PutItemOutput, error) {
	client, err := cf.GetClient(tenantId, nil)
	if err != nil {
		return nil, err
	}
	return client.PutItem(context.TODO(), input)
}