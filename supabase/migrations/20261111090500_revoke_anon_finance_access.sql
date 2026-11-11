revoke all on public.accounts, public.categories, public.transactions, public.transaction_revisions, public.account_balances from anon, public;
revoke all on sequence public.transaction_revisions_id_seq from anon, public;
revoke execute on function public.category_root_kind(uuid) from public, anon;
grant execute on function public.category_root_kind(uuid) to authenticated;