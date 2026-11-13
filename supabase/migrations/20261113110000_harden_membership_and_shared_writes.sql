-- Restrict membership predicates to the authenticated caller so they cannot
-- be used as an oracle to enumerate other users' space memberships or roles.
create or replace function public.is_space_member(_space uuid, _user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select _user = auth.uid()
    and exists (
      select 1
      from public.space_memberships
      where space_id = _space and user_id = auth.uid()
    )
$$;

create or replace function public.has_space_role(_space uuid, _user uuid, _roles public.space_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select _user = auth.uid()
    and exists (
      select 1
      from public.space_memberships
      where space_id = _space
        and user_id = auth.uid()
        and role = any(_roles)
    )
$$;

create or replace function public.shares_shared_space(_a uuid, _b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select _a = auth.uid()
    and exists (
      select 1
      from public.space_memberships a
      join public.space_memberships b on a.space_id = b.space_id
      join public.spaces s on s.id = a.space_id
      where a.user_id = auth.uid()
        and b.user_id = _b
        and s.kind = 'shared'
        and s.archived_at is null
    )
$$;

-- Invitations may only be revoked by an owner; all other fields are immutable
-- through the client. The invitation-acceptance RPC remains the only path to
-- transition a pending invitation to accepted.
revoke all on public.space_invitations from public, anon;
revoke update on public.space_invitations from authenticated;
grant select on public.space_invitations to authenticated;
grant update (status) on public.space_invitations to authenticated;

drop policy if exists "invitations: owner revoca" on public.space_invitations;
create policy "invitations: owner revoca" on public.space_invitations
for update to authenticated
using (public.has_space_role(space_id, auth.uid(), array['owner']::public.space_role[]))
with check (
  public.has_space_role(space_id, auth.uid(), array['owner']::public.space_role[])
  and status = 'revoked'
);

-- Shared records are written only through validated SECURITY DEFINER RPCs.
revoke all on public.shared_expenses, public.shared_expense_shares,
  public.shared_settlements from public, anon, authenticated;
grant select on public.shared_expenses, public.shared_expense_shares,
  public.shared_settlements to authenticated;

-- These tables support direct authenticated reads/writes under RLS, but never
-- expose table-level privileges (especially TRUNCATE) to anon or PUBLIC.
revoke all on public.investments, public.financial_debts,
  public.recurring_items, public.deadlines from public, anon;
