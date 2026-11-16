#!/usr/bin/env bash
set -euo pipefail

container="$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -n 1)"
if [[ -z "$container" ]]; then
  echo "Could not find the local Supabase database container."
  exit 1
fi

user_id="00000000-0000-0000-0000-00000000e101"
second_user_id="00000000-0000-0000-0000-00000000e108"
third_user_id="00000000-0000-0000-0000-00000000e111"
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

insert into auth.users(id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values ('$third_user_id','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
        'concurrency-member-c@test.local','{}',now(),now())
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

insert into public.space_memberships(space_id, user_id, role)
values ('$shared_space_id', '$third_user_id', 'member')
on conflict (space_id, user_id) do update set role = 'member';

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

if [[ "$write_status" -eq 0 ]] || ! grep -q 'categoria padre è archiviata' "$category_write_log"; then
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

# A former owner must not retain authority from an RLS snapshot after waiting on the space lock.
former_owner_log="$(mktemp)"
remove_owner_log="$(mktemp)"
trap 'rm -f "$account_archive_log" "$account_write_log" "$category_archive_log" "$category_write_log" "$former_owner_log" "$remove_owner_log"' EXIT

docker exec "$container" psql --username postgres --dbname postgres --set ON_ERROR_STOP=1 \
  --command "begin; select set_config('request.jwt.claims', json_build_object('sub','$second_user_id','role','authenticated')::text, true); set local role authenticated; delete from public.space_memberships where space_id='$shared_space_id' and user_id='$user_id'; select pg_sleep(2); commit;" \
  >"$remove_owner_log" 2>&1 &
remove_owner_pid=$!
sleep 0.25

set +e
docker exec "$container" psql --username postgres --dbname postgres --set ON_ERROR_STOP=1 \
  --command "begin; select set_config('request.jwt.claims', json_build_object('sub','$user_id','role','authenticated')::text, true); set local role authenticated; update public.space_memberships set role='owner' where space_id='$shared_space_id' and user_id='$third_user_id'; commit;" \
  >"$former_owner_log" 2>&1
former_owner_status=$?
set -e
wait "$remove_owner_pid"

if [[ "$former_owner_status" -eq 0 ]]; then
  if ! grep -q 'UPDATE 0' "$former_owner_log"; then
    cat "$remove_owner_log" "$former_owner_log"
    echo "A former owner retained membership-management authority."
    exit 1
  fi
elif ! grep -q 'Solo un owner può modificare le appartenenze' "$former_owner_log"; then
  cat "$remove_owner_log" "$former_owner_log"
  echo "Former-owner write failed for an unexpected reason."
  exit 1
fi
third_role="$(docker exec "$container" psql --username postgres --dbname postgres --tuples-only --no-align \
  --command "select role from public.space_memberships where space_id='$shared_space_id' and user_id='$third_user_id';")"
if [[ "$third_role" != "member" ]]; then
  cat "$remove_owner_log" "$former_owner_log"
  echo "A former owner promoted another member after removal."
  exit 1
fi

# Restore A as owner for the separate last-owner concurrency test.
docker exec "$container" psql --username postgres --dbname postgres --set ON_ERROR_STOP=1 \
  --command "insert into public.space_memberships(space_id,user_id,role) values ('$shared_space_id','$user_id','owner') on conflict (space_id,user_id) do update set role='owner';"

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


# Invitation acceptance must lock an existing membership before it locks the
# space. Otherwise acceptance (space -> membership) can deadlock with a role
# update (membership -> space).
fourth_user_id="00000000-0000-0000-0000-00000000e112"
fifth_user_id="00000000-0000-0000-0000-00000000e113"
fourth_email="concurrency-accept@test.local"
fifth_email="concurrency-invite@test.local"

docker exec -i "$container" psql --username postgres --dbname postgres --set ON_ERROR_STOP=1 <<SQL
insert into auth.users(id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values ('$fourth_user_id','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
        '$fourth_email','{}',now(),now()),
       ('$fifth_user_id','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
        '$fifth_email','{}',now(),now())
on conflict (id) do nothing;

insert into public.space_invitations(space_id,email,role,invited_by)
values ('$shared_space_id','$fourth_email','member','$second_user_id');

-- Simulate a membership created through another authorized path while its
-- invitation is pending; acceptance must serialize with its concurrent update.
insert into public.space_memberships(space_id,user_id,role)
values ('$shared_space_id','$fourth_user_id','member')
on conflict (space_id,user_id) do nothing;

create or replace function public.test_pause_invitation_membership_insert()
returns trigger language plpgsql set search_path = pg_catalog, public, pg_temp as $
begin
  if new.user_id = '$fourth_user_id'::uuid then
    perform pg_sleep(2);
  end if;
  return new;
end;
$;
create trigger z_test_pause_invitation_membership_insert
before insert on public.space_memberships
for each row execute function public.test_pause_invitation_membership_insert();
SQL

accept_membership_log="$(mktemp)"
update_membership_log="$(mktemp)"
trap 'rm -f "$account_archive_log" "$account_write_log" "$category_archive_log" "$category_write_log" "$membership_a_log" "$membership_b_log" "$shared_write_log" "$member_remove_log" "$accept_membership_log" "$update_membership_log"' EXIT

accept_invitation_id="$(docker exec "$container" psql --username postgres --dbname postgres --tuples-only --no-align \
  --command "select id from public.space_invitations where space_id='$shared_space_id' and email='$fourth_email' and status='pending' limit 1")"

docker exec "$container" psql --username postgres --dbname postgres --set ON_ERROR_STOP=1 \
  --command "begin; select set_config('request.jwt.claims', json_build_object('sub','$fourth_user_id','email','$fourth_email','role','authenticated')::text, true); set local role authenticated; select public.accept_invitation('$accept_invitation_id'); commit;" \
  >"$accept_membership_log" 2>&1 &
accept_pid=$!
sleep 0.3

set +e
docker exec "$container" psql --username postgres --dbname postgres --set ON_ERROR_STOP=1 \
  --command "begin; select set_config('request.jwt.claims', json_build_object('sub','$second_user_id','email','concurrency-owner-b@test.local','role','authenticated')::text, true); set local role authenticated; update public.space_memberships set role='viewer' where space_id='$shared_space_id' and user_id='$fourth_user_id'; commit;" \
  >"$update_membership_log" 2>&1
membership_update_status=$?
wait "$accept_pid"
accept_status=$?
set -e

if [[ "$accept_status" -ne 0 || "$membership_update_status" -ne 0 ]]; then
  cat "$accept_membership_log" "$update_membership_log"
  echo "Invitation acceptance deadlocked with a concurrent membership update."
  exit 1
fi

accepted_status="$(docker exec "$container" psql --username postgres --dbname postgres --tuples-only --no-align \
  --command "select status from public.space_invitations where id='$accept_invitation_id'")"
accepted_role="$(docker exec "$container" psql --username postgres --dbname postgres --tuples-only --no-align \
  --command "select role from public.space_memberships where space_id='$shared_space_id' and user_id='$fourth_user_id'")"
if [[ "$accepted_status" != "accepted" || "$accepted_role" != "viewer" ]]; then
  cat "$accept_membership_log" "$update_membership_log"
  echo "Invitation acceptance/membership update did not preserve the expected final state."
  exit 1
fi

docker exec -i "$container" psql --username postgres --dbname postgres --set ON_ERROR_STOP=1 <<SQL
drop trigger z_test_pause_invitation_membership_insert on public.space_memberships;
drop function public.test_pause_invitation_membership_insert();
insert into public.space_invitations(space_id,email,role,invited_by)
values ('$shared_space_id','$fifth_email','member','$second_user_id');
SQL

# The second race checks the shared advisory lock: acceptance has the invite
# row first and pauses before taking the space lock while the owner retries it.
accept_invite_lock_log="$(mktemp)"
duplicate_invite_log="$(mktemp)"
trap 'rm -f "$account_archive_log" "$account_write_log" "$category_archive_log" "$category_write_log" "$membership_a_log" "$membership_b_log" "$shared_write_log" "$member_remove_log" "$accept_membership_log" "$update_membership_log" "$accept_invite_lock_log" "$duplicate_invite_log"' EXIT

fifth_invitation_id="$(docker exec "$container" psql --username postgres --dbname postgres --tuples-only --no-align \
  --command "select id from public.space_invitations where space_id='$shared_space_id' and email='$fifth_email' and status='pending' limit 1")"

docker exec "$container" psql --username postgres --dbname postgres --set ON_ERROR_STOP=1 \
  --command "begin; select pg_advisory_xact_lock(hashtextextended('$shared_space_id' || ':' || '$fifth_email',0)); select id from public.space_invitations where id='$fifth_invitation_id' for update; select pg_sleep(2); select id from public.spaces where id='$shared_space_id' for update; insert into public.space_memberships(space_id,user_id,role) values ('$shared_space_id','$fifth_user_id','member') on conflict (space_id,user_id) do nothing; update public.space_invitations set status='accepted' where id='$fifth_invitation_id'; commit;" \
  >"$accept_invite_lock_log" 2>&1 &
manual_accept_pid=$!
sleep 0.3

set +e
docker exec "$container" psql --username postgres --dbname postgres --set ON_ERROR_STOP=1 \
  --command "begin; select set_config('request.jwt.claims', json_build_object('sub','$second_user_id','email','concurrency-owner-b@test.local','role','authenticated')::text, true); set local role authenticated; select public.invite_to_space('$shared_space_id','$fifth_email','member'); commit;" \
  >"$duplicate_invite_log" 2>&1
duplicate_invite_status=$?
wait "$manual_accept_pid"
manual_accept_status=$?
set -e

if [[ "$manual_accept_status" -ne 0 || "$duplicate_invite_status" -eq 0 ]] \
  || ! grep -q 'L’utente è già membro dello spazio' "$duplicate_invite_log"; then
  cat "$accept_invite_lock_log" "$duplicate_invite_log"
  echo "Concurrent invitation creation/acceptance did not serialize safely."
  exit 1
fi

echo "ALL_PASSED: transaction, recurrence, deadline, category, membership, invitation and shared-write concurrency checks passed."
