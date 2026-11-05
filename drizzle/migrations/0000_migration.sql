-- ===== Tipi =====
create type public.space_kind as enum ('personal','shared');
create type public.space_role as enum ('owner','member','viewer');
create type public.invitation_status as enum ('pending','accepted','revoked');

-- ===== Profili =====
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;

-- ===== Spazi =====
create table public.spaces (
  id uuid primary key default gen_random_uuid(),
  kind public.space_kind not null,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  created_by uuid not null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index spaces_one_personal_per_user on public.spaces(created_by) where kind = 'personal';
grant select, update on public.spaces to authenticated;
grant all on public.spaces to service_role;
alter table public.spaces enable row level security;

-- ===== Appartenenze =====
create table public.space_memberships (
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null,
  role public.space_role not null,
  created_at timestamptz not null default now(),
  primary key (space_id, user_id)
);
create index space_memberships_user_idx on public.space_memberships(user_id);
grant select, update, delete on public.space_memberships to authenticated;
grant all on public.space_memberships to service_role;
alter table public.space_memberships enable row level security;

-- ===== Inviti =====
create table public.space_invitations (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and email like '%_@_%'),
  role public.space_role not null default 'member' check (role <> 'owner'),
  invited_by uuid not null,
  status public.invitation_status not null default 'pending',
  created_at timestamptz not null default now()
);
create unique index space_invitations_one_pending on public.space_invitations(space_id, email) where status = 'pending';
grant select, update on public.space_invitations to authenticated;
grant all on public.space_invitations to service_role;
alter table public.space_invitations enable row level security;

-- ===== Funzioni di controllo (security definer, niente ricorsione RLS) =====
create or replace function public.is_space_member(_space uuid, _user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.space_memberships where space_id = _space and user_id = _user)
$$;

create or replace function public.has_space_role(_space uuid, _user uuid, _roles public.space_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.space_memberships where space_id = _space and user_id = _user and role = any(_roles))
$$;

create or replace function public.shares_shared_space(_a uuid, _b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.space_memberships a
    join public.space_memberships b on a.space_id = b.space_id
    join public.spaces s on s.id = a.space_id
    where a.user_id = _a and b.user_id = _b and s.kind = 'shared' and s.archived_at is null)
$$;

create or replace function public.current_email()
returns text language sql stable as $$ select lower(coalesce(auth.jwt() ->> 'email','')) $$;

-- ===== Policy =====
create policy "profiles: leggi il proprio o di chi condivide uno spazio" on public.profiles
  for select to authenticated using (id = auth.uid() or public.shares_shared_space(auth.uid(), id));
create policy "profiles: modifica il proprio" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "spaces: solo i membri leggono" on public.spaces
  for select to authenticated using (public.is_space_member(id, auth.uid()));
create policy "spaces: solo owner modifica" on public.spaces
  for update to authenticated using (public.has_space_role(id, auth.uid(), array['owner']::public.space_role[]))
  with check (public.has_space_role(id, auth.uid(), array['owner']::public.space_role[]));

create policy "memberships: i membri vedono i membri dello stesso spazio" on public.space_memberships
  for select to authenticated using (public.is_space_member(space_id, auth.uid()));
create policy "memberships: owner cambia ruoli" on public.space_memberships
  for update to authenticated using (public.has_space_role(space_id, auth.uid(), array['owner']::public.space_role[]))
  with check (public.has_space_role(space_id, auth.uid(), array['owner']::public.space_role[]));
create policy "memberships: owner rimuove o il membro esce" on public.space_memberships
  for delete to authenticated using (user_id = auth.uid() or public.has_space_role(space_id, auth.uid(), array['owner']::public.space_role[]));

create policy "invitations: owner dello spazio o destinatario leggono" on public.space_invitations
  for select to authenticated using (public.has_space_role(space_id, auth.uid(), array['owner']::public.space_role[]) or email = public.current_email());
create policy "invitations: owner revoca" on public.space_invitations
  for update to authenticated using (public.has_space_role(space_id, auth.uid(), array['owner']::public.space_role[]))
  with check (status = 'revoked');

-- ===== Vincoli tramite trigger =====
create or replace function public.touch_updated_at() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end $$;
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger spaces_touch before update on public.spaces for each row execute function public.touch_updated_at();

-- Campi immutabili degli spazi; spazio personale non archiviabile
create or replace function public.guard_space_update() returns trigger language plpgsql set search_path = public as $$
begin
  if new.kind <> old.kind or new.created_by <> old.created_by or new.created_at <> old.created_at then
    raise exception 'Tipo, autore e data di creazione di uno spazio non sono modificabili';
  end if;
  if old.kind = 'personal' and new.archived_at is not null then
    raise exception 'Lo spazio personale non può essere archiviato';
  end if;
  return new;
end $$;
create trigger spaces_guard before update on public.spaces for each row execute function public.guard_space_update();

-- Appartenenze: personale = solo il suo titolare; sempre almeno un owner negli spazi condivisi
create or replace function public.guard_membership() returns trigger language plpgsql security definer set search_path = public as $$
declare s public.spaces;
begin
  if tg_op in ('INSERT','UPDATE') then
    select * into s from public.spaces where id = new.space_id;
    if tg_op = 'UPDATE' and (new.space_id <> old.space_id or new.user_id <> old.user_id) then
      raise exception 'Spazio e utente di un''appartenenza non sono modificabili';
    end if;
    if s.kind = 'personal' and (new.user_id <> s.created_by or new.role <> 'owner') then
      raise exception 'Lo spazio personale appartiene solo al suo titolare';
    end if;
  end if;
  if tg_op in ('UPDATE','DELETE') then
    select * into s from public.spaces where id = old.space_id;
    if s.id is null then return coalesce(new, old); end if; -- spazio in cancellazione
    if s.kind = 'personal' and tg_op = 'DELETE' then
      raise exception 'Non si può uscire dal proprio spazio personale';
    end if;
    if s.kind = 'shared' and old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner')
       and not exists (select 1 from public.space_memberships where space_id = old.space_id and role = 'owner' and user_id <> old.user_id) then
      raise exception 'Uno spazio condiviso deve avere almeno un owner';
    end if;
  end if;
  return coalesce(new, old);
end $$;
create trigger memberships_guard before insert or update or delete on public.space_memberships
  for each row execute function public.guard_membership();

-- ===== Registrazione: profilo + spazio personale =====
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  insert into public.profiles(id, display_name)
  values (new.id, left(coalesce(new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1), ''), 80));
  insert into public.spaces(kind, name, created_by) values ('personal', 'Spazio personale', new.id) returning id into sid;
  insert into public.space_memberships(space_id, user_id, role) values (sid, new.id, 'owner');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ===== Operazioni (RPC) =====
create or replace function public.create_shared_space(_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare sid uuid; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Accesso richiesto'; end if;
  insert into public.spaces(kind, name, created_by) values ('shared', btrim(_name), uid) returning id into sid;
  insert into public.space_memberships(space_id, user_id, role) values (sid, uid, 'owner');
  return sid;
end $$;

create or replace function public.invite_to_space(_space uuid, _email text, _role public.space_role default 'member') returns uuid
language plpgsql security definer set search_path = public as $$
declare iid uuid; s public.spaces;
begin
  if not public.has_space_role(_space, auth.uid(), array['owner']::public.space_role[]) then raise exception 'Solo un owner può invitare'; end if;
  select * into s from public.spaces where id = _space;
  if s.kind <> 'shared' then raise exception 'Lo spazio personale non accetta inviti'; end if;
  if s.archived_at is not null then raise exception 'Lo spazio è archiviato'; end if;
  if _role = 'owner' then raise exception 'Gli inviti non possono assegnare il ruolo owner'; end if;
  if lower(btrim(_email)) = public.current_email() then raise exception 'Non puoi invitare te stesso'; end if;
  insert into public.space_invitations(space_id, email, role, invited_by)
  values (_space, lower(btrim(_email)), _role, auth.uid()) returning id into iid;
  return iid;
end $$;

create or replace function public.accept_invitation(_invitation uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare inv public.space_invitations;
begin
  select * into inv from public.space_invitations where id = _invitation for update;
  if inv.id is null or inv.status <> 'pending' or inv.email <> public.current_email() or public.current_email() = '' then
    raise exception 'Invito non valido';
  end if;
  insert into public.space_memberships(space_id, user_id, role) values (inv.space_id, auth.uid(), inv.role)
  on conflict (space_id, user_id) do nothing;
  update public.space_invitations set status = 'accepted' where id = inv.id;
  return inv.space_id;
end $$;

revoke all on function public.create_shared_space(text), public.invite_to_space(uuid,text,public.space_role), public.accept_invitation(uuid) from public, anon;
grant execute on function public.create_shared_space(text), public.invite_to_space(uuid,text,public.space_role), public.accept_invitation(uuid) to authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;