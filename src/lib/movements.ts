import type { Direction } from "@/lib/finance";

type OrdinaryMovement = {
  id: string;
  /** Only ordinary movements are listed; transfer legs are shown through their transfer. */
  operation_type: "ordinary" | "transfer";
  account_id: string;
  direction: Direction;
  category_id: string | null;
  categoryLabel: string;
  occurred_on: string;
  created_at: string;
  description: string | null;
  amount_cents: number;
};
type TransferMovement = {
  id: string;
  source_account_id: string;
  destination_account_id: string;
  occurred_on: string;
  created_at: string;
  description: string | null;
  amount_cents: number;
};
type Category = { id: string; parent_id: string | null };
type MovementFilter = {
  accountId?: string;
  direction?: Direction | "all";
  categoryId?: string;
  from?: string;
  to?: string;
  query?: string;
};
/** Valore usato dai filtri dell'interfaccia per "tutti" (conti, direzioni, categorie). */
export const ALL_MOVEMENTS = "__all";

export type MovementSelection = {
  account: string;
  direction: string;
  category: string;
  from: string;
  to: string;
  query: string;
};

/** Traduce lo stato dei filtri dell'interfaccia nel filtro di buildMovementList. */
export function movementFilterFromSelection(selection: MovementSelection): MovementFilter {
  return {
    ...(selection.account !== ALL_MOVEMENTS && { accountId: selection.account }),
    direction: selection.direction === ALL_MOVEMENTS ? "all" : (selection.direction as Direction),
    categoryId: selection.category === ALL_MOVEMENTS ? "all" : selection.category,
    from: selection.from,
    to: selection.to,
    query: selection.query,
  };
}

export type MovementRow =
  { kind: "ordinary"; data: OrdinaryMovement } | { kind: "transfer"; data: TransferMovement };

export function buildMovementList(
  transactions: OrdinaryMovement[],
  transfers: TransferMovement[],
  categories: Category[],
  filter: MovementFilter = {},
): MovementRow[] {
  const { accountId, direction = "all", categoryId = "all", from, to, query = "" } = filter;
  const normalizedQuery = query.toLowerCase();
  const ordinary: MovementRow[] = transactions
    .filter(
      (t) =>
        t.operation_type === "ordinary" &&
        (!accountId || t.account_id === accountId) &&
        (direction === "all" || t.direction === direction) &&
        (categoryId === "all" ||
          t.category_id === categoryId ||
          categories.find((c) => c.id === t.category_id)?.parent_id === categoryId) &&
        (!from || t.occurred_on >= from) &&
        (!to || t.occurred_on <= to) &&
        (!normalizedQuery ||
          ((t.description ?? "") + " " + t.categoryLabel).toLowerCase().includes(normalizedQuery)),
    )
    .map((data) => ({ kind: "ordinary" as const, data }));
  const transferRows: MovementRow[] = transfers
    .filter(
      (t) =>
        (!accountId ||
          t.source_account_id === accountId ||
          t.destination_account_id === accountId) &&
        direction === "all" &&
        categoryId === "all" &&
        (!from || t.occurred_on >= from) &&
        (!to || t.occurred_on <= to) &&
        (!normalizedQuery ||
          (t.description ?? "Trasferimento").toLowerCase().includes(normalizedQuery)),
    )
    .map((data) => ({ kind: "transfer" as const, data }));
  return [...ordinary, ...transferRows].sort(
    (a, b) =>
      b.data.occurred_on.localeCompare(a.data.occurred_on) ||
      b.data.created_at.localeCompare(a.data.created_at),
  );
}

export function movementTotals(rows: MovementRow[]) {
  const ordinary = rows.filter(
    (row): row is Extract<MovementRow, { kind: "ordinary" }> => row.kind === "ordinary",
  );
  return {
    inflow: ordinary
      .filter((row) => row.data.direction === "inflow")
      .reduce((sum, row) => sum + row.data.amount_cents, 0),
    outflow: ordinary
      .filter((row) => row.data.direction === "outflow")
      .reduce((sum, row) => sum + row.data.amount_cents, 0),
  };
}
