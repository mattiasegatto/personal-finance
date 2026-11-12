import type { financeQuery } from "@/lib/finance";

type Finance = Awaited<ReturnType<NonNullable<typeof financeQuery.queryFn>>>;

export const monthKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
export const monthTitle = (key: string) => {
  const [year, month] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("it-IT", { month: "short", year: "2-digit" }).format(
    new Date(year!, month! - 1, 1),
  );
};

export function buildReport(data: Finance, currency: string, monthCount: number, now: Date) {
  const accounts = new Map(data.accounts.map((a) => [a.id, a.currency]));
  const categories = new Map(data.categories.map((c) => [c.id, c.label]));
  const keys = Array.from({ length: monthCount }, (_, i) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (monthCount - i - 1), 1);
    return monthKey(date);
  });
  const months = keys.map((key) => ({ key, income: 0, expenses: 0 }));
  const byMonth = new Map(months.map((m) => [m.key, m]));
  const byCategory = new Map<string, number>();
  let transactionCount = 0;
  for (const tx of data.transactions) {
    if (tx.operation_type !== "ordinary" || !keys.includes(tx.occurred_on.slice(0, 7))) continue;
    if (accounts.get(tx.account_id) !== currency) continue;
    const month = byMonth.get(tx.occurred_on.slice(0, 7));
    if (!month) continue;
    transactionCount++;
    if (tx.direction === "inflow") month.income += tx.amount_cents;
    else {
      month.expenses += tx.amount_cents;
      const category = tx.category_id
        ? (categories.get(tx.category_id) ?? "Senza categoria")
        : "Senza categoria";
      byCategory.set(category, (byCategory.get(category) ?? 0) + tx.amount_cents);
    }
  }
  const income = months.reduce((sum, m) => sum + m.income, 0);
  const expenses = months.reduce((sum, m) => sum + m.expenses, 0);
  const expenseCategories = [...byCategory]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
  const highestExpenseMonth = [...months].sort((a, b) => b.expenses - a.expenses)[0]?.expenses
    ? [...months].sort((a, b) => b.expenses - a.expenses)[0]!.key
    : null;
  return {
    months,
    income,
    expenses,
    net: income - expenses,
    savingsRate: income > 0 ? ((income - expenses) / income) * 100 : 0,
    expenseCategories,
    transactionCount,
    highestExpenseMonth,
  };
}
