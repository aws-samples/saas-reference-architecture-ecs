import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { v4 as uuid } from 'uuid';
import * as mysql from 'mysql2/promise';
import * as AWS from 'aws-sdk'; // AWS SDK for accessing STS, Secrets Manager
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class ProductsService {
  private pool: mysql.Pool;
  private dbPort = 3306;

  constructor () {
    this.pool = null; // Initialize later with IAM-based authentication
  }

  // Function to create IAM-authenticated connection pool
  private async getConnection (tenantName: string) {
    if (this.pool) return this.pool;

    try {
      // Load SSL certificate for RDS Proxy (pre-downloaded, stored in /src)
      const sslCertPath = path.resolve(__dirname, '/app/microservices/product/src/SSLCA.pem');
      if (!fs.existsSync(sslCertPath)) {
        throw new Error(`SSL certificate not found at ${sslCertPath}`);
      }
     
      // tenantName = "adv_013" ==> Hard coding error test 
      // Error creating IAM-authenticated connection pool Error: Access denied for user 'user_adv_013'@'10.0.80.72' (using password: YES)
      
      var dbUser = `user_${tenantName}`;
      // var dbUser = 'user100';
      // database
      var database = `tenant_${tenantName}_db`;

      var resource = process.env.CLUSTER_ENDPOINT_RESOURCE + dbUser; 
      // console.log('resource: '+resource);
      //--> arn:aws:rds-db:us-west-2:033185771327:dbuser:prx-032c9bc28b5cc4ae7/user_${tenantName}
      var iam_arn = process.env["IAM_ARN"];
      // console.log('iam_arn: '+iam_arn);
      // console.log('process.env.PROXY_ENDPOINT==>:' + process.env.PROXY_ENDPOINT);

      var session_policy = {
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: "rds-db:connect",
            Resource: resource,
          },
        ],
      };

      let dbToken = await new Promise<string>((resolve, reject) => {
        let sts = new AWS.STS({});
    
        sts.assumeRole(
          {
            RoleArn: iam_arn,
            RoleSessionName: "session",
            Policy: JSON.stringify(session_policy),
          },
          (err, iamCredentialResponse) => {
            if (err) {
              return reject(err);
            }
    
            let iamCredentials = new AWS.Credentials({
              accessKeyId: iamCredentialResponse.Credentials.AccessKeyId,
              secretAccessKey: iamCredentialResponse.Credentials.SecretAccessKey,
              sessionToken: iamCredentialResponse.Credentials.SessionToken,
            });
    
            let signer = new AWS.RDS.Signer({
              credentials: iamCredentials,
            });
    
            signer.getAuthToken(
              {
                region: process.env.AWS_REGION,
                hostname: process.env.PROXY_ENDPOINT,
                port: this.dbPort,
                username: dbUser,
              },
              (err, token) => {
                if (err) {
                  reject(err);
                } else {
                  resolve(token);
                }
              }
            );
          }
        );
      });
      // console.log('dbToken==>: '+dbToken);

      type AuthSwitchHandlerFunction = (data: any, cb: (code: null | Error, buff?: Buffer | string) => void) => void;
      
      const authSwitchHandler: AuthSwitchHandlerFunction = (data, cb) => {
        if (data.pluginName === 'mysql_clear_password') {
          const token = `${dbToken}\0`;
          cb(null, token);
        } else {
          cb(new Error(`Authentication method '${data.pluginName}' is not supported`));
        }
      };
        const poolOptions = {
          host: process.env.PROXY_ENDPOINT,
          user: dbUser,
          ssl: { 
            ca: fs.readFileSync('/app/microservices/product/src/SSLCA.pem', "utf8"),
            // flags: "SSL_VERIFY_SERVER_CERT",
          }, // Load SSL certificate from file
          password: dbToken, // Use IAM token as password
          database: database, // e.g., "products_database"
          
          waitForConnections: true,
          connectionLimit: 10,
          queueLimit: 0,
          authSwitchHandler,
        };
        
        if (!sslCertPath || !dbToken) {
          throw new Error('SSL certificate path or database token is missing');
        }
    
        try {
          const connection = await mysql.createConnection(poolOptions);
          return connection;
        } catch (error) {
          console.error('Failed to create database connection:', error);
          throw error;
        }
     
/*
      // Get the Secrets Manager credentials (for DB username and host)
      const secretId = process.env.SECRETS_MANAGER_ARN;
      const { host, username } = await this.getDBCredentials(secretId);

      // Generate IAM authentication token
      const dbToken = await this.generateAuthToken(host, username);

      // Create MySQL connection pool with IAM authentication
      const poolOptions: mysql.PoolOptions = {
        host: host,
        user: username,
        password: dbToken, // Use IAM token as password
        database: process.env.DB_NAME, // e.g., "products_database"
        ssl: { ca: fs.readFileSync(sslCertPath) }, // Load SSL certificate from file
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        // authSwitchHandler: function (data, cb) {
        //   // modifies the authentication handler
        //   if (data.pluginName === "mysql_clear_password") {
        //     // authentication token is sent in clear text but connection uses SSL encryption
        //     cb(null, Buffer.from(dbToken + "\0"));
        //   }
        // },
      };

      this.pool = mysql.createPool(poolOptions);

      return this.pool;
    } catch (error) {
      console.error('Error creating IAM-authenticated connection pool', error);
      throw new HttpException(
        {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          error: 'Error creating IAM-authenticated connection pool'
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
      */
    } catch (error) {
      console.error('Error creating IAM-authenticated connection pool', error);
    }

  };
  // Function to get RDS Proxy IAM Auth Token
 

  // Function to get database credentials from Secrets Manager
  private async getDBCredentials (secretId: string) {
    const secretsManager = new AWS.SecretsManager();
    const secretValue = await secretsManager.getSecretValue({ SecretId: secretId }).promise();
    const credentials = JSON.parse(secretValue.SecretString);
    return {
      host: credentials.host,
      username: credentials.username
    };
  }

  // Create Product
  async create (createProductDto: CreateProductDto, tenantId: string, tenantName: string) {
    const newProduct = {
      productId: uuid(),
      tenantId: tenantId,
      ...createProductDto
    };
    console.log('Creating product:', newProduct);

    try {
      const pool = await this.getConnection(tenantName);

      const query = `
        INSERT INTO products (productId, tenantId, name, price, sku, category)
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      const values = [
        newProduct.productId,
        newProduct.tenantId,
        newProduct.name,
        newProduct.price,
        newProduct.sku,
        newProduct.category
      ];

      const [result] = await pool.execute(query, values);
      return result;
    } catch (error) {
      console.error(error);
      throw new HttpException(
        {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          error: error.message
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  // Find all products for a tenant
  async findAll (tenantId: string, tenantName: string) {
    console.log('Getting All Products for Tenant:', tenantId);

    try {
      const pool = await this.getConnection(tenantName);

      const query = `
        SELECT * FROM products
      `;

      const [rows] = await pool.execute(query, [tenantId]);
      return rows;
    } catch (error) {
      console.error(error);
      throw new HttpException(
        {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          error: error.message
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  // Find one product by ID
  async findOne (id: string, tenantId: string, tenantName: string) {
    try {
      console.log('Getting Product: ', id);

      const pool = await this.getConnection(tenantName);

      const query = `
        SELECT * FROM products
        WHERE tenantId = ? AND productId = ?
      `;
      const [rows] = await pool.execute(query, [tenantId, id.split(':')[1]]);
      return rows[0] || null;
    } catch (error) {
      console.error(error);
      throw new HttpException(
        {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          error: error.message
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  // Update product
  async update (id: string, tenantId: string, tenantName: string, updateProductDto: UpdateProductDto) {
    try {
      console.log('Updating Product: ', id);

      const pool = await this.getConnection(tenantName);

      const query = `
        UPDATE products
        SET name = ?, price = ?, sku = ?, category = ?
        WHERE tenantId = ? AND productId = ?
      `;
      const values = [
        updateProductDto.name,
        updateProductDto.price,
        updateProductDto.sku,
        updateProductDto.category,
        tenantId,
        id.split(':')[1]
      ];

      const [result] = await pool.execute(query, values);
      return result;
    } catch (error) {
      console.error(error);
      throw new HttpException(
        {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          error: error.message
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}