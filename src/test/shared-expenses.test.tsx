import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { equalShares, netBalances, type SharedExpense } from "@/lib/domain";
import { sharedExpenses, settlements, transactions } from "@/lib/mock-data";
import { SplitDialog } from "@/routes/spese-condivise";

// jsdom has no layout observer; the slider requires the browser API to mount.
beforeEach(() => vi.stubGlobal("ResizeObserver", class {
  observe() {}
  unobserve() {}
  disconnect() {}
}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const expense = (amount: number, paidBy = "m1"): SharedExpense => ({
  id: "test", spaceId: "s-casa", date: "2026-10-28", description: "Demo",
  category: "Casa", amount, paidBy, splitMode: "equal", shares: equalShares(amount, ["m1", "m2"]),
});
const dinner = sharedExpenses.find((e) => e.id === "e3");
function openSplit(e: SharedExpense) {
  const onSave = vi.fn();
  const view = render(<SplitDialog expense={e} onClose={vi.fn()} onSave={onSave} />);
  return { ...view, onSave };
}

describe("Shared expense accounting (demo)", () => {
  it("defaults to 50/50 and allocates every cent", () => {
    expect(equalShares(100, ["m1", "m2"])).toEqual([{ memberId: "m1", amount: 50 }, { memberId: "m2", amount: 50 }]);
    expect(equalShares(72.31, ["m1", "m2"])).toEqual([{ memberId: "m1", amount: 36.16 }, { memberId: "m2", amount: 36.15 }]);
    expect(sharedExpenses.filter((e) => e.splitMode === "equal").every((e) => JSON.stringify(e.shares) === JSON.stringify(equalShares(e.amount, ["m1", "m2"])))).toBe(true);
  });
  it("uses actual paid amounts and assigned shares, not assumed halves", () => {
    expect(netBalances([{ ...expense(100), shares: [{ memberId: "m1", amount: 70 }, { memberId: "m2", amount: 30 }] }, expense(40, "m2")], [])).toEqual({ m1: 10, m2: -10 });
    expect(netBalances(sharedExpenses, settlements)).toEqual({ m1: 91, m2: -91 });
  });
  it("a reimbursement reduces debt without creating income or shared expense", () => {
    const list = [expense(100)];
    const before = structuredClone({ list, transactions });
    expect(netBalances(list, [])).toEqual({ m1: 50, m2: -50 });
    expect(netBalances(list, [{ id: "refund", spaceId: "s-casa", date: "2026-10-28", from: "m2", to: "m1", amount: 20, kind: "rimborso" }])).toEqual({ m1: 30, m2: -30 });
    expect({ list, transactions }).toEqual(before);
  });
  it("a full settlement clears debt", () => {
    expect(netBalances([expense(100)], [{ id: "settle", spaceId: "s-casa", date: "2026-10-28", from: "m2", to: "m1", amount: 50, kind: "pareggio" }])).toEqual({ m1: 0, m2: 0 });
  });
  it("linked expenses reference one personal outflow without creating another transaction", () => {
    const before = structuredClone(transactions);
    const linked = sharedExpenses.filter((e) => e.linkedTransactionId);
    expect(linked).toHaveLength(3);
    for (const e of linked) {
      const matches = transactions.filter((t) => t.id === e.linkedTransactionId);
      expect(matches).toHaveLength(1);
      expect(matches[0]?.amount).toBe(-e.amount);
    }
    netBalances(sharedExpenses, settlements);
    expect(transactions).toEqual(before);
    expect(transactions.filter((t) => t.amount < 0).reduce((sum, t) => sum + Math.round(-t.amount * 100), 0)).toBe(115540);
  });
});

describe("Split editor regression checks", () => {
  it("saving without changes preserves exact custom amounts and split mode", () => {
    if (!dinner) throw new Error("Missing demo dinner");
    const { onSave } = openSplit(dinner);
    fireEvent.click(screen.getByRole("button", { name: "Salva quote" }));
    expect(onSave).toHaveBeenCalledWith(dinner);
    expect(dinner.shares.map((s) => s.amount)).toEqual([24, 40]);
  });
  it("a 70/30 edit changes only that expense and updates net debt", () => {
    if (!dinner) throw new Error("Missing demo dinner");
    const before = structuredClone(sharedExpenses);
    const { onSave } = openSplit(dinner);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Quota percentuale Mattia" }), { target: { value: "70" } });
    fireEvent.click(screen.getByRole("button", { name: "Salva quote" }));
    const saved = onSave.mock.calls[0]?.[0] as SharedExpense;
    expect(saved.shares).toEqual([{ memberId: "m1", amount: 44.8 }, { memberId: "m2", amount: 19.2 }]);
    expect(netBalances(sharedExpenses.map((e) => e.id === saved.id ? saved : e), settlements)).toEqual({ m1: 70.2, m2: -70.2 });
    expect(sharedExpenses).toEqual(before);
  });
  it("resetting to 50/50 assigns the spare cent consistently", () => {
    const { onSave } = openSplit(expense(72.31));
    fireEvent.click(screen.getByRole("button", { name: "Ripristina 50 / 50" }));
    fireEvent.click(screen.getByRole("button", { name: "Salva quote" }));
    expect(onSave.mock.calls[0]?.[0].shares).toEqual([{ memberId: "m1", amount: 36.16 }, { memberId: "m2", amount: 36.15 }]);
  });
});