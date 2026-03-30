-- Tenant database schema definition (PostgreSQL)
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
