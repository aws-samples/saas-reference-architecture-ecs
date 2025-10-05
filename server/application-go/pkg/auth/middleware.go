package auth

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
)

type Claims struct {
	TenantID string `json:"custom:tenantId"`
	UserRole string `json:"custom:userRole"`
	Email    string `json:"email"`
	Username string `json:"cognito:username"`
}

// Extract claims from JWT token without validation (for demo purposes)
func ValidateJWT(tokenString string) (*Claims, error) {
	log.Printf("Validating JWT token: [REDACTED]")
	
	// Split JWT token (header.payload.signature)
	parts := strings.Split(tokenString, ".")
	if len(parts) != 3 {
		log.Printf("CRITICAL: Invalid JWT format - parts: %d", len(parts))
		return nil, fmt.Errorf("invalid JWT format: expected 3 parts, got %d", len(parts))
	}

	// Decode payload (base64)
	log.Printf("Decoding JWT payload part: [REDACTED]")
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		log.Printf("Error decoding JWT payload with RawURL: %v", err)
		// Try standard base64 decoding
		payload, err = base64.StdEncoding.DecodeString(parts[1])
		if err != nil {
			log.Printf("CRITICAL: Error with standard base64 decoding: %v", err)
			return nil, fmt.Errorf("failed to decode JWT payload: %v", err)
		}
	}

	log.Printf("Decoded JWT payload: [REDACTED]")

	// Parse claims
	var rawClaims map[string]interface{}
	if err := json.Unmarshal(payload, &rawClaims); err != nil {
		log.Printf("CRITICAL: Error parsing JWT claims: %v", err)
		return nil, fmt.Errorf("failed to parse JWT claims: %v", err)
	}

	log.Printf("Raw JWT claims: [REDACTED]")

	// Extract specific fields
	claims := &Claims{}

	tenantId, hasTenantId := rawClaims["custom:tenantId"].(string)
	if !hasTenantId || tenantId == "" {
		log.Printf("CRITICAL: Missing or empty custom:tenantId in JWT claims")
		return nil, fmt.Errorf("missing custom:tenantId in JWT claims")
	}
	claims.TenantID = tenantId

	if userRole, ok := rawClaims["custom:userRole"].(string); ok {
		claims.UserRole = userRole
	} else {
		log.Printf("WARNING: Missing custom:userRole in JWT claims")
		claims.UserRole = "TenantUser" // default
	}

	if email, ok := rawClaims["email"].(string); ok {
		claims.Email = email
	} else {
		log.Printf("WARNING: Missing email in JWT claims")
		claims.Email = "unknown@example.com" // default
	}

	if username, ok := rawClaims["cognito:username"].(string); ok {
		claims.Username = username
	} else {
		log.Printf("WARNING: Missing cognito:username in JWT claims")
		claims.Username = "unknown-user" // default
	}

	log.Printf("SUCCESS: Extracted claims - TenantID: %s, Email: [REDACTED], UserRole: %s, Username: [REDACTED]", claims.TenantID, claims.UserRole)
	return claims, nil
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func JWTMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Skip auth for health check
		if r.URL.Path == "/health" || strings.HasSuffix(r.URL.Path, "/health") {
			next(w, r)
			return
		}

		// Get Authorization header
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			http.Error(w, `{"error":"Authorization header required"}`, http.StatusUnauthorized)
			return
		}

		// Extract Bearer token
		parts := strings.Split(authHeader, " ")
		if len(parts) != 2 || parts[0] != "Bearer" {
			http.Error(w, `{"error":"Invalid authorization header format"}`, http.StatusUnauthorized)
			return
		}

		token := parts[1]
		if token == "" {
			http.Error(w, `{"error":"Token required"}`, http.StatusUnauthorized)
			return
		}

		// Validate JWT token
		claims, err := ValidateJWT(token)
		if err != nil {
			http.Error(w, `{"error":"Invalid token"}`, http.StatusUnauthorized)
			return
		}

		// Add claims to request context
		r.Header.Set("X-Tenant-ID", claims.TenantID)
		r.Header.Set("X-User-Role", claims.UserRole)
		r.Header.Set("X-User-Email", claims.Email)
		r.Header.Set("X-Username", claims.Username)

		next(w, r)
	}
}

func GetTenantFromRequest(r *http.Request) string {
	return r.Header.Get("X-Tenant-ID")
}

func GetUserFromRequest(r *http.Request) *Claims {
	return &Claims{
		TenantID: r.Header.Get("X-Tenant-ID"),
		UserRole: r.Header.Get("X-User-Role"),
		Email:    r.Header.Get("X-User-Email"),
		Username: r.Header.Get("X-Username"),
	}
}