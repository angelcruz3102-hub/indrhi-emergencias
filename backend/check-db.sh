#!/usr/bin/env bash
set -e
export TEST_DATABASE_URL="postgres://postgres:test@localhost:5432/indrhi_test"
export PGUSER=postgres
export PGPASSWORD=test
export PGHOST=localhost
export PGPORT=5432
export PGDATABASE=indrhi_test

echo "→ psql directo:"
psql -c "SELECT current_user, current_database();"

echo "→ npm test:"
cd "$(dirname "$0")"
npm test
