-- Enum values for brokerage accounts and investment trades. Kept in a separate
-- migration because PostgreSQL does not allow using a newly added enum value
-- in the same transaction that adds it.
alter type public.account_type add value if not exists 'brokerage';
alter type public.tx_operation add value if not exists 'investment';
