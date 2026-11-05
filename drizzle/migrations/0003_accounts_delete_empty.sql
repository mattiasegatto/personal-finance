grant delete on public.accounts to authenticated;
create policy "accounts: owner/member eliminano conti vuoti" on public.accounts for delete to authenticated
  using (public.has_space_role(space_id, auth.uid(), array['owner','member']::public.space_role[]));
create or replace function public.guard_account_delete() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from transactions where account_id = old.id) then
    raise exception 'Non puoi eliminare un conto che contiene movimenti: archivialo.'; end if;
  return old;
end $$;
create trigger accounts_guard_delete before delete on public.accounts for each row execute function public.guard_account_delete();