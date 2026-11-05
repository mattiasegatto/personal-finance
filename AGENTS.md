<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules
- Domain types live in `src/lib/domain.ts`; every record belongs to a Space (personal or shared) and access goes through SpaceMembership — why: shared members must never see each other's private data.
- Shared expenses reference personal bank transactions via `linkedTransactionId` instead of copying them — why: avoid duplicated outflows.
- Settlements are their own entity, never income or shared expenses — why: reimbursements only move debt between members.
- Splits are a per-member `shares` list — why: future N participants and variable quotas.
- Backend phases: auth/spaces (phase 1) and personal accounts, categories and transactions (phase 2, `src/lib/finance.ts`) live in Lovable Cloud; dashboard and shared expenses still use demo data from `src/lib/mock-data.ts` until the user approves the next phase — why: phased rollout with explicit approval.
- Money is stored as positive integer cents with a separate `direction`; account balance is never stored, it is derived (`account_balances` view = initial balance + inflows − outflows of non-deleted transactions); transactions are soft-deleted and every change is logged in `transaction_revisions` — why: balances must always match movements and history must survive.
- Cross-record integrity (same space for account/category/transaction, category kind matches direction, two-level categories, no delete of accounts with movements, archive only at zero balance) is enforced by SECURITY DEFINER triggers, so checks see rows hidden by RLS — why: invoker triggers missed cross-space references.
- Space access is enforced in the database (RLS via security-definer helpers `is_space_member`/`has_space_role`); spaces and memberships are created only through RPCs (`create_shared_space`, `invite_to_space`, `accept_invitation`) and a signup trigger creates the personal space — why: client code must never be able to grant itself access.
- Personal spaces have exactly one owner member and cannot be archived; shared spaces always keep at least one owner (DB triggers) — why: strict personal/shared separation.
- Authorization tests live in `supabase/tests/rls_isolation.sql` and `supabase/tests/finance_isolation.sql` and run in a rolled-back transaction — why: verify isolation without leaving data.
- Signed-in pages live under `src/routes/_authenticated/` (client-only gate, sidebar layout); `/auth` and `/reset-password` are public — why: session is in browser storage.
- SplitDialog is mounted only while editing and preserves original shares until an explicit change; its named export supports calculation regression tests — why: cancel must discard drafts and unchanged saves must not round monetary shares.
