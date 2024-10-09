import boto3
import pymysql.cursors
import json
import string
import random
from os import environ
import logger


# ENV
PROXY_ENDPOINT = environ.get('DB_PROXY_ENDPOINT')
DB_ENDPOINT = environ.get('DB_ENDPOINT')
PORT = 3306
DB_NAME = environ.get('DB_NAME')
PROXY_NAME = environ.get('DB_PROXY_NAME')
SECRET_ARN = environ.get('DB_SECRET_ARN')
REGION = environ.get('REGION')
environ['LIBMYSQL_ENABLE_CLEARTEXT_PLUGIN'] = '1'
secrets_manager = boto3.client('secretsmanager')
rds = boto3.client('rds')

def get_iam_auth_token():
    # Generate an IAM authentication token for RDS Proxy

    # session_policy = {
    #     "Version": "2012-10-17",
    #     "Statement": [
    #         {
    #             "Effect": "Allow",
    #             "Action": "rds-db:connect",
    #             "Resource": '*',
    #         }
    #     ]
    # }

    # sts_client = boto3.client("sts")
    # assumed_role_object = sts_client.assume_role(
    #     RoleArn=iam_arn,
    #     RoleSessionName="session",
    #     Policy=str(session_policy)
    # )
    # credentials = assumed_role_object["Credentials"]


    iam_token = rds.generate_db_auth_token(
        DBHostname=PROXY_ENDPOINT,
        Port=3306,  # Adjust this to your DB port
        DBUsername='admin',  # Change this to the IAM user if different
        Region=REGION
    )
    return iam_token


def lambda_handler(event, context):

    tenant_name = event["tenantName"]
    if not tenant_name:
        raise ValueError('Tenant ID is required')

    try:
        connection = None

        # iam_token = get_iam_auth_token()

        secret_value = json.loads(
            secrets_manager.get_secret_value(SecretId=SECRET_ARN)["SecretString"]
        )
        # db_password = secret_value['password']

        logger.info('tenant_name: '+ tenant_name)
        logger.info('user: '+ secret_value['username'])
        logger.info('username: '+ secret_value['username'])

        connection = pymysql.connect(
            host=DB_ENDPOINT,
            user=secret_value['username'],
            password=secret_value['password'],
            port=PORT,
            database=DB_NAME,
            cursorclass=pymysql.cursors.DictCursor,
            # ssl={
            #     'ca': '/var/task/SSLCA.pem',
            # }
        )

        # Check the Database which is already exists.
        databases = f"tenant_{tenant_name}_db"
        cursor = connection.cursor()
        cursor.execute(f"SHOW DATABASES LIKE '{databases}'")
        db_check_result = cursor.fetchall()

        if not db_check_result:
            print(f"Database for tenant {tenant_name} does not exist. Creating now...")

            # Create Database and its tables for tenant
            create_tenant_database_and_tables(connection, tenant_name)
        else:
            print(f"Database for tenant {tenant_name} already exists. Skipping creation.")

        print('Success')
    except Exception as e:
        error_statement = "Database connection failed due to {}".format(e)
        print(error_statement)
        raise Exception(f"Database connection or schema creation failed due to {error_statement}")
    finally:
        if connection:
            connection.close()

# Create Database and its tables
def create_tenant_database_and_tables(connection, tenant_name):
    db_username = f"user_{tenant_name}"
    db_name = f"tenant_{tenant_name}_db"
    user_password = generate_password(32)
    proxy_auth = []
    try:
        cursor = connection.cursor()

        queries = [
            f"CREATE USER '{db_username}'@'%' IDENTIFIED BY '{user_password}';",
            f"CREATE DATABASE {db_name};",
            f"GRANT CREATE VIEW, SHOW VIEW, SELECT, INSERT, UPDATE ON {db_name}.* TO '{db_username}'@'%';",
            f"USE {db_name}",
            """
            CREATE TABLE orders (
                orderId INT AUTO_INCREMENT PRIMARY KEY,
                orderName VARCHAR(255),
                tenantId VARCHAR(255),
                orderProducts JSON
            );
            """,
            """
            CREATE TABLE products (
                productId INT AUTO_INCREMENT PRIMARY KEY,
                tenantId VARCHAR(255),
                sku VARCHAR(255),
                category VARCHAR(255),
                name VARCHAR(255),
                price DECIMAL(10, 2)
            );
            """
        ]

        for query in queries:
            cursor.execute(query)

        # Tenant Secret creation in Secrets Manager 
        secret_name = f"rds_proxy_multitenant/proxy_secret_for_user_" + tenant_name
        secret_description = f"Proxy secret created for tenant {tenant_name}"
        secret_string = {
            "username": db_username,
            "password": user_password,
            "engine": "mysql",
            "port": PORT,
            "dbname": db_name,
            "dbClusterIdentifier": "proxy"
        }

        response = secrets_manager.create_secret(
            Name=secret_name,
            Description=secret_description,
            SecretString=json.dumps(secret_string),
            Tags=[{"Key": "Tenant", "Value": tenant_name}]
        )

        proxy_auth = {
            'SecretArn': response["ARN"],
            'IAMAuth': 'REQUIRED'
        }
        # RDS Proxy Auth Info update
        update_rds_proxy(proxy_auth)

    except Exception as e:
        print(f"Error creating user or schema for tenant {tenant_name}: {e}")
        raise Exception(f"Error creating user or schema for tenant {tenant_name}: {e}")

# RDS Proxy Auth Info Add.
def update_rds_proxy( proxy_auth):
    try:
        current_auth = rds.describe_db_proxies(DBProxyName=PROXY_NAME)['DBProxies'][0]['Auth']
        current_auth.append(proxy_auth)
        rds.modify_db_proxy(DBProxyName=PROXY_NAME, Auth=current_auth)
        
    except Exception as e:
        print(f"Error updating RDS Proxy for {proxy_auth}: {e}")
        raise Exception(f"Error updating RDS Proxy for {proxy_auth}: {e}")

# Password creation function
def generate_password(length):
    characters = string.ascii_letters + string.digits
    password = ''.join(random.choice(characters) for _ in range(length))
    return password

