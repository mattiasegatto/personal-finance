import { describe, expect, it } from "vitest";
import {
  ALL_MOVEMENTS,
  buildMovementList,
  movementFilterFromSelection,
  movementTotals,
} from "@/lib/movements";

const transactions = [
  {
    id: "income",
    operation_type: "ordinary" as const,
    account_id: "checking",
    direction: "inflow" as const,
    category_id: "salary",
    categoryLabel: "Stipendio",
    occurred_on: "2026-11-10",
    created_at: "2026-11-10T10:00:00Z",
    description: "Stipendio",
    amount_cents: 250000,
  },
  {
    id: "expense",
    operation_type: "ordinary" as const,
    account_id: "checking",
    direction: "outflow" as const,
    category_id: "food",
    categoryLabel: "Casa › Alimentari",
    occurred_on: "2026-11-09",
    created_at: "2026-11-09T10:00:00Z",
    description: "Spesa",
    amount_cents: 12500,
  },
];
const transfers = [
  {
    id: "transfer-1",
    source_account_id: "checking",
    destination_account_id: "savings",
    occurred_on: "2026-11-08",
    created_at: "2026-11-08T10:00:00Z",
    description: "Risparmio mensile",
    amount_cents: 50000,
  },
];
const categories = [
  { id: "food", parent_id: "home" },
  { id: "home", parent_id: null },
];

describe("buildMovementList", () => {
  it("mostra ogni trasferimento una sola volta", () => {
    const rows = buildMovementList(transactions, transfers, categories);
    expect(rows.filter((row) => row.kind === "transfer")).toHaveLength(1);
    expect(rows.map((row) => row.data.id)).toEqual(["income", "expense", "transfer-1"]);
  });

  it("include il trasferimento filtrando sia il conto origine sia quello destinazione", () => {
    expect(
      buildMovementList(transactions, transfers, categories, { accountId: "checking" }).some(
        (row) => row.data.id === "transfer-1",
      ),
    ).toBe(true);
    expect(
      buildMovementList(transactions, transfers, categories, { accountId: "savings" }).map(
        (row) => row.data.id,
      ),
    ).toEqual(["transfer-1"]);
  });

  it("esclude i trasferimenti dai filtri per direzione e categoria", () => {
    expect(
      buildMovementList(transactions, transfers, categories, { direction: "outflow" }).map(
        (row) => row.data.id,
      ),
    ).toEqual(["expense"]);
    expect(
      buildMovementList(transactions, transfers, categories, { categoryId: "home" }).map(
        (row) => row.data.id,
      ),
    ).toEqual(["expense"]);
  });

  it("calcola entrate e uscite senza includere i trasferimenti", () => {
    const rows = buildMovementList(transactions, transfers, categories);
    expect(movementTotals(rows)).toEqual({ inflow: 250000, outflow: 12500 });
  });
});

describe("movementFilterFromSelection", () => {
  const all = {
    account: ALL_MOVEMENTS,
    direction: ALL_MOVEMENTS,
    category: ALL_MOVEMENTS,
    from: "",
    to: "",
    query: "",
  };

  it("con tutti i filtri su 'tutti' mostra movimenti e trasferimenti", () => {
    // Regressione: il valore "tutte le categorie" dell'interfaccia escludeva ogni movimento.
    const rows = buildMovementList(
      transactions,
      transfers,
      categories,
      movementFilterFromSelection(all),
    );
    expect(rows).toHaveLength(transactions.length + transfers.length);
  });

  it("applica i filtri specifici scelti nell'interfaccia", () => {
    const rows = buildMovementList(
      transactions,
      transfers,
      categories,
      movementFilterFromSelection({ ...all, direction: "outflow" }),
    );
    expect(rows.map((r) => r.data.id)).toEqual(["expense"]);
  });
});

describe("buildMovementList con trasferimenti", () => {
  it("non elenca le gambe dei trasferimenti come movimenti ordinari", () => {
    // Regressione: le due gambe comparivano accanto al trasferimento e gonfiavano i totali.
    const legs = [
      {
        ...transactions[0]!,
        id: "leg-out",
        operation_type: "transfer" as const,
        direction: "outflow" as const,
        category_id: null,
        categoryLabel: "—",
      },
      {
        ...transactions[0]!,
        id: "leg-in",
        operation_type: "transfer" as const,
        direction: "inflow" as const,
        category_id: null,
        categoryLabel: "—",
      },
    ];
    const rows = buildMovementList([...transactions, ...legs], transfers, categories);
    expect(rows.map((r) => r.data.id)).not.toContain("leg-out");
    expect(rows.map((r) => r.data.id)).not.toContain("leg-in");
    expect(movementTotals(rows)).toEqual(
      movementTotals(buildMovementList(transactions, transfers, categories)),
    );
  });
});
