package main

import (
	"fmt"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
)

type ProxyConfig struct {
	Namespace string
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

	// Health check endpoint
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok"}`))
	})

	// Dynamic service routing based on namespace
	mux.HandleFunc("/orders", createDynamicProxy(config, "orders-api"))
	mux.HandleFunc("/orders/", createDynamicProxy(config, "orders-api"))
	mux.HandleFunc("/products", createDynamicProxy(config, "products-api"))
	mux.HandleFunc("/products/", createDynamicProxy(config, "products-api"))
	mux.HandleFunc("/users", createDynamicProxy(config, "users-api"))
	mux.HandleFunc("/users/", createDynamicProxy(config, "users-api"))

	// Default handler for static content
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			w.Header().Set("Content-Type", "text/html")
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`<!DOCTYPE html>
<html>
<head>
    <title>SaaS ECS Reverse Proxy</title>
</head>
<body>
    <h1>SaaS ECS Reverse Proxy</h1>
    <p>Namespace: ` + config.Namespace + `</p>
    <p>Available endpoints:</p>
    <ul>
        <li>/health - Health check</li>
        <li>/products - Products API</li>
        <li>/orders - Orders API</li>
        <li>/users - Users API</li>
    </ul>
</body>
</html>`))
		} else {
			http.NotFound(w, r)
		}
	})

	// No global CORS middleware - handled in ModifyResponse
	handler := mux

	port := getEnvOrDefault("PORT", "80")
	log.Printf("Reverse proxy starting on port %s", port)
	log.Printf("Using namespace: %s", namespace)
	log.Printf("Service discovery pattern: {service}.%s.sc:3010", namespace)
	
	if err := http.ListenAndServe(":"+port, handler); err != nil {
		log.Fatal("Failed to start reverse proxy:", err)
	}
}

func createDynamicProxy(config *ProxyConfig, serviceName string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Validate HTTP method
		if !isValidMethod(r.Method) {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// Build dynamic service URL using namespace
		serviceURL := fmt.Sprintf("http://%s.%s.sc:3010", serviceName, config.Namespace)
		
		target, err := url.Parse(serviceURL)
		if err != nil {
			log.Printf("Invalid service URL: %s, error: %v", serviceURL, err)
			http.Error(w, "Service unavailable", http.StatusServiceUnavailable)
			return
		}

		// Create reverse proxy
		proxy := httputil.NewSingleHostReverseProxy(target)
		
		// Custom error handler
		proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
			log.Printf("Proxy error for %s: %v", serviceURL, err)
			// Set CORS headers even on error
			w.Header().Set("Access-Control-Allow-Origin", "*")
			http.Error(w, "Service unavailable", http.StatusServiceUnavailable)
		}
		
		// Backend always sets CORS headers, so no need to modify response
		// proxy.ModifyResponse = nil (default behavior - pass through backend response)

		// Set proxy headers (similar to nginx)
		originalDirector := proxy.Director
		proxy.Director = func(req *http.Request) {
			originalDirector(req)
			req.Header.Set("X-Forwarded-Proto", "http")
			req.Header.Set("X-Forwarded-Host", r.Host)
			req.Header.Set("X-Real-IP", getClientIP(r))
		}

		log.Printf("Proxying %s %s to %s", r.Method, r.URL.Path, serviceURL)
		proxy.ServeHTTP(w, r)
	}
}

func isValidMethod(method string) bool {
	validMethods := []string{"GET", "POST", "HEAD", "OPTIONS", "PUT", "DELETE"}
	for _, validMethod := range validMethods {
		if method == validMethod {
			return true
		}
	}
	return false
}

func getClientIP(r *http.Request) string {
	// Check X-Forwarded-For header first
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		ips := strings.Split(xff, ",")
		return strings.TrimSpace(ips[0])
	}
	
	// Check X-Real-IP header
	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return xri
	}
	
	// Fall back to RemoteAddr
	ip := r.RemoteAddr
	if colon := strings.LastIndex(ip, ":"); colon != -1 {
		ip = ip[:colon]
	}
	return ip
}



func getEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}