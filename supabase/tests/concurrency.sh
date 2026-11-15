#!/usr/bin/env bash
set -euo pipefail

container="$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -n 1)"
if [[ -z "$container" ]]; then
  echo "Could not find the local Supabase database container."
  exit 1
fi

user_id="00000000-0000-0000-0000-00000000e101"
second_user_id="00000000-0000-0000-0000-00000000e108"
shared_space_id="00000000-0000-0000-0000-00000000e109"
shared_category_id="00000000-0000-0000-0000-00000000e110"
account_id="00000000-0000-0000-0000-00000000e102"
transaction_category_id="00000000-0000-0000-0000-00000000e103"
parent_category_id="00000000-0000-0000-0000-00000000e104"
recurring_account_id="00000000-0000-0000-0000-00000000e105"
deadline_category_id="00000000-0000-0000-0000-00000000e106"
deadline_account_id="00000000-0000-0000-0000-00000000e107"
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
insert into auth.users(id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values ('$second_user_id','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
        'concurrency-owner-b@test.local','{}',now(),now())
on conflict (id) do nothing;

insert into public.spaces(id, kind, name, created_by)
values ('$shared_space_id', 'shared', 'Concurrent owner test', '$user_id')
on conflict (id) do nothing;

insert into public.space_memberships(space_id, user_id, role)
values ('$shared_space_id', '$user_id', 'owner')
on conflict (space_id, user_id) do update set role = 'owner';

insert into public.space_memberships(space_id, user_id, role)
values ('$shared_space_id', '$second_user_id', 'owner')
on conflict (space_id, user_id) do update set role = 'owner';

insert into public.categories(id, space_id, kind, name)
values ('$shared_category_id', '$shared_space_id', 'expense', 'Concurrent shared expenses')
on conflict (id) do nothing;
SQL

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

insert into public.accounts(id, space_id, name, initial_balance_cents)
values ('$recurring_account_id', '$space_id', 'Concurrency recurring account', 0)
on conflict (id) do nothing;

insert into public.accounts(id, space_id, name, initial_balance_cents)
values ('$deadline_account_id', '$space_id', 'Concurrency deadline account', 0)
on conflict (id) do nothing;

insert into public.categories(id, space_id, kind, name)
values ('$deadline_category_id', '$space_id', 'expense', 'Concurrency deadline category')
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

# A recurring item must not be created against an account being archived.
docker exec "$container" psql --username postgres --dbname postgres --set ON_ERROR_STOP=1 \
  --command "begin; update public.accounts set archived_at = now() where id = '$recurring_account_id'; select pg_sleep(2); commit;" \
  >"$account_archive_log" 2>&1 &
archive_pid=$!
sleep 0.25

set +e
docker exec -i "$container" psql --username postgres --dbname postgres --set ON_ERROR_STOP=1 >"$account_write_log" 2>&1 <<SQL
begin;
select set_config('request.jwt.claims', '{"sub":"$user_id","role":"authenticated"}', true);
set local role authenticated;
insert into public.recurring_items(space_id, account_id, category_id, direction, amount_cents, description, frequency, start_on, next_due_on)
values ('$space_id', '$recurring_account_id', '$transaction_category_id', 'outflow', 100, 'Concurrent recurrence', 'monthly', current_date, current_date);
commit;
SQL
write_status=$?
set -e
wait "$archive_pid"

if [[ "$write_status" -eq 0 ]] || ! grep -q 'conto attivo' "$account_write_log"; then
  cat "$account_archive_log" "$account_write_log"
  echo "Concurrent recurring-item creation was not rejected after account archival."
  exit 1
fi

# A deadline must not be created against a category being archived.
docker exec "$container" psql --username postgres --dbname postgres --set ON_ERROR_STOP=1 \
  --command "begin; update public.categories set archived_at = now() where id = '$deadline_category_id'; select pg_sleep(2); commit;" \
  >"$category_archive_log" 2>&1 &
archive_pid=$!
sleep 0.25

set +e
docker exec -i "$container" psql --username postgres --dbname postgres --set ON_ERROR_STOP=1 >"$category_write_log" 2>&1 <<SQL
begin;
select set_config('request.jwt.claims', '{"sub":"$user_id","role":"authenticated"}', true);
set local role authenticated;
insert into public.deadlines(space_id, account_id, category_id, direction, amount_cents, title, due_on)
values ('$space_id', '$deadline_account_id', '$deadline_category_id', 'outflow', 100, 'Concurrent deadline', current_date);
commit;
SQL
write_status=$?
set -e
wait "$archive_pid"

if [[ "$write_status" -eq 0 ]] || ! grep -q 'Categoria non valida o archiviata' "$category_write_log"; then
  cat "$category_archive_log" "$category_write_log"
  echo "Concurrent deadline creation was not rejected after category archival."
  exit 1
fi

# Two concurrent owner demotions must serialize; the second cannot remove the last owner.
membership_a_log="$(mktemp)"
membership_b_log="$(mktemp)"
trap 'rm -f "$account_archive_log" "$account_write_log" "$category_archive_log" "$category_write_log" "$membership_a_log" "$membership_b_log"' EXIT

docker exec "$container" psql --username postgres --dbname postgres --set ON_ERROR_STOP=1 \
  --command "begin; select set_config('request.jwt.claims', json_build_object('sub','$user_id','role','authenticated')::text, true); set local role authenticated; update public.space_memberships set role='member' where space_id='$shared_space_id' and user_id='$user_id'; select pg_sleep(2); commit;" \
  >"$membership_a_log" 2>&1 &
owner_a_pid=$!
sleep 0.25

set +e
docker exec "$container" psql --username postgres --dbname postgres --set ON_ERROR_STOP=1 \
  --command "begin; select set_config('request.jwt.claims', json_build_object('sub','$second_user_id','role','authenticated')::text, true); set local role authenticated; update public.space_memberships set role='member' where space_id='$shared_space_id' and user_id='$second_user_id'; commit;" \
  >"$membership_b_log" 2>&1
owner_b_status=$?
set -e
wait "$owner_a_pid"

if [[ "$owner_b_status" -eq 0 ]] || ! grep -q 'deve avere almeno un owner' "$membership_b_log"; then
  cat "$membership_a_log" "$membership_b_log"
  echo "Concurrent owner demotions left a shared space without an owner."
  exit 1
fi

# A member removed while an expense RPC is waiting for the space lock must not write afterward.
shared_write_log="$(mktemp)"
member_remove_log="$(mktemp)"
trap 'rm -f "$account_archive_log" "$account_write_log" "$category_archive_log" "$category_write_log" "$membership_a_log" "$membership_b_log" "$shared_write_log" "$member_remove_log"' EXIT

docker exec "$container" psql --username postgres --dbname postgres --set ON_ERROR_STOP=1 \
  --command "begin; select set_config('request.jwt.claims', json_build_object('sub','$second_user_id','role','authenticated')::text, true); set local role authenticated; delete from public.space_memberships where space_id='$shared_space_id' and user_id='$user_id'; select pg_sleep(2); commit;" \
  >"$member_remove_log" 2>&1 &
remove_pid=$!
sleep 0.25

set +e
docker exec "$container" psql --username postgres --dbname postgres --set ON_ERROR_STOP=1 \
  --command "begin; select set_config('request.jwt.claims', json_build_object('sub','$user_id','role','authenticated')::text, true); set local role authenticated; select public.save_shared_expense(null,'$shared_space_id',current_date,'Race dopo rimozione', '$shared_category_id',100,'$second_user_id','amount',jsonb_build_array(jsonb_build_object('member_user_id','$second_user_id','amount_cents',100)),null); commit;" \
  >"$shared_write_log" 2>&1
shared_write_status=$?
set -e
wait "$remove_pid"

if [[ "$shared_write_status" -eq 0 ]] || ! grep -q 'Non hai i permessi per modificare questa spesa' "$shared_write_log"; then
  cat "$member_remove_log" "$shared_write_log"
  echo "A removed member was still able to create a shared expense."
  exit 1
fi

echo "ALL_PASSED: transaction, recurrence, deadline, category, membership and shared-write concurrency checks passed."
