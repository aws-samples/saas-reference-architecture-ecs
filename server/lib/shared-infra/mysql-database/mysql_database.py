import boto3
import pymysql.cursors
import json
import string
import re
import os
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


def load_schema():
    """Load DDL statements from all .sql files in sql/ subdirectory, sorted by filename."""
    schema_dir = os.path.join(os.path.dirname(__file__), 'sql')
    sql_files = sorted([f for f in os.listdir(schema_dir) if f.endswith('.sql')])
    if not sql_files:
        raise FileNotFoundError(f"No .sql files found in {schema_dir}")
    combined = []
    for sql_file in sql_files:
        path = os.path.join(schema_dir, sql_file)
        with open(path, 'r') as f:
            content = f.read()
        print(f"Loaded {sql_file} ({len(content)} chars)")
        combined.append(content)
    return '\n'.join(combined)


def execute_schema(cursor):
    """Execute all DDL statements from schema.sql."""
    raw = load_schema()
    # Remove comment lines first, then split by semicolon
    lines = [l for l in raw.split('\n') if not l.strip().startswith('--')]
    clean_sql = '\n'.join(lines)
    for statement in clean_sql.split(';'):
        stmt = statement.strip()
        if stmt:
            print(f"Executing: {stmt[:80]}...")
            cursor.execute(stmt)
            print(f"  OK")

def get_iam_auth_token():
    # Generate an IAM authentication token for RDS Proxy
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
        raise ValueError('Tenant name is required')

    # Validate tenant_name to prevent SQL injection (alphanumeric, hyphen, underscore only)
    if not re.match(r'^[a-zA-Z0-9_-]+$', tenant_name):
        raise ValueError(f'Invalid tenant name: {tenant_name}')

    action = event.get("action", "create")

    try:
        connection = None

        secret_value = json.loads(
            secrets_manager.get_secret_value(SecretId=SECRET_ARN)["SecretString"]
        )
        logger.info('tenant_name: '+ tenant_name)
        logger.info('username: '+ secret_value['username'])
        logger.info('action: '+ action)

        connection = pymysql.connect(
            host=DB_ENDPOINT,
            user=secret_value['username'],
            password=secret_value['password'],
            port=PORT,
            database=DB_NAME,
            cursorclass=pymysql.cursors.DictCursor,
        )

        if action == "delete":
            delete_tenant(connection, tenant_name)
        else:
            # Check the Database which is already exists.
            databases = f"tenant_{tenant_name}_db"
            cursor = connection.cursor()
            cursor.execute(f"SHOW DATABASES LIKE '{databases}'")
            db_check_result = cursor.fetchall()

            if not db_check_result:
                print(f"Database for tenant {tenant_name} does not exist. Creating now...")
                create_tenant_database_and_tables(connection, tenant_name)
            else:
                print(f"Database for tenant {tenant_name} already exists. Checking Proxy Auth...")
                ensure_proxy_auth_registered(tenant_name)

        print('Success')
    except Exception as e:
        error_statement = "Database connection failed due to {}".format(e)
        print(error_statement)
        raise Exception(f"Database operation ({action}) failed due to {error_statement}")
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
            f"CREATE USER IF NOT EXISTS '{db_username}'@'%' IDENTIFIED BY '{user_password}';",
            f"CREATE DATABASE IF NOT EXISTS {db_name};",
            f"GRANT CREATE VIEW, SHOW VIEW, SELECT, INSERT, UPDATE ON {db_name}.* TO '{db_username}'@'%';",
            f"USE {db_name}",
        ]

        for query in queries:
            cursor.execute(query)

        execute_schema(cursor)

        # Tenant Secret creation in Secrets Manager (reuse if already exists)
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

        try:
            response = secrets_manager.create_secret(
                Name=secret_name,
                Description=secret_description,
                SecretString=json.dumps(secret_string),
                Tags=[{"Key": "Tenant", "Value": tenant_name}]
            )
            secret_arn = response["ARN"]
        except secrets_manager.exceptions.ResourceExistsException:
            print(f"Secret {secret_name} already exists, reusing")
            response = secrets_manager.describe_secret(SecretId=secret_name)
            secret_arn = response["ARN"]
            # Update password to match newly created DB user
            secrets_manager.update_secret(
                SecretId=secret_name,
                SecretString=json.dumps(secret_string)
            )

        proxy_auth = {
            'SecretArn': secret_arn,
            'IAMAuth': 'REQUIRED'
        }
        # RDS Proxy Auth Info update
        update_rds_proxy(proxy_auth)

    except Exception as e:
        print(f"Error creating user or schema for tenant {tenant_name}: {e}")
        raise Exception(f"Error creating user or schema for tenant {tenant_name}: {e}")

# Delete tenant: DROP database, DROP user, remove Proxy Auth, delete Secret
def delete_tenant(connection, tenant_name):
    db_username = f"user_{tenant_name}"
    db_name = f"tenant_{tenant_name}_db"
    secret_name = f"rds_proxy_multitenant/proxy_secret_for_user_{tenant_name}"

    # 1. Remove RDS Proxy Auth (must happen before secret deletion)
    remove_proxy_auth(tenant_name, secret_name)

    # 2. DROP database and user in MySQL
    try:
        cursor = connection.cursor()
        cursor.execute(f"DROP DATABASE IF EXISTS {db_name}")
        print(f"Dropped database: {db_name}")
        cursor.execute(f"DROP USER IF EXISTS '{db_username}'@'%'")
        print(f"Dropped user: {db_username}")
    except Exception as e:
        print(f"Error dropping database/user for tenant {tenant_name}: {e}")
        # Continue to delete secret even if DB cleanup fails

    # 3. Delete Secret from Secrets Manager (force, no recovery period)
    try:
        secrets_manager.delete_secret(
            SecretId=secret_name,
            ForceDeleteWithoutRecovery=True
        )
        print(f"Deleted secret: {secret_name}")
    except secrets_manager.exceptions.ResourceNotFoundException:
        print(f"Secret not found (already deleted): {secret_name}")
    except Exception as e:
        print(f"Error deleting secret {secret_name}: {e}")


# Remove a tenant's secret from RDS Proxy Auth list
# Same retry logic as update_rds_proxy for MODIFYING state handling
def remove_proxy_auth(tenant_name, secret_name):
    import time
    import random
    max_retries = 40
    base_delay = 20

    # Find the secret ARN
    try:
        response = secrets_manager.describe_secret(SecretId=secret_name)
        target_secret_arn = response['ARN']
    except secrets_manager.exceptions.ResourceNotFoundException:
        print(f"Secret not found for tenant {tenant_name}, skipping Proxy Auth removal")
        return
    except Exception as e:
        print(f"Error describing secret {secret_name}: {e}")
        return

    for attempt in range(max_retries):
        try:
            proxy_info = rds.describe_db_proxies(DBProxyName=PROXY_NAME)['DBProxies'][0]
            current_auth = proxy_info['Auth']
            proxy_status = proxy_info['Status']

            # Check if the secret is registered
            registered_arns = [a.get('SecretArn', '') for a in current_auth]
            if target_secret_arn not in registered_arns:
                print(f"Proxy Auth not registered for tenant {tenant_name}, nothing to remove")
                return

            # Wait if MODIFYING
            if proxy_status != 'available':
                jitter = random.uniform(0, 5)
                wait_time = base_delay + jitter
                print(f"RDS Proxy status: {proxy_status}, waiting {wait_time:.0f}s... (attempt {attempt+1}/{max_retries})")
                time.sleep(wait_time)
                continue

            # Remove the target secret from Auth list
            new_auth = [a for a in current_auth if a.get('SecretArn', '') != target_secret_arn]
            rds.modify_db_proxy(DBProxyName=PROXY_NAME, Auth=new_auth)
            print(f"Successfully removed Proxy Auth for tenant {tenant_name}")
            return

        except rds.exceptions.InvalidDBProxyStateFault:
            jitter = random.uniform(0, 5)
            wait_time = base_delay + jitter
            print(f"RDS Proxy modify conflict, waiting {wait_time:.0f}s... (attempt {attempt+1}/{max_retries})")
            time.sleep(wait_time)

        except Exception as e:
            print(f"Error removing Proxy Auth for tenant {tenant_name}: {e}")
            raise

    raise Exception(f"Failed to remove Proxy Auth after {max_retries} retries for tenant {tenant_name}")


# Ensure RDS Proxy Auth is registered for existing tenant
def ensure_proxy_auth_registered(tenant_name):
    secret_name = f"rds_proxy_multitenant/proxy_secret_for_user_{tenant_name}"
    try:
        # Check if secret exists
        response = secrets_manager.describe_secret(SecretId=secret_name)
        secret_arn = response['ARN']

        # Check if already registered in Proxy Auth
        current_auth = rds.describe_db_proxies(DBProxyName=PROXY_NAME)['DBProxies'][0]['Auth']
        registered_arns = [a.get('SecretArn', '') for a in current_auth]

        if secret_arn in registered_arns:
            print(f"Proxy Auth already registered for tenant {tenant_name}")
            return

        print(f"Proxy Auth missing for tenant {tenant_name}, registering now...")
        proxy_auth = {
            'SecretArn': secret_arn,
            'IAMAuth': 'REQUIRED'
        }
        update_rds_proxy(proxy_auth)

    except secrets_manager.exceptions.ResourceNotFoundException:
        print(f"Secret not found for tenant {tenant_name}, skipping Proxy Auth check")
    except Exception as e:
        print(f"Error ensuring Proxy Auth for tenant {tenant_name}: {e}")
        raise

# RDS Proxy Auth Info Add.
# RDS Proxy는 한 번에 하나의 modify만 허용 (MODIFYING 상태에서 추가 modify 불가).
# Lambda 타임아웃 15분 내에서 충분히 retry. 동시 프로비저닝 시 직렬화됨.
def update_rds_proxy(proxy_auth):
    import time
    import random
    max_retries = 40
    base_delay = 20  # seconds — 총 최대 ~13분 (40 * 20s)

    target_secret_arn = proxy_auth['SecretArn']

    for attempt in range(max_retries):
        try:
            # 매 시도마다 최신 Auth 목록을 읽어서 race condition 방지
            proxy_info = rds.describe_db_proxies(DBProxyName=PROXY_NAME)['DBProxies'][0]
            current_auth = proxy_info['Auth']
            proxy_status = proxy_info['Status']

            # 이미 등록되어 있으면 스킵 (다른 Lambda가 먼저 등록한 경우)
            registered_arns = [a.get('SecretArn', '') for a in current_auth]
            if target_secret_arn in registered_arns:
                print(f"Proxy Auth already registered (by another process): {target_secret_arn}")
                return

            # MODIFYING 상태면 대기 후 retry
            if proxy_status != 'available':
                jitter = random.uniform(0, 5)
                wait_time = base_delay + jitter
                print(f"RDS Proxy status: {proxy_status}, waiting {wait_time:.0f}s... (attempt {attempt+1}/{max_retries})")
                time.sleep(wait_time)
                continue

            # available 상태 → modify 시도
            current_auth.append(proxy_auth)
            rds.modify_db_proxy(DBProxyName=PROXY_NAME, Auth=current_auth)
            print(f"Successfully updated RDS Proxy with {proxy_auth}")
            return

        except rds.exceptions.InvalidDBProxyStateFault:
            jitter = random.uniform(0, 5)
            wait_time = base_delay + jitter
            print(f"RDS Proxy modify conflict, waiting {wait_time:.0f}s... (attempt {attempt+1}/{max_retries})")
            time.sleep(wait_time)

        except Exception as e:
            print(f"Error updating RDS Proxy for {proxy_auth}: {e}")
            raise

    raise Exception(f"Failed to update RDS Proxy after {max_retries} retries for {proxy_auth}")

# Password creation function (cryptographically secure)
def generate_password(length):
    import secrets
    characters = string.ascii_letters + string.digits
    password = ''.join(secrets.choice(characters) for _ in range(length))
    return password

