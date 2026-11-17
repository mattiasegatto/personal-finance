import type { financeQuery } from "@/lib/finance";

export type Finance = Awaited<ReturnType<NonNullable<typeof financeQuery.queryFn>>>;
export type CurrencySummary = {
  currency: string;
  netWorth: number;
  liquidity: number;
  savings: number;
  investments: number;
  debts: number;
  income: number;
  expenses: number;
};

/** Totali per valuta: patrimonio, liquidità e flussi ordinari del mese (YYYY-MM). */
export function summarize(data: Finance, month: string): CurrencySummary[] {
  const totals = new Map<string, CurrencySummary>();
  const get = (currency: string) => {
    let value = totals.get(currency);
    if (!value) {
      value = {
        currency,
        netWorth: 0,
        liquidity: 0,
        savings: 0,
        investments: 0,
        debts: 0,
        income: 0,
        expenses: 0,
      };
      totals.set(currency, value);
    }
    return value;
  };

  data.accounts
    .filter((account) => !account.archived_at)
    .forEach((account) => {
      const total = get(account.currency);
      if (account.type === "checking" || account.type === "card" || account.type === "cash") {
        total.liquidity += account.balance_cents;
      } else if (account.type === "savings") {
        total.savings += account.balance_cents;
      }
    });

  data.investments
    .filter((investment) => !investment.archived_at)
    .forEach((investment) => {
      get(investment.currency).investments += investment.current_value_cents;
    });

  data.debts
    .filter((debt) => !debt.archived_at)
    .forEach((debt) => {
      get(debt.currency).debts += debt.outstanding_balance_cents;
    });

  const accountCurrencies = new Map(data.accounts.map((account) => [account.id, account.currency]));
  // Transfer legs move money between own accounts: they are not income or expenses.
  data.transactions
    .filter(
      (transaction) =>
        transaction.operation_type === "ordinary" && transaction.occurred_on.startsWith(month),
    )
    .forEach((transaction) => {
      const currency = accountCurrencies.get(transaction.account_id);
      if (!currency) return;
      const total = get(currency);
      if (transaction.direction === "inflow") total.income += transaction.amount_cents;
      else total.expenses += transaction.amount_cents;
    });

  return [...totals.values()]
    .map((total) => ({
      ...total,
      netWorth: total.liquidity + total.savings + total.investments - total.debts,
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}
