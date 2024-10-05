// import { RDSDataClient, ExecuteStatementCommand } from '@aws-sdk/client-rds-data';
// import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

// const rdsDataClient = new RDSDataClient({});
// const secretsManagerClient = new SecretsManagerClient({});

// exports.handler = async (event: any) => {
//   const tenantId = event.tenantId; // 테넌트 ID
//   const dbProxyArn = process.env.DB_PROXY_ARN;
//   const secretArn = process.env.SECRET_ARN;

//   try {
//     // RDS 비밀에서 자격 증명을 가져옴
//     const secret = await secretsManagerClient.send(
//       new GetSecretValueCommand({ SecretId: secretArn })
//     );
//     const credentials = JSON.parse(secret.SecretString!);

//     // 테넌트의 스키마 생성 SQL
//     const sql = `
//       CREATE SCHEMA IF NOT EXISTS tenant_${tenantId};
//       CREATE TABLE IF NOT EXISTS tenant_${tenantId}.Orders (
//         orderId INT PRIMARY KEY AUTO_INCREMENT,
//         orderDate TIMESTAMP DEFAULT CURRENT_TIMESTAMP
//       );
//       CREATE TABLE IF NOT EXISTS tenant_${tenantId}.Products (
//         productId INT PRIMARY KEY AUTO_INCREMENT,
//         productName VARCHAR(255)
//       );
//     `;

//     // RDS Proxy를 통해 SQL 실행
//     const command = new ExecuteStatementCommand({
//       resourceArn: dbProxyArn,
//       secretArn: secretArn,
//       sql: sql,
//       database: 'main_db',
//     });

//     await rdsDataClient.send(command);

//     return {
//       statusCode: 200,
//       body: JSON.stringify({ message: `Schema created for tenant_${tenantId}` }),
//     };
//   } catch (error) {
//     console.error('Error creating schema:', error);
//     return {
//       statusCode: 500,
//       body: JSON.stringify({ message: 'Error creating schema', error }),
//     };
//   }
// };


import * as AWS from 'aws-sdk';
import * as mysql from 'mysql2/promise';
import { SecretsManagerClient, GetSecretValueCommand, CreateSecretCommand } from '@aws-sdk/client-secrets-manager';

const secretsmanager = new SecretsManagerClient({ region: process.env.REGION });
const rds = new AWS.RDS();
const ENDPOINT = process.env.DB_ENDPOINT as string;
const PORT = 3306;
const USR = process.env.USER as string;
// const REGION = process.env.REGION as string;
const DBNAME = process.env.DB_NAME as string;
const PROXY_NAME = process.env.DB_PROXY_NAME as string;
const secretArn = process.env.DB_SECRET_ARN as string;
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

// Lambda 핸들러
export const handler = async (event: any) => {
  const tenantId = event.tenantId; // 테넌트 ID는 이벤트로부터 전달
  if (!tenantId) {
    throw new Error('Tenant ID is required');
  }

  let connection;

  try {
    // Secrets Manager에서 DB 비밀번호 가져오기
    const secretValue = await secretsmanager.send(new GetSecretValueCommand({ SecretId: secretArn }));
    const secretData = JSON.parse(secretValue.SecretString || '{}');
    const dbPassword = secretData.password;

    // MySQL 연결 설정
    connection = await mysql.createConnection({
      host: ENDPOINT,
      user: USR,
      password: dbPassword,
      port: PORT,
      database: DBNAME,
    });

    // 테넌트에 대한 데이터베이스가 이미 존재하는지 확인
    const dbName = `tenant_${tenantId}_db`;
    const dbCheckQuery = `SHOW DATABASES LIKE '${dbName}'`;
    const [dbCheckResult] = await connection.query(dbCheckQuery);

    if (Array.isArray(dbCheckResult) && dbCheckQuery.length === 0) {
      console.log(`Database for tenant ${tenantId} does not exist. Creating now...`);

      // 데이터베이스 및 테이블 생성
      await createTenantDatabaseAndTables(connection, tenantId, dbPassword);
    } else {
      console.log(`Database for tenant ${tenantId} already exists. Skipping creation.`);
    }

    console.log('Success');
  } catch (error) {
    console.error(`Error: ${error}`);
    throw new Error(`Database connection or schema creation failed due to ${error}`);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
};

// 테넌트에 대한 데이터베이스 및 테이블 생성
async function createTenantDatabaseAndTables(connection: mysql.Connection, tenantId: string, dbPassword: string) {
  const dbusername = `user_${tenantId}`;
  const dbname = `tenant_${tenantId}_db`;
  const userPassword = generatePassword(32);

  try {
    // 사용자 및 스키마 생성 쿼리 실행
    const queries = [
      `CREATE USER '${dbusername}' IDENTIFIED BY '${userPassword}';`,
      `CREATE DATABASE ${dbname};`,
      `GRANT CREATE VIEW, SHOW VIEW, SELECT, INSERT, UPDATE ON ${dbname}.* TO '${dbusername}';`,
      `USE ${dbname}`,
      `CREATE TABLE orders (
        order_id INT AUTO_INCREMENT PRIMARY KEY,
        product_id INT,
        quantity INT,
        total_price DECIMAL(10, 2)
      );`,
      `CREATE TABLE products (
        product_id INT AUTO_INCREMENT PRIMARY KEY,
        product_name VARCHAR(255),
        product_description TEXT,
        price DECIMAL(10, 2)
      );`,
    ];

    for (const query of queries) {
      await connection.query(query);
    }

    // Secrets Manager에 사용자 비밀 저장
    const secretName = `Amazon_rds_proxy_multitenant/${tenantId}_user_secret`;
    const secretDescription = `Proxy secret created for tenant ${tenantId}`;
    const secretString = {
      username: dbusername,
      password: userPassword,
      engine: 'mysql',
      port: PORT,
      dbname: dbname,
      dbClusterIdentifier: 'proxy',
    };

    const createSecretResponse = await secretsmanager.send(
      new CreateSecretCommand({
        Name: secretName,
        Description: secretDescription,
        SecretString: JSON.stringify(secretString),
        Tags: [{ Key: 'Tenant', Value: tenantId }],
      })
    );

    // RDS Proxy 인증 정보 업데이트
    await updateRDSProxy(dbusername, createSecretResponse.ARN);
  } catch (error) {
    console.error(`Error creating user or schema for tenant ${tenantId}: ${error}`);
    throw new Error(`Error creating user or schema for tenant ${tenantId}: ${error}`);
  }
}

// RDS Proxy 인증 정보 업데이트
async function updateRDSProxy(dbusername: string, secretArn?: string) {
  try {
    await rds
      .modifyDBProxy({
        DBProxyName: PROXY_NAME,
        Auth: [
          {
            SecretArn: secretArn,
            IAMAuth: 'REQUIRED',
          },
        ],
      })
      .promise();
  } catch (error) {
    console.error(`Error updating RDS Proxy for ${dbusername}: ${error}`);
    throw new Error(`Error updating RDS Proxy for ${dbusername}: ${error}`);
  }
}

// 비밀번호 생성 함수
function generatePassword(length: number) {
  return Array.from({ length }, () => alphabet.charAt(Math.floor(Math.random() * alphabet.length))).join('');
}
