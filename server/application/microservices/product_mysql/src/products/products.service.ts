import { HttpException, HttpStatus, Injectable, OnModuleDestroy } from '@nestjs/common';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { v4 as uuid } from 'uuid';
import * as mysql from 'mysql2/promise';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { Signer } from '@aws-sdk/rds-signer';
import * as fs from 'fs';
import * as path from 'path';

/**
 * IAM token lifetime is 15 minutes.
 * Cache connections for 14 minutes to allow a 1-minute buffer before token expiry.
 */
const CONNECTION_TTL_MS = 14 * 60 * 1000;

interface CachedConnection {
  connection: mysql.Connection;
  createdAt: number;
}

@Injectable()
export class ProductsService implements OnModuleDestroy {
  private readonly dbPort = 3306;
  private readonly sslCert: string;
  private readonly connectionCache = new Map<string, CachedConnection>();

  constructor() {
    // Load SSL certificate once at startup (fail fast if missing)
    const sslCertPath = path.join(__dirname, 'SSLCA.pem');
    if (!fs.existsSync(sslCertPath)) {
      throw new Error(`SSL certificate not found at ${sslCertPath}`);
    }
    this.sslCert = fs.readFileSync(sslCertPath, 'utf8');
  }

  /**
   * Cleanup all cached connections on application shutdown.
   * NestJS calls this when the module is destroyed (e.g., graceful shutdown).
   */
  async onModuleDestroy() {
    for (const [, cached] of this.connectionCache) {
      try {
        await cached.connection.end();
      } catch {
        // Connection may already be closed
      }
    }
    this.connectionCache.clear();
  }

  /**
   * Get or create a cached IAM-authenticated MySQL connection for a tenant.
   *
   * Flow:
   * 1. Check cache — if a valid (non-expired) connection exists, return it
   * 2. STS AssumeRole with a scoped-down session policy (rds-db:connect for this tenant's DB user only)
   * 3. Use the temporary credentials to generate an RDS IAM auth token via RDS Signer
   * 4. Create a MySQL connection using the IAM token as password (TLS required)
   * 5. Cache the connection with a TTL of 14 minutes (IAM token expires at 15 min)
   */
  private async getConnection(tenantName: string): Promise<mysql.Connection> {
    // Check cache for a valid connection
    const cached = this.connectionCache.get(tenantName);
    if (cached && (Date.now() - cached.createdAt) < CONNECTION_TTL_MS) {
      try {
        // Verify the connection is still alive
        await cached.connection.ping();
        return cached.connection;
      } catch {
        // Connection is dead, remove from cache and create a new one
        this.connectionCache.delete(tenantName);
      }
    }

    // Close expired connection if it exists
    if (cached) {
      try { await cached.connection.end(); } catch { /* ignore */ }
      this.connectionCache.delete(tenantName);
    }

    try {
      // ┌─────────────────────────────────────────────────────┐
      // │  WORKSHOP-TEST: Hardcoded tenant for error testing   │
      // │  Uncomment the line below to simulate access denied  │
      // │  tenantName = "adv_013";                             │
      // └─────────────────────────────────────────────────────┘

      const dbUser = `user_${tenantName}`;
      const database = `tenant_${tenantName}_db`;
      const iamArn = process.env['IAM_ARN'];
      const proxyEndpoint = process.env.PROXY_ENDPOINT;
      const region = process.env.AWS_REGION;
      const resource = process.env.CLUSTER_ENDPOINT_RESOURCE + dbUser;

      // Step 1: STS AssumeRole with scoped-down session policy
      // The session policy restricts rds-db:connect to only this tenant's DB user,
      // providing tenant-level isolation even though the base role allows wildcard access.
      const sessionPolicy = {
        Version: '2012-10-17',
        Statement: [{
          Effect: 'Allow',
          Action: 'rds-db:connect',
          Resource: resource,
        }],
      };

      const stsClient = new STSClient({ region });
      const assumeRoleResponse = await stsClient.send(new AssumeRoleCommand({
        RoleArn: iamArn,
        RoleSessionName: `tenant-${tenantName}`,
        Policy: JSON.stringify(sessionPolicy),
      }));

      const credentials = assumeRoleResponse.Credentials;

      // Step 2: Generate IAM auth token using the assumed role credentials
      // RDS Signer creates a short-lived token that acts as the MySQL password
      const signer = new Signer({
        region,
        hostname: proxyEndpoint,
        port: this.dbPort,
        username: dbUser,
        credentials: {
          accessKeyId: credentials.AccessKeyId,
          secretAccessKey: credentials.SecretAccessKey,
          sessionToken: credentials.SessionToken,
        },
      });

      const dbToken = await signer.getAuthToken();

      // Step 3: Create MySQL connection with IAM token as password
      // mysql_clear_password plugin is required for RDS Proxy IAM auth
      type AuthSwitchHandlerFunction = (data: any, cb: (code: null | Error, buff?: Buffer | string) => void) => void;
      const authSwitchHandler: AuthSwitchHandlerFunction = (data, cb) => {
        if (data.pluginName === 'mysql_clear_password') {
          cb(null, `${dbToken}\0`);
        } else {
          cb(new Error(`Authentication method '${data.pluginName}' is not supported`));
        }
      };

      const connection = await mysql.createConnection({
        host: proxyEndpoint,
        user: dbUser,
        ssl: { ca: this.sslCert },
        password: dbToken,
        database,
        authSwitchHandler,
      });

      // Cache the connection with creation timestamp
      this.connectionCache.set(tenantName, {
        connection,
        createdAt: Date.now(),
      });

      return connection;
    } catch (error) {
      console.error('Error creating IAM-authenticated connection:', error);
      throw new HttpException(
        { status: HttpStatus.INTERNAL_SERVER_ERROR, error: 'Database connection failed' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // Create Product
  async create(createProductDto: CreateProductDto, tenantId: string, tenantName: string) {
    const newProduct = {
      productId: uuid(),
      tenantId,
      ...createProductDto,
    };
    console.log('Creating product:', newProduct);

    try {
      const conn = await this.getConnection(tenantName);
      const query = `
        INSERT INTO products (productId, tenantId, name, price, sku, category)
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      const [result] = await conn.execute(query, [
        newProduct.productId, newProduct.tenantId,
        newProduct.name, newProduct.price,
        newProduct.sku, newProduct.category,
      ]);
      return result;
    } catch (error) {
      console.error('Create product error:', error);
      throw new HttpException(
        { status: HttpStatus.INTERNAL_SERVER_ERROR, error: 'Failed to create product' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // Find all products for a tenant
  async findAll(tenantId: string, tenantName: string) {
    console.log('Getting All Products for Tenant:', tenantId);

    try {
      const conn = await this.getConnection(tenantName);
      const query = `SELECT * FROM products`;
      const [rows] = await conn.execute(query);
      return rows;
    } catch (error) {
      console.error('Find all products error:', error);
      throw new HttpException(
        { status: HttpStatus.INTERNAL_SERVER_ERROR, error: 'Failed to retrieve products' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // Find one product by ID
  async findOne(id: string, tenantId: string, tenantName: string) {
    console.log('Getting Product:', id);

    try {
      const conn = await this.getConnection(tenantName);
      const query = `SELECT * FROM products WHERE tenantId = ? AND productId = ?`;
      const [rows] = await conn.execute(query, [tenantId, id.split(':')[1]]);
      return (rows as any[])[0] || null;
    } catch (error) {
      console.error('Find one product error:', error);
      throw new HttpException(
        { status: HttpStatus.INTERNAL_SERVER_ERROR, error: 'Failed to retrieve product' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // Update product
  async update(id: string, tenantId: string, tenantName: string, updateProductDto: UpdateProductDto) {
    console.log('Updating Product:', id);

    try {
      const conn = await this.getConnection(tenantName);
      const query = `
        UPDATE products
        SET name = ?, price = ?, sku = ?, category = ?
        WHERE tenantId = ? AND productId = ?
      `;
      const [result] = await conn.execute(query, [
        updateProductDto.name, updateProductDto.price,
        updateProductDto.sku, updateProductDto.category,
        tenantId, id.split(':')[1],
      ]);
      return result;
    } catch (error) {
      console.error('Update product error:', error);
      throw new HttpException(
        { status: HttpStatus.INTERNAL_SERVER_ERROR, error: 'Failed to update product' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
