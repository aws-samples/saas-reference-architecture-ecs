-- Tenant database schema definition
-- Modify this file to change table structures for your application.
-- Each statement is separated by a semicolon and executed individually.

CREATE TABLE IF NOT EXISTS products (
    "productId" VARCHAR(36) PRIMARY KEY,
    "tenantId" VARCHAR(255),
    sku VARCHAR(255),
    category VARCHAR(255),
    name VARCHAR(255),
    price DECIMAL(10, 2)
);

CREATE TABLE IF NOT EXISTS notices (
    id BIGSERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    author VARCHAR(255) NOT NULL,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notices2 (
    id BIGSERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    author VARCHAR(255) NOT NULL,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);
