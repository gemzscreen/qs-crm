#!/bin/bash
# Local database test: fresh database -> Supabase stub -> schema.sql twice (must be re-runnable) -> t_proc.sql
#   PGHOST=/tmp/pg PGPORT=5433 PGUSER=postgres bash test/db/run.sh
set -eo pipefail
cd "$(dirname "$0")/../.."
DB=${TESTDB:-qscrm_test}
psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB" 2>&1 | grep -v NOTICE || true
psql -q -v ON_ERROR_STOP=1 -d $DB -f test/db/sb_stub.sql
for i in 1 2; do psql -q -v ON_ERROR_STOP=1 --single-transaction -d $DB -f supabase/schema.sql 2>&1 | { grep -v "NOTICE:.*skipping" || true; }; done
echo "schema.sql applied twice OK"
psql -q -v ON_ERROR_STOP=1 -d $DB -f test/db/t_proc.sql 2>&1 >/dev/null | sed "s/^psql:[^ ]* NOTICE:  //"
echo "test/db/t_proc.sql: $(grep -c "^select pg_temp\." test/db/t_proc.sql) checks passed"
