import { describe, expect, it } from "vitest";
import { summarize, type Finance } from "@/lib/dashboard";

const tx = (
  id: string,
  operation_type: "ordinary" | "transfer",
  direction: "inflow" | "outflow",
  amount_cents: number,
  account_id = "checking",
) =>
  ({
    id,
    operation_type,
    direction,
    amount_cents,
    account_id,
    occurred_on: "2026-11-12",
  }) as unknown as Finance["transactions"][number];

const data = {
  spaceId: "space",
  accounts: [
    { id: "checking", type: "checking", currency: "EUR", archived_at: null, balance_cents: 170000 },
    { id: "savings", type: "savings", currency: "EUR", archived_at: null, balance_cents: 30000 },
  ],
  categories: [],
  transactions: [
    tx("salary", "ordinary", "inflow", 200000),
    tx("rent", "ordinary", "outflow", 70000),
    tx("leg-out", "transfer", "outflow", 30000),
    tx("leg-in", "transfer", "inflow", 30000, "savings"),
  ],
  transfers: [],
  investments: [],
  debts: [],
} as unknown as Finance;

describe("summarize", () => {
  it("esclude le gambe dei trasferimenti da entrate e uscite del mese", () => {
    // Regressione: un trasferimento tra conti propri risultava entrata e uscita.
    const [eur] = summarize(data, "2026-11");
    expect(eur?.income).toBe(200000);
    expect(eur?.expenses).toBe(70000);
    expect(eur?.netWorth).toBe(200000);
  });
});
