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
- Prototype phase: demo data only in `src/lib/mock-data.ts`, no backend/auth — why: user requested visual prototype first.
- SplitDialog is mounted only while editing and preserves original shares until an explicit change; its named export supports calculation regression tests — why: cancel must discard drafts and unchanged saves must not round monetary shares.
