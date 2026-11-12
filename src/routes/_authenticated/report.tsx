import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/page";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { financeQuery, errMsg } from "@/lib/finance";
import { buildReport, monthKey, monthTitle } from "@/lib/reports";

export const Route = createFileRoute("/_authenticated/report")({
  head: () => ({ meta: [
    { title: "Report e analisi — Fondo" },
    { name: "description", content: "Analisi dei flussi finanziari e delle spese per categoria." },
  ] }),
  loader: ({ context }) => context.queryClient.ensureQueryData(financeQuery),
  component: Reports,
  errorComponent: ({ error }) => <div role="alert" className="text-destructive">{errMsg(error)}</div>,
});

type Finance = Awaited<ReturnType<NonNullable<typeof financeQuery.queryFn>>>;

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat("it-IT", { style: "currency", currency, maximumFractionDigits: 2 }).format(cents / 100);

function Reports() {
  const { data } = useSuspenseQuery(financeQuery);
  const currencies = [...new Set(data.accounts.map((a) => a.currency))].sort();
  const [currency, setCurrency] = useState(currencies[0] ?? "EUR");
  const [period, setPeriod] = useState("12");
  const report = useMemo(
    () => buildReport(data as Finance, currency, Number(period), new Date()),
    [data, currency, period],
  );
  const maxFlow = Math.max(1, ...report.months.flatMap((m) => [m.income, m.expenses]));
  const maxCategory = Math.max(1, ...report.expenseCategories.map((c) => c.amount));

  return (
    <div>
      <PageHeader eyebrow="Spazio personale" title="Report e analisi">
        <div className="flex flex-wrap gap-2">
          <Select value={currency} onValueChange={setCurrency}>
            <SelectTrigger className="w-28" aria-label="Valuta"><SelectValue /></SelectTrigger>
            <SelectContent>{currencies.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-36" aria-label="Periodo"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="6">Ultimi 6 mesi</SelectItem>
              <SelectItem value="12">Ultimi 12 mesi</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </PageHeader>

      {!currencies.length || !report.transactionCount ? (
        <section className="rounded-2xl border border-dashed bg-card p-8 text-center">
          <h2 className="font-semibold">Non ci sono ancora dati sufficienti</h2>
          <p className="mt-2 text-sm text-muted-foreground">Registra entrate e uscite nei Movimenti: qui troverai l'andamento dei flussi e la ripartizione delle spese.</p>
        </section>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Entrate nel periodo" value={report.income} currency={currency} />
            <Metric label="Uscite nel periodo" value={report.expenses} currency={currency} />
            <Metric label="Saldo netto" value={report.net} currency={currency} />
            <Metric label="Tasso di risparmio" value={report.savingsRate} suffix="%" />
          </div>

          <section className="mt-6 rounded-2xl border bg-card p-5">
            <h2 className="font-semibold">Andamento mensile</h2>
            <p className="mt-1 text-sm text-muted-foreground">Entrate e uscite registrate. I trasferimenti tra conti sono esclusi.</p>
            <div className="mt-5 space-y-4">
              {report.months.map((m) => (
                <div key={m.key} className="grid grid-cols-[76px_1fr] items-center gap-3">
                  <span className="text-xs text-muted-foreground">{monthTitle(m.key)}</span>
                  <div className="space-y-1.5">
                    <div className="flex h-3 overflow-hidden rounded-full bg-muted" title={`Entrate: ${money(m.income, currency)}`}>
                      <div className="rounded-full bg-primary" style={{ width: `${(m.income / maxFlow) * 100}%` }} />
                    </div>
                    <div className="flex h-3 overflow-hidden rounded-full bg-muted" title={`Uscite: ${money(m.expenses, currency)}`}>
                      <div className="rounded-full bg-destructive/75" style={{ width: `${(m.expenses / maxFlow) * 100}%` }} />
                    </div>
                    <div className="flex justify-between gap-2 text-[11px] text-muted-foreground">
                      <span>+ {money(m.income, currency)}</span><span>− {money(m.expenses, currency)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex gap-4 text-xs text-muted-foreground">
              <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-primary" />Entrate</span>
              <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-destructive/75" />Uscite</span>
            </div>
          </section>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <section className="rounded-2xl border bg-card p-5">
              <h2 className="font-semibold">Spese per categoria</h2>
              <p className="mt-1 text-sm text-muted-foreground">Ripartizione delle uscite nel periodo selezionato.</p>
              {report.expenseCategories.length ? <div className="mt-5 space-y-4">
                {report.expenseCategories.map((c) => (
                  <div key={c.category}>
                    <div className="mb-1 flex justify-between gap-3 text-sm"><span className="truncate">{c.category}</span><strong className="num">{money(c.amount, currency)}</strong></div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${(c.amount / maxCategory) * 100}%` }} /></div>
                    <p className="mt-1 text-right text-xs text-muted-foreground">{report.expenses ? ((c.amount / report.expenses) * 100).toFixed(1) : "0.0"}%</p>
                  </div>
                ))}
              </div> : <p className="mt-5 text-sm text-muted-foreground">Nessuna uscita categorizzata.</p>}
            </section>
            <section className="rounded-2xl border bg-card p-5">
              <h2 className="font-semibold">Riepilogo</h2>
              <div className="mt-4 divide-y">
                <SummaryRow label="Movimenti analizzati" value={String(report.transactionCount)} />
                <SummaryRow label="Media mensile entrate" value={money(Math.round(report.income / report.months.length), currency)} />
                <SummaryRow label="Media mensile uscite" value={money(Math.round(report.expenses / report.months.length), currency)} />
                <SummaryRow label="Mese con più uscite" value={report.highestExpenseMonth ? monthTitle(report.highestExpenseMonth) : "—"} />
                <SummaryRow label="Categoria principale" value={report.expenseCategories[0]?.category ?? "—"} />
              </div>
            </section>
          </div>
        </>
      )}
      <p className="mt-5 text-xs text-muted-foreground">I report utilizzano esclusivamente i movimenti personali ordinari. Le valute sono analizzate separatamente, senza conversioni automatiche.</p>
    </div>
  );
}

function Metric({ label, value, currency, suffix }: { label: string; value: number; currency?: string; suffix?: string }) {
  return <section className="rounded-2xl border bg-card p-5"><p className="text-sm text-muted-foreground">{label}</p><p className="num mt-2 text-2xl font-semibold">{currency ? money(value, currency) : `${value.toFixed(1)}${suffix ?? ""}`}</p></section>;
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-3 py-3 text-sm"><span className="text-muted-foreground">{label}</span><strong className="text-right">{value}</strong></div>;
}
