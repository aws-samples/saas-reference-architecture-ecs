#!/bin/bash
# Validate tenant-api-prod.json structure
# - JSON syntax
# - All routes inside "paths" object
# - No unexpected top-level keys

FILE="server/lib/tenant-api-prod.json"

python3 -c "
import json, sys

with open('$FILE') as f:
    data = json.load(f)

errors = []

# Check top-level keys
allowed = {'swagger', 'info', 'basePath', 'schemes', 'paths', 'securityDefinitions'}
extra = set(data.keys()) - allowed
if extra:
    errors.append(f'Unexpected top-level keys (routes leaked out of paths?): {extra}')

# Check paths exist
if 'paths' not in data:
    errors.append('Missing \"paths\" key')
else:
    print(f'Routes in paths: {len(data[\"paths\"])}')
    for p in data['paths']:
        print(f'  {p}')

if errors:
    for e in errors:
        print(f'ERROR: {e}', file=sys.stderr)
    sys.exit(1)
else:
    print('OK: tenant-api-prod.json is valid')
"
