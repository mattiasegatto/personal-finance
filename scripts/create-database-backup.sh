#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is required}"
: "${AGE_RECIPIENT:?AGE_RECIPIENT is required}"

backup_dir="${1:?Pass a backup output directory}"
mkdir -p "$backup_dir"
backup_dir="$(cd "$backup_dir" && pwd)"

# Supabase CLI intentionally omits managed schemas such as auth and storage.
# Export application data and custom roles with the supported CLI.
supabase db dump --remote="$SUPABASE_DB_URL" --role-only --file "$backup_dir/roles.sql"
supabase db dump --remote="$SUPABASE_DB_URL" --data-only --use-copy --file "$backup_dir/data.sql"

# Preserve user IDs, password hashes and login identities separately.
# Sessions and refresh tokens are deliberately excluded; users sign in again
# after a restore. The image major must match the Supabase database major.
docker run --rm \
  -e SUPABASE_DB_URL="$SUPABASE_DB_URL" \
  -v "$backup_dir:/backup" \
  postgres:17 \
  pg_dump "$SUPABASE_DB_URL" \
    --data-only \
    --column-inserts \
    --no-owner \
    --no-acl \
    --table=auth.users \
    --table=auth.identities \
    --file=/backup/auth-users.sql

cp -R supabase/migrations "$backup_dir/migrations"
cp supabase/config.toml "$backup_dir/config.toml"

{
  printf 'created_at_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'repository_commit=%s\n' "$(git rev-parse HEAD)"
  printf 'database_client_image=postgres:17\n'
  printf 'schema_source=supabase/migrations\n'
  printf 'auth_tables=auth.users,auth.identities\n'
  printf 'auth_sessions=not_exported\n'
} > "$backup_dir/backup-manifest.txt"

tar -czf "$backup_dir/backup.tar.gz" \
  -C "$backup_dir" \
  roles.sql data.sql auth-users.sql config.toml migrations backup-manifest.txt

age --encrypt --recipient "$AGE_RECIPIENT" \
  --output "$backup_dir/backup.tar.gz.age" \
  "$backup_dir/backup.tar.gz"

test -s "$backup_dir/backup.tar.gz.age"
sha256sum "$backup_dir/backup.tar.gz.age" > "$backup_dir/backup.tar.gz.age.sha256"
printf 'Encrypted backup ready: %s\n' "$backup_dir/backup.tar.gz.age"
