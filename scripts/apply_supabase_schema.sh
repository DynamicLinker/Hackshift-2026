#!/usr/bin/env bash
set -e

# Horizon Supabase Schema Migration Helper
# Usage:
#   ./scripts/apply_supabase_schema.sh "postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres"
# or with SUPABASE_DB_URL in .env:
#   ./scripts/apply_supabase_schema.sh

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCHEMA_FILE="$DIR/supabase_schema.sql"

if [ -f "$DIR/.env" ]; then
    export $(grep -v '^#' "$DIR/.env" | xargs -d '\n')
fi

DB_URL="${1:-$SUPABASE_DB_URL}"

if [ -z "$DB_URL" ]; then
    echo "=================================================================="
    echo " ⚡ Horizon Supabase Schema Setup"
    echo "=================================================================="
    echo "No database connection string provided."
    echo ""
    echo "Option 1 (Fastest via Web Dashboard):"
    echo "  1. Open your Supabase project: https://supabase.com/dashboard"
    echo "  2. Go to 'SQL Editor' in the left sidebar."
    echo "  3. Copy the contents of supabase_schema.sql, paste it, and click 'Run'."
    echo ""
    echo "Option 2 (CLI via direct connection string):"
    echo "  ./scripts/apply_supabase_schema.sh \"postgresql://postgres.[ref]:[password]@...\""
    echo "=================================================================="
    exit 1
fi

echo "Connecting to Supabase PostgreSQL and applying schema..."
psql "$DB_URL" -f "$SCHEMA_FILE"

echo "✅ Supabase schema successfully applied and seeded!"
