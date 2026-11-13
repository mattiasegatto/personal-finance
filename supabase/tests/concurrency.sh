#!/usr/bin/env bash
set -euo pipefail

container="$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -n 1)"
if [[ -z "$container" ]]; then
  echo "Could not find the local Supabase database container."
  exit 1
fi

user_id="00000000-0000-0000-0000-00000000e101"
account_id="00000000-0000-0000-0000-00000000e102"
transaction_category_id="00000000-0000-0000-0000-00000000e103"
parent_category_id="00000000-0000-0000-0000-00000000e104"
space_id="$(
  docker exec "$container" psql --username postgres --dbname postgres --tuples-only --no-align \
    --command "select id from public.spaces where created_by = '$user_id' and kind = 'personal' limit 1"
)"

if [[ -z "$space_id" ]]; then
  docker exec -i "$container" psql --username postgres --dbname postgres --set ON_ERROR_STOP=1 <<SQL
insert into auth.users(id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values ('$user_id','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
        'concurrency-finance@test.local','{}',now(),now());
SQL
  space_id="$(
    docker exec "$container" psql --username postgres --dbname postgres --tuples-only --no-align \
      --command "select id from public.spaces where created_by = '$user_id' and kind = 'personal' limit 1"
  )"
fi

if [[ -z "$space_id" ]]; then
  echo "The concurrency test user has no personal space."
  exit 1
fi

docker exec -i "$container" psql --username postgres --dbname postgres --set ON_ERROR_STOP=1 <<SQL
insert into public.accounts(id, space_id, name, initial_balance_cents)
values ('$account_id', '$space_id', 'Concurrency account', 0)
on conflict (id) do nothing;

insert into public.categories(id, space_id, kind, name)
values ('$transaction_category_id', '$space_id', 'expense', 'Concurrency expenses')
on conflict (id) do nothing;

insert into public.categories(id, space_id, kind, name)
values ('$parent_category_id', '$space_id', 'expense', 'Concurrency parent')
on conflict (id) do nothing;
SQL

account_archive_log="$(mktemp)"
account_write_log="$(mktemp)"
category_archive_log="$(mktemp)"
category_write_log="$(mktemp)"
trap 'rm -f "$account_archive_log" "$account_write_log" "$category_archive_log" "$category_write_log"' EXIT

# Session A holds the account row lock while session B attempts to create a movement.
docker exec "$container" psql --username postgres --dbname postgres --set ON_ERROR_STOP=1 \
  --command "begin; update public.accounts set archived_at = now() where id = '$account_id'; select pg_sleep(2); commit;" \
  >"$account_archive_log" 2>&1 &
archive_pid=$!
sleep 0.25

set +e
docker exec -i "$container" psql --username postgres --dbname postgres --set ON_ERROR_STOP=1 >"$account_write_log" 2>&1 <<SQL
begin;
select set_config('request.jwt.claims', '{"sub":"$user_id","role":"authenticated"}', true);
set local role authenticated;
insert into public.transactions(space_id, account_id, category_id, direction, amount_cents, occurred_on)
values ('$space_id', '$account_id', '$transaction_category_id', 'outflow', 100, current_date);
commit;
SQL
write_status=$?
set -e
wait "$archive_pid"

if [[ "$write_status" -eq 0 ]] || ! grep -q 'Il conto è archiviato' "$account_write_log"; then
  cat "$account_archive_log" "$account_write_log"
  echo "Concurrent transaction creation was not rejected after account archival."
  exit 1
fi

# Session A holds the parent-category row lock while session B creates a child.
docker exec "$container" psql --username postgres --dbname postgres --set ON_ERROR_STOP=1 \
  --command "begin; update public.categories set archived_at = now() where id = '$parent_category_id'; select pg_sleep(2); commit;" \
  >"$category_archive_log" 2>&1 &
archive_pid=$!
sleep 0.25

set +e
docker exec -i "$container" psql --username postgres --dbname postgres --set ON_ERROR_STOP=1 >"$category_write_log" 2>&1 <<SQL
begin;
select set_config('request.jwt.claims', '{"sub":"$user_id","role":"authenticated"}', true);
set local role authenticated;
insert into public.categories(space_id, parent_id, name)
values ('$space_id', '$parent_category_id', 'Late child category');
commit;
SQL
write_status=$?
set -e
wait "$archive_pid"

if [[ "$write_status" -eq 0 ]] || ! grep -q 'categoria archiviata' "$category_write_log"; then
  cat "$category_archive_log" "$category_write_log"
  echo "Concurrent child-category creation was not rejected after parent archival."
  exit 1
fi

echo "ALL_PASSED: concurrent transaction/account archival and child-category/parent archival are serialized."
