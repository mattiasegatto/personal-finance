#!/usr/bin/env bash
set -euo pipefail

: "${NEW_DB_URL:?NEW_DB_URL is required}"
backup_dir="${1:?Pass the directory containing the extracted backup}"
backup_dir="$(cd "$backup_dir" && pwd)"

for file in auth-users.sql data.sql; do
  if [[ ! -s "$backup_dir/$file" ]]; then
    echo "Missing or empty backup file: $backup_dir/$file" >&2
    exit 1
  fi
done

# Run auth and application data in one transaction. Import auth users first so
# public profiles and memberships can safely reference their IDs. Triggers are
# disabled only for this restore transaction to avoid recreating profiles and
# personal spaces that are already present in data.sql.
docker run --rm \
  -e NEW_DB_URL="$NEW_DB_URL" \
  -v "$backup_dir:/backup" \
  postgres:17 \
  sh -euc '
    {
      printf "%s\n" "SET session_replication_role = replica;"
      cat /backup/auth-users.sql
      cat /backup/data.sql
    } > /backup/restore.sql

    psql "$NEW_DB_URL" \
      --single-transaction \
      --set ON_ERROR_STOP=1 \
      --file=/backup/restore.sql
  '

echo "Database data restore completed. Verify users, spaces, balances and financial links before reopening the app."
