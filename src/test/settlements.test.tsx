import { describe, expect, it } from "vitest";
import { netBalances, validateSettlement, type Settlement } from "@/lib/domain";
import { sharedExpenses, settlements } from "@/lib/mock-data";
const pay = (amount: number, id = `r${amount}`): Settlement => ({
  id,
  spaceId: "s-casa",
  date: "2026-10-28",
  from: "m2",
  to: "m1",
  amount,
  kind: "rimborso",
});
const total = (xs = sharedExpenses) => xs.reduce((a, e) => a + Math.round(e.amount * 100), 0);

describe("Rimborsi (demo)", () => {
  const start = netBalances(sharedExpenses, settlements);
  it("Giulia deve 91 €, rimborsa 40 €: residuo 51 €", () => {
    expect(start).toEqual({ m1: 91, m2: -91 });
    expect(netBalances(sharedExpenses, [...settlements, pay(40)])).toEqual({ m1: 51, m2: -51 });
  });
  it("altri 51 € azzerano il saldo", () => {
    expect(netBalances(sharedExpenses, [...settlements, pay(40), pay(51)])).toEqual({
      m1: 0,
      m2: 0,
    });
    const zero = netBalances(sharedExpenses, [...settlements, pay(40), pay(51)]);
    expect(
      validateSettlement(zero, { from: "m2", to: "m1", amount: 1, date: "2026-10-28" }),
    ).toMatch(/Non ci sono debiti/);
  });
  it("92 € con debito 91 € è rifiutato; 0 e negativi pure", () => {
    const v = (amount: number) =>
      validateSettlement(start, { from: "m2", to: "m1", amount, date: "2026-10-28" });
    expect(v(92)).toMatch(/supera/);
    expect(v(91.01)).toMatch(/supera/);
    expect(v(0)).not.toBeNull();
    expect(v(-5)).not.toBeNull();
    expect(v(91)).toBeNull();
    expect(
      validateSettlement(start, { from: "m1", to: "m2", amount: 10, date: "2026-10-28" }),
    ).not.toBeNull();
  });
  it("annullare un rimborso ripristina il saldo precedente", () => {
    const list = [...settlements, pay(40)];
    expect(
      netBalances(
        sharedExpenses,
        list.filter((s) => s.id !== "r40"),
      ),
    ).toEqual(start);
  });
  it("i rimborsi non modificano il totale delle spese condivise", () => {
    const before = total();
    netBalances(sharedExpenses, [...settlements, pay(40), pay(51)]);
    expect(total()).toBe(before);
  });
  it("saldo corretto con nuove spese, quote personalizzate e rimborsi", () => {
    const extra = [
      {
        ...sharedExpenses[0]!,
        id: "x1",
        amount: 100,
        paidBy: "m2",
        splitMode: "amount" as const,
        shares: [
          { memberId: "m1", amount: 70 },
          { memberId: "m2", amount: 30 },
        ],
      },
      {
        ...sharedExpenses[0]!,
        id: "x2",
        amount: 33.33,
        paidBy: "m1",
        shares: [
          { memberId: "m1", amount: 16.67 },
          { memberId: "m2", amount: 16.66 },
        ],
      },
    ];
    // 91 - 70 + 16.66 = 37.66; rimborso 20 → 17.66
    expect(netBalances([...sharedExpenses, ...extra], [...settlements, pay(20)])).toEqual({
      m1: 17.66,
      m2: -17.66,
    });
  });
});
