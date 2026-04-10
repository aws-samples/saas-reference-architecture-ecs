import boto3
import pg8000.native
import json
import string
import re
import os
from os import environ
import logger

# ENV
PROXY_ENDPOINT = environ.get('DB_PROXY_ENDPOINT')
DB_ENDPOINT = environ.get('DB_ENDPOINT')
PORT = 5432
DB_NAME = environ.get('DB_NAME')
PROXY_NAME = environ.get('DB_PROXY_NAME')
SECRET_ARN = environ.get('DB_SECRET_ARN')
REGION = environ.get('REGION')
secrets_manager = boto3.client('secretsmanager')
rds = boto3.client('rds')


def load_schema():
    """Load DDL statements from external schema.sql file."""
    schema_path = os.path.join(os.path.dirname(__file__), 'schema.sql')
    with open(schema_path, 'r') as f:
        return f.read()


def execute_schema(conn):
    """Execute all DDL statements from schema.sql."""
    raw = load_schema()
    print(f"Schema SQL loaded ({len(raw)} chars)")
    # Remove all comment lines first, then split by semicolon
    lines = [l for l in raw.split('\n') if not l.strip().startswith('--')]
    clean_sql = '\n'.join(lines)
    for statement in clean_sql.split(';'):
        stmt = statement.strip()
        if stmt:
            print(f"Executing: {stmt[:80]}...")
            conn.run(stmt)
            print(f"  OK")


def get_admin_connection(db_name=None):
    """Create a pg8000 native connection using admin credentials."""
    secret_value = json.loads(
        secrets_manager.get_secret_value(SecretId=SECRET_ARN)["SecretString"]
    )
    return pg8000.native.Connection(
        host=DB_ENDPOINT,
        user=secret_value['username'],
        password=secret_value['password'],
        port=PORT,
        database=db_name or DB_NAME,
    )


def lambda_handler(event, context):
    tenant_name = event["tenantName"]
    if not tenant_name:
        raise ValueError('Tenant name is required')

    if not re.match(r'^[a-zA-Z0-9_-]+$', tenant_name):
        raise ValueError(f'Invalid tenant name: {tenant_name}')

    action = event.get("action", "create")

    try:
        logger.info('tenant_name: ' + tenant_name)
        logger.info('action: ' + action)

        conn = get_admin_connection()

        if action == "delete":
            delete_tenant(conn, tenant_name)
        else:
            db_name = f"tenant_{tenant_name}_db"
            rows = conn.run("SELECT 1 FROM pg_database WHERE datname = :name", name=db_name)
            if not rows:
                print(f"Database for tenant {tenant_name} does not exist. Creating now...")
                create_tenant_database_and_tables(conn, tenant_name)
            else:
                print(f"Database for tenant {tenant_name} already exists. Ensuring tables and Proxy Auth...")
                ensure_tables_exist(conn, tenant_name)
                ensure_proxy_auth_registered(tenant_name)

        print('Success')
    except Exception as e:
        error_statement = "Database connection failed due to {}".format(e)
        print(error_statement)
        raise Exception(f"Database operation ({action}) failed due to {error_statement}")
    finally:
        try:
            conn.close()
        except:
            pass


def create_tenant_database_and_tables(conn, tenant_name):
    db_username = f"user_{tenant_name}"
    db_name = f"tenant_{tenant_name}_db"
    user_password = generate_password(32)
    try:
        # Create role (skip if exists)
        rows = conn.run("SELECT 1 FROM pg_roles WHERE rolname = :name", name=db_username)
        if not rows:
            conn.run(f"CREATE ROLE {db_username} WITH LOGIN PASSWORD '{user_password}'")
        else:
            print(f"Role {db_username} already exists, updating password")
            conn.run(f"ALTER ROLE {db_username} WITH PASSWORD '{user_password}'")

        # Grant admin membership on tenant role (required for PostgreSQL 16+)
        conn.run(f"GRANT {db_username} TO CURRENT_USER")

        # Create database (skip if exists)
        rows = conn.run("SELECT 1 FROM pg_database WHERE datname = :name", name=db_name)
        if not rows:
            conn.run(f"CREATE DATABASE {db_name} OWNER {db_username}")
        else:
            print(f"Database {db_name} already exists")

        conn.run(f"GRANT CONNECT ON DATABASE {db_name} TO {db_username}")
        conn.close()

        # Connect to tenant database to create tables
        print(f"Connecting to tenant database {db_name} to create tables...")
        tenant_conn = get_admin_connection(db_name)
        tenant_conn.run(f"GRANT USAGE ON SCHEMA public TO {db_username}")
        tenant_conn.run(f"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {db_username}")
        tenant_conn.run(f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {db_username}")
        tenant_conn.run(f"ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {db_username}")
        tenant_conn.run(f"ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO {db_username}")

        print(f"Executing schema.sql for tenant {tenant_name}...")
        execute_schema(tenant_conn)
        # Verify tables were created
        tables = tenant_conn.run("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
        print(f"Tables in {db_name}: {tables}")
        print(f"Schema executed successfully for tenant {tenant_name}")
        tenant_conn.close()

        # Create secret and register with RDS Proxy
        secret_name = f"rds_proxy_multitenant/proxy_secret_for_user_{tenant_name}"
        secret_string = {
            "username": db_username,
            "password": user_password,
            "engine": "postgres",
            "port": PORT,
            "dbname": db_name,
            "dbClusterIdentifier": "proxy"
        }

        try:
            response = secrets_manager.create_secret(
                Name=secret_name,
                Description=f"Proxy secret created for tenant {tenant_name}",
                SecretString=json.dumps(secret_string),
                Tags=[{"Key": "Tenant", "Value": tenant_name}]
            )
            secret_arn = response["ARN"]
        except secrets_manager.exceptions.ResourceExistsException:
            print(f"Secret {secret_name} already exists, reusing")
            response = secrets_manager.describe_secret(SecretId=secret_name)
            secret_arn = response["ARN"]
            secrets_manager.update_secret(
                SecretId=secret_name,
                SecretString=json.dumps(secret_string)
            )

        proxy_auth = {'SecretArn': secret_arn, 'IAMAuth': 'REQUIRED'}
        update_rds_proxy(proxy_auth)

    except Exception as e:
        print(f"Error creating user or schema for tenant {tenant_name}: {e}")
        raise Exception(f"Error creating user or schema for tenant {tenant_name}: {e}")


def ensure_tables_exist(conn, tenant_name):
    """Create tables in existing tenant database if they don't exist."""
    db_name = f"tenant_{tenant_name}_db"
    db_username = f"user_{tenant_name}"
    try:
        conn.close()
        tenant_conn = get_admin_connection(db_name)

        tenant_conn.run(f"GRANT USAGE ON SCHEMA public TO {db_username}")
        tenant_conn.run(f"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {db_username}")
        tenant_conn.run(f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {db_username}")
        tenant_conn.run(f"ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {db_username}")
        tenant_conn.run(f"ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO {db_username}")

        execute_schema(tenant_conn)
        tenant_conn.close()
        print(f"Tables ensured for tenant {tenant_name}")
    except Exception as e:
        print(f"Error ensuring tables for tenant {tenant_name}: {e}")


def delete_tenant(conn, tenant_name):
    db_username = f"user_{tenant_name}"
    db_name = f"tenant_{tenant_name}_db"
    secret_name = f"rds_proxy_multitenant/proxy_secret_for_user_{tenant_name}"

    remove_proxy_auth(tenant_name, secret_name)

    try:
        conn.run(f"""
            SELECT pg_terminate_backend(pid)
            FROM pg_stat_activity
            WHERE datname = '{db_name}' AND pid <> pg_backend_pid()
        """)
        conn.run(f"DROP DATABASE IF EXISTS {db_name}")
        print(f"Dropped database: {db_name}")
        conn.run(f"DROP ROLE IF EXISTS {db_username}")
        print(f"Dropped role: {db_username}")
    except Exception as e:
        print(f"Error dropping database/role for tenant {tenant_name}: {e}")

    try:
        secrets_manager.delete_secret(SecretId=secret_name, ForceDeleteWithoutRecovery=True)
        print(f"Deleted secret: {secret_name}")
    except secrets_manager.exceptions.ResourceNotFoundException:
        print(f"Secret not found (already deleted): {secret_name}")
    except Exception as e:
        print(f"Error deleting secret {secret_name}: {e}")


def ensure_proxy_auth_registered(tenant_name):
    secret_name = f"rds_proxy_multitenant/proxy_secret_for_user_{tenant_name}"
    try:
        response = secrets_manager.describe_secret(SecretId=secret_name)
        secret_arn = response['ARN']
        current_auth = rds.describe_db_proxies(DBProxyName=PROXY_NAME)['DBProxies'][0]['Auth']
        registered_arns = [a.get('SecretArn', '') for a in current_auth]
        if secret_arn in registered_arns:
            print(f"Proxy Auth already registered for tenant {tenant_name}")
            return
        print(f"Proxy Auth missing for tenant {tenant_name}, registering now...")
        update_rds_proxy({'SecretArn': secret_arn, 'IAMAuth': 'REQUIRED'})
    except secrets_manager.exceptions.ResourceNotFoundException:
        print(f"Secret not found for tenant {tenant_name}, skipping Proxy Auth check")
    except Exception as e:
        print(f"Error ensuring Proxy Auth for tenant {tenant_name}: {e}")
        raise


def remove_proxy_auth(tenant_name, secret_name):
    import time, random
    max_retries, base_delay = 40, 20
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
            current_auth, proxy_status = proxy_info['Auth'], proxy_info['Status']
            registered_arns = [a.get('SecretArn', '') for a in current_auth]
            if target_secret_arn not in registered_arns:
                print(f"Proxy Auth not registered for tenant {tenant_name}, nothing to remove")
                return
            if proxy_status != 'available':
                wait_time = base_delay + random.uniform(0, 5)
                print(f"RDS Proxy status: {proxy_status}, waiting {wait_time:.0f}s... (attempt {attempt+1}/{max_retries})")
                time.sleep(wait_time)
                continue
            new_auth = [a for a in current_auth if a.get('SecretArn', '') != target_secret_arn]
            rds.modify_db_proxy(DBProxyName=PROXY_NAME, Auth=new_auth)
            print(f"Successfully removed Proxy Auth for tenant {tenant_name}")
            return
        except rds.exceptions.InvalidDBProxyStateFault:
            time.sleep(base_delay + random.uniform(0, 5))
        except Exception as e:
            print(f"Error removing Proxy Auth for tenant {tenant_name}: {e}")
            raise
    raise Exception(f"Failed to remove Proxy Auth after {max_retries} retries for tenant {tenant_name}")


def update_rds_proxy(proxy_auth):
    import time, random
    max_retries, base_delay = 40, 20
    target_secret_arn = proxy_auth['SecretArn']
    for attempt in range(max_retries):
        try:
            proxy_info = rds.describe_db_proxies(DBProxyName=PROXY_NAME)['DBProxies'][0]
            current_auth, proxy_status = proxy_info['Auth'], proxy_info['Status']
            registered_arns = [a.get('SecretArn', '') for a in current_auth]
            if target_secret_arn in registered_arns:
                print(f"Proxy Auth already registered: {target_secret_arn}")
                return
            if proxy_status != 'available':
                wait_time = base_delay + random.uniform(0, 5)
                print(f"RDS Proxy status: {proxy_status}, waiting {wait_time:.0f}s... (attempt {attempt+1}/{max_retries})")
                time.sleep(wait_time)
                continue
            current_auth.append(proxy_auth)
            rds.modify_db_proxy(DBProxyName=PROXY_NAME, Auth=current_auth)
            print(f"Successfully updated RDS Proxy with {proxy_auth}")
            return
        except rds.exceptions.InvalidDBProxyStateFault:
            time.sleep(base_delay + random.uniform(0, 5))
        except Exception as e:
            print(f"Error updating RDS Proxy for {proxy_auth}: {e}")
            raise
    raise Exception(f"Failed to update RDS Proxy after {max_retries} retries for {proxy_auth}")


def generate_password(length):
    import secrets as sec
    characters = string.ascii_letters + string.digits
    return ''.join(sec.choice(characters) for _ in range(length))
