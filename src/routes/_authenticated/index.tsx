import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { financeQuery, errMsg } from "@/lib/finance";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Fondo, finanze personali" },
      {
        name: "description",
        content: "Panoramica aggiornata di patrimonio, liquidità e flussi del mese.",
      },
      { property: "og:title", content: "Dashboard — Fondo" },
      {
        property: "og:description",
        content: "Panoramica aggiornata delle tue finanze personali.",
      },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(financeQuery),
  component: Index,
  errorComponent: ({ error }) => (
    <div role="alert" className="text-destructive">
      {errMsg(error)}
    </div>
  ),
});

type Finance = Awaited<ReturnType<NonNullable<typeof financeQuery.queryFn>>>;
type CurrencySummary = {
  currency: string;
  netWorth: number;
  liquidity: number;
  savings: number;
  investments: number;
  debts: number;
  income: number;
  expenses: number;
};

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(cents / 100);

const monthName = (date: Date) =>
  new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric" }).format(date);

function summarize(data: Finance, month: string): CurrencySummary[] {
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
  data.transactions
    .filter((transaction) => transaction.occurred_on.startsWith(month))
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

function Index() {
  const { data } = useSuspenseQuery(financeQuery);
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const summaries = summarize(data, month);
  const hasData = summaries.length > 0;

  return (
    <div>
      <PageHeader eyebrow={monthName(now)} title="La tua situazione finanziaria" />
      {!hasData ? (
        <div className="rounded-2xl border border-dashed bg-card p-8 text-center">
          <h2 className="font-semibold">Inizia a costruire il tuo quadro finanziario</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
            Quando registrerai conti, movimenti, investimenti o debiti, qui troverai una panoramica
            aggiornata dei tuoi dati.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button asChild>
              <Link to="/conti">Aggiungi un conto</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/investimenti">Investimenti e debiti</Link>
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {summaries.map((summary) => (
            <section key={summary.currency} className="rounded-2xl border bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm text-muted-foreground">
                    Patrimonio netto · {summary.currency}
                  </p>
                  <p className="mt-1 font-display text-3xl" data-testid="dashboard-net-worth">
                    {money(summary.netWorth, summary.currency)}
                  </p>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link to="/patrimonio">Dettaglio patrimonio</Link>
                </Button>
              </div>
              <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Metric label="Liquidità" value={summary.liquidity} currency={summary.currency} />
                <Metric label="Risparmi" value={summary.savings} currency={summary.currency} />
                <Metric
                  label="Investimenti"
                  value={summary.investments}
                  currency={summary.currency}
                />
                <Metric
                  label="Debiti finanziari"
                  value={-summary.debts}
                  currency={summary.currency}
                  negative
                />
              </div>
              <div className="mt-5 border-t pt-4">
                <p className="text-sm font-medium">Flussi di {monthName(now)}</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <Metric label="Entrate" value={summary.income} currency={summary.currency} />
                  <Metric
                    label="Uscite"
                    value={-summary.expenses}
                    currency={summary.currency}
                    negative
                  />
                  <Metric
                    label="Saldo del mese"
                    value={summary.income - summary.expenses}
                    currency={summary.currency}
                    negative={summary.income < summary.expenses}
                  />
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  I trasferimenti tra conti non sono inclusi nei flussi. Le valute restano separate.
                </p>
              </div>
            </section>
          ))}
        </div>
      )}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-primary p-6 text-primary-foreground">
        <div>
          <p className="font-display text-xl">Spese condivise</p>
          <p className="text-sm opacity-80">
            Vai alla gestione delle spese e dei rimborsi condivisi.
          </p>
        </div>
        <Button asChild variant="secondary">
          <Link to="/spese-condivise">Apri</Link>
        </Button>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  currency,
  negative = false,
}: {
  label: string;
  value: number;
  currency: string;
  negative?: boolean;
}) {
  return (
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`num mt-1 text-xl font-semibold ${negative ? "text-destructive" : ""}`}>
        {money(value, currency)}
      </p>
    </div>
  );
}
