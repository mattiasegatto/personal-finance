import { describe, expect, it } from "vitest";
import { buildReport } from "@/lib/reports";

const data = {
  accounts: [{ id: "a", currency: "EUR" }, { id: "b", currency: "USD" }],
  categories: [{ id: "food", label: "Alimentari" }],
  transactions: [
    { id: "1", account_id: "a", occurred_on: "2026-10-02", direction: "inflow", amount_cents: 200000, operation_type: "ordinary", category_id: null },
    { id: "2", account_id: "a", occurred_on: "2026-10-04", direction: "outflow", amount_cents: 50000, operation_type: "ordinary", category_id: "food" },
    { id: "3", account_id: "a", occurred_on: "2026-10-05", direction: "outflow", amount_cents: 100000, operation_type: "transfer", category_id: null },
    { id: "4", account_id: "b", occurred_on: "2026-10-06", direction: "outflow", amount_cents: 90000, operation_type: "ordinary", category_id: null },
  ],
} as never;

describe("buildReport", () => {
  it("include solo movimenti ordinari nella valuta selezionata", () => {
    const report = buildReport(data, "EUR", 1, new Date(2026, 9, 15));
    expect(report.income).toBe(200000);
    expect(report.expenses).toBe(50000);
    expect(report.net).toBe(150000);
    expect(report.transactionCount).toBe(2);
    expect(report.expenseCategories).toEqual([{ category: "Alimentari", amount: 50000 }]);
  });
  it("mantiene le valute separate", () => {
    const report = buildReport(data, "USD", 1, new Date(2026, 9, 15));
    expect(report.income).toBe(0);
    expect(report.expenses).toBe(90000);
  });
});
