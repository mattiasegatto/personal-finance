import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { financeQuery, errMsg } from "@/lib/finance";
import { eur } from "@/lib/domain";
import { PageHeader } from "@/components/page";

export const Route = createFileRoute("/_authenticated/patrimonio")({
  head: () => ({ meta: [{ title: "Patrimonio — Fondo" }, { name: "description", content: "Patrimonio netto finanziario, calcolato da conti, risparmi, investimenti e debiti." }] }),
  loader: ({ context }) => context.queryClient.ensureQueryData(financeQuery),
  component: NetWorth,
  errorComponent: ({ error }) => <div role="alert" className="text-destructive">{errMsg(error)}</div>,
});

type Data = Awaited<ReturnType<NonNullable<typeof financeQuery.queryFn>>>;
type CurrencyTotal = { currency: string; liquidity: number; savings: number; investments: number; debts: number };
const money = (cents: number, currency: string) => new Intl.NumberFormat("it-IT", { style: "currency", currency, maximumFractionDigits: 2 }).format(cents / 100);

function NetWorth() {
 const {data}=useSuspenseQuery(financeQuery);
 const totals=new Map<string,CurrencyTotal>();
 const get=(currency:string)=>{let x=totals.get(currency);if(!x){x={currency,liquidity:0,savings:0,investments:0,debts:0};totals.set(currency,x);}return x;};
 data.accounts.filter(a=>!a.archived_at).forEach(a=>{if(a.type==="checking"||a.type==="card"||a.type==="cash")get(a.currency).liquidity+=a.balance_cents;else if(a.type==="savings")get(a.currency).savings+=a.balance_cents;});
 data.investments.filter(x=>!x.archived_at).forEach(x=>get(x.currency).investments+=x.current_value_cents);
 data.debts.filter(x=>!x.archived_at).forEach(x=>get(x.currency).debts+=x.outstanding_balance_cents);
 const rows=[...totals.values()].sort((a,b)=>a.currency.localeCompare(b.currency));
 const totalAccounts=data.accounts.filter(a=>!a.archived_at);
 const excluded=totalAccounts.filter(a=>a.type==="other");
 return <div>
  <PageHeader eyebrow="Spazio personale" title="Patrimonio netto"/>
  <p className="mb-6 max-w-3xl text-sm text-muted-foreground">Il patrimonio comprende esclusivamente liquidità, risparmi, investimenti e debiti finanziari. Immobili, veicoli e beni personali sono esclusi. I valori sono manuali o derivati dai saldi dei conti registrati.</p>
  {rows.length===0?<div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">Non ci sono ancora dati sufficienti per calcolare il patrimonio. Aggiungi conti, investimenti o debiti.</div>:<div className="space-y-6">{rows.map(x=>{const net=x.liquidity+x.savings+x.investments-x.debts;return <section key={x.currency} className="overflow-hidden rounded-2xl border bg-card">
   <div className="border-b bg-muted/30 px-5 py-4"><p className="text-sm text-muted-foreground">Patrimonio netto · {x.currency}</p><p className="mt-1 font-display text-3xl">{money(net,x.currency)}</p></div>
   <div className="grid gap-4 p-5 sm:grid-cols-2">
    <Amount label="Liquidità" detail="Conti correnti, carte e contanti" value={x.liquidity} currency={x.currency}/>
    <Amount label="Risparmi" detail="Conti deposito e risparmio" value={x.savings} currency={x.currency}/>
    <Amount label="Investimenti" detail="ETF, azioni, obbligazioni, fondi e altri strumenti" value={x.investments} currency={x.currency}/>
    <Amount label="Debiti finanziari" detail="Mutui, prestiti e finanziamenti" value={-x.debts} currency={x.currency} negative/>
   </div>
   <div className="flex justify-between border-t px-5 py-4 text-sm font-semibold"><span>Patrimonio netto</span><span>{money(net,x.currency)}</span></div>
  </section>})}</div>}
  <div className="mt-6 rounded-xl border p-5">
   <h2 className="font-semibold">Criteri di calcolo</h2>
   <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
    <li>Liquidità e risparmi sono calcolati dai saldi correnti dei conti attivi.</li>
    <li>Investimenti conteggiati al valore corrente e alla data di valutazione indicata.</li>
    <li>Debiti sottratti in base al residuo aggiornato manualmente.</li>
    <li>Le valute sono mantenute separate: non viene applicato alcun cambio automatico.</li>
    <li>I conti di tipo “Altro” non sono inclusi finché non ne viene definita la classificazione.</li>
   </ul>
   {excluded.length>0&&<p className="mt-3 text-sm text-amber-700 dark:text-amber-400">Conti esclusi dal calcolo: {excluded.map(a=>a.name).join(", ")}.</p>}
  </div>
 </div>;
}
function Amount({label,detail,value,currency,negative=false}:{label:string;detail:string;value:number;currency:string;negative?:boolean}) {return <div><p className="text-sm font-medium">{label}</p><p className="text-xs text-muted-foreground">{detail}</p><p className={`mt-1 text-xl font-semibold ${negative?"text-destructive":""}`}>{money(value,currency)}</p></div>}
