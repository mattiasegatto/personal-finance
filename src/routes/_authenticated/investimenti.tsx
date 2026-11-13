import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { eur, dateFull } from "@/lib/domain";
import { centsToInput, errMsg, financeQuery, localDateISO, parseCents } from "@/lib/finance";

export const Route = createFileRoute("/_authenticated/investimenti")({
  head: () => ({
    meta: [
      { title: "Investimenti e debiti — Fondo" },
      {
        name: "description",
        content: "Gestione manuale degli investimenti e dei debiti finanziari.",
      },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(financeQuery),
  component: Investments,
  errorComponent: ({ error }) => (
    <div role="alert" className="text-destructive">
      {errMsg(error)}
    </div>
  ),
});

type Data = Awaited<ReturnType<NonNullable<typeof financeQuery.queryFn>>>;
type Investment = Data["investments"][number];
type Debt = Data["debts"][number];
const investmentLabels = {
  etf: "ETF",
  stock: "Azioni",
  bond: "Obbligazioni",
  fund: "Fondi",
  crypto: "Cripto-attività",
  other: "Altro",
} as const;
const debtLabels = {
  mortgage: "Mutuo",
  loan: "Prestito",
  financing: "Finanziamento",
  other: "Altro",
} as const;

function Investments() {
  const { data } = useSuspenseQuery(financeQuery);
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["finance"] });
  const [investmentEdit, setInvestmentEdit] = useState<Investment | null | "new">(null);
  const [debtEdit, setDebtEdit] = useState<Debt | null | "new">(null);
  const [showArchived, setShowArchived] = useState(false);
  const investments = data.investments.filter((x) => showArchived || !x.archived_at);
  const debts = data.debts.filter((x) => showArchived || !x.archived_at);
  const act = async (p: PromiseLike<{ error: unknown }>, message: string) => {
    const { error } = await p;
    if (error) toast.error(errMsg(error));
    else {
      toast.success(message);
      refresh();
    }
  };
  const invested = investments
    .filter((x) => !x.archived_at)
    .reduce((n, x) => n + x.invested_amount_cents, 0);
  const market = investments
    .filter((x) => !x.archived_at)
    .reduce((n, x) => n + x.current_value_cents, 0);
  const debtTotal = debts
    .filter((x) => !x.archived_at)
    .reduce((n, x) => n + x.outstanding_balance_cents, 0);
  return (
    <div>
      <PageHeader eyebrow="Spazio personale" title="Investimenti e debiti">
        <Button onClick={() => setInvestmentEdit("new")}>
          <Plus className="mr-2 h-4 w-4" />
          Nuovo investimento
        </Button>
        <Button variant="outline" onClick={() => setDebtEdit("new")}>
          <Plus className="mr-2 h-4 w-4" />
          Nuovo debito
        </Button>
      </PageHeader>
      <p className="mb-6 max-w-3xl text-sm text-muted-foreground">
        Valori inseriti e aggiornati manualmente. Gli investimenti sono valorizzati al valore
        corrente indicato; per i debiti si registra il capitale residuo. I movimenti bancari non
        vengono creati automaticamente.
      </p>
      <div className="mb-8 grid gap-3 sm:grid-cols-3">
        <Metric label="Capitale investito" value={eur(invested / 100)} />
        <Metric label="Valore attuale investimenti" value={eur(market / 100)} />
        <Metric label="Debiti residui" value={eur(debtTotal / 100)} />
      </div>
      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Investimenti</h2>
          <span className="text-sm text-muted-foreground">{investments.length} elementi</span>
        </div>
        {investments.length === 0 ? (
          <Empty>Non hai ancora registrato investimenti.</Empty>
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  {[
                    "Strumento",
                    "Tipologia",
                    "Quantità",
                    "Capitale",
                    "Valore attuale",
                    "Valutazione",
                    "",
                  ].map((x) => (
                    <th key={x} className="whitespace-nowrap px-4 py-3 font-medium">
                      {x}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {investments.map((x) => (
                  <tr key={x.id} className={x.archived_at ? "text-muted-foreground" : ""}>
                    <td className="px-4 py-3">
                      <div className="font-medium">{x.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {x.ticker || x.currency}
                        {x.archived_at ? " · Archiviato" : ""}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">{investmentLabels[x.type]}</td>
                    <td className="px-4 py-3">{x.quantity ?? "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {eur(x.invested_amount_cents / 100)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium">
                      {eur(x.current_value_cents / 100)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">{dateFull(x.valuation_date)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <Button size="sm" variant="outline" onClick={() => setInvestmentEdit(x)}>
                        Modifica
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          act(
                            supabase
                              .from("investments")
                              .update({
                                archived_at: x.archived_at ? null : new Date().toISOString(),
                              })
                              .eq("id", x.id),
                            x.archived_at ? "Investimento ripristinato" : "Investimento archiviato",
                          )
                        }
                      >
                        {x.archived_at ? "Ripristina" : "Archivia"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Debiti finanziari</h2>
          <span className="text-sm text-muted-foreground">{debts.length} elementi</span>
        </div>
        {debts.length === 0 ? (
          <Empty>Non hai ancora registrato mutui, prestiti o finanziamenti.</Empty>
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  {[
                    "Debito",
                    "Tipologia",
                    "Finanziatore",
                    "Capitale iniziale",
                    "Residuo",
                    "Rata mensile",
                    "Scadenza",
                    "",
                  ].map((x) => (
                    <th key={x} className="whitespace-nowrap px-4 py-3 font-medium">
                      {x}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {debts.map((x) => (
                  <tr key={x.id} className={x.archived_at ? "text-muted-foreground" : ""}>
                    <td className="px-4 py-3 font-medium">
                      {x.name}
                      {x.archived_at ? " · Archiviato" : ""}
                    </td>
                    <td className="px-4 py-3">{debtLabels[x.type]}</td>
                    <td className="px-4 py-3">{x.lender || "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {eur(x.original_principal_cents / 100)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium">
                      {eur(x.outstanding_balance_cents / 100)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {x.monthly_payment_cents === null ? "—" : eur(x.monthly_payment_cents / 100)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {x.due_on ? dateFull(x.due_on) : "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <Button size="sm" variant="outline" onClick={() => setDebtEdit(x)}>
                        Modifica
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          act(
                            supabase
                              .from("financial_debts")
                              .update({
                                archived_at: x.archived_at ? null : new Date().toISOString(),
                              })
                              .eq("id", x.id),
                            x.archived_at ? "Debito ripristinato" : "Debito archiviato",
                          )
                        }
                      >
                        {x.archived_at ? "Ripristina" : "Archivia"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <div className="mt-5">
        <Button variant="ghost" size="sm" onClick={() => setShowArchived((v) => !v)}>
          {showArchived ? "Nascondi archiviati" : "Mostra anche archiviati"}
        </Button>
      </div>
      {investmentEdit !== null && (
        <InvestmentDialog
          item={investmentEdit === "new" ? null : investmentEdit}
          spaceId={data.spaceId}
          onClose={() => setInvestmentEdit(null)}
          onSaved={refresh}
        />
      )}
      {debtEdit !== null && (
        <DebtDialog
          item={debtEdit === "new" ? null : debtEdit}
          spaceId={data.spaceId}
          onClose={() => setDebtEdit(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-2xl">{value}</p>
    </div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function InvestmentDialog({
  item,
  spaceId,
  onClose,
  onSaved,
}: {
  item: Investment | null;
  spaceId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [type, setType] = useState<Investment["type"]>(item?.type ?? "etf");
  const [ticker, setTicker] = useState(item?.ticker ?? "");
  const [currency, setCurrency] = useState(item?.currency ?? "EUR");
  const [quantity, setQuantity] = useState(item?.quantity?.toString() ?? "");
  const [invested, setInvested] = useState(centsToInput(item?.invested_amount_cents ?? 0));
  const [current, setCurrent] = useState(centsToInput(item?.current_value_cents ?? 0));
  const [valuation, setValuation] = useState(item?.valuation_date ?? localDateISO());
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const a = parseCents(invested),
      b = parseCents(current);
    const q = quantity.trim() === "" ? null : Number(quantity.replace(",", "."));
    if (!name.trim()) return void toast.error("Indica lo strumento.");
    if (a === null || b === null) return void toast.error("Controlla gli importi.");
    if (q !== null && (!Number.isFinite(q) || q < 0))
      return void toast.error("Quantità non valida.");
    if (!/^[A-Za-z]{3}$/.test(currency))
      return void toast.error("La valuta deve avere tre lettere.");
    setBusy(true);
    const row = {
      name: name.trim(),
      type,
      ticker: ticker.trim() || null,
      currency: currency.toUpperCase(),
      quantity: q,
      invested_amount_cents: a,
      current_value_cents: b,
      valuation_date: valuation,
      notes: notes.trim() || null,
    };
    const res = item
      ? await supabase.from("investments").update(row).eq("id", item.id)
      : await supabase.from("investments").insert({ ...row, space_id: spaceId });
    setBusy(false);
    if (res.error) return void toast.error(errMsg(res.error));
    toast.success(item ? "Investimento aggiornato" : "Investimento creato");
    onSaved();
    onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{item ? "Modifica investimento" : "Nuovo investimento"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Nome strumento">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tipologia">
              <Select value={type} onValueChange={(v) => setType(v as Investment["type"])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(investmentLabels).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Ticker / ISIN">
              <Input value={ticker} onChange={(e) => setTicker(e.target.value)} maxLength={20} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Valuta">
              <Input value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={3} />
            </Field>
            <Field label="Quantità">
              <Input
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                inputMode="decimal"
                placeholder="Facoltativa"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Capitale investito">
              <Input
                value={invested}
                onChange={(e) => setInvested(e.target.value)}
                inputMode="decimal"
              />
            </Field>
            <Field label="Valore attuale">
              <Input
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                inputMode="decimal"
              />
            </Field>
          </div>
          <Field label="Data valutazione">
            <Input type="date" value={valuation} onChange={(e) => setValuation(e.target.value)} />
          </Field>
          <Field label="Note">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Annulla
            </Button>
            <Button type="submit" disabled={busy}>
              Salva
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
function DebtDialog({
  item,
  spaceId,
  onClose,
  onSaved,
}: {
  item: Debt | null;
  spaceId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [lender, setLender] = useState(item?.lender ?? "");
  const [type, setType] = useState<Debt["type"]>(item?.type ?? "loan");
  const [currency, setCurrency] = useState(item?.currency ?? "EUR");
  const [principal, setPrincipal] = useState(centsToInput(item?.original_principal_cents ?? 0));
  const [balance, setBalance] = useState(centsToInput(item?.outstanding_balance_cents ?? 0));
  const [rate, setRate] = useState(item?.annual_interest_rate?.toString() ?? "");
  const [payment, setPayment] = useState(
    item?.monthly_payment_cents == null ? "" : centsToInput(item.monthly_payment_cents),
  );
  const [started, setStarted] = useState(item?.started_on ?? "");
  const [due, setDue] = useState(item?.due_on ?? "");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const p = parseCents(principal),
      b = parseCents(balance),
      m = payment.trim() ? parseCents(payment) : null;
    const r = rate.trim() ? Number(rate.replace(",", ".")) : null;
    if (!name.trim()) return void toast.error("Indica il debito.");
    if (p === null || p <= 0 || b === null)
      return void toast.error("Controlla capitale e residuo.");
    if (m === null && payment.trim()) return void toast.error("Rata mensile non valida.");
    if (r !== null && (!Number.isFinite(r) || r < 0 || r > 100))
      return void toast.error("Tasso non valido.");
    if (!/^[A-Za-z]{3}$/.test(currency))
      return void toast.error("La valuta deve avere tre lettere.");
    if (started && due && due < started)
      return void toast.error("La scadenza non può precedere la data iniziale.");
    setBusy(true);
    const row = {
      name: name.trim(),
      lender: lender.trim() || null,
      type,
      currency: currency.toUpperCase(),
      original_principal_cents: p,
      outstanding_balance_cents: b,
      annual_interest_rate: r,
      monthly_payment_cents: m,
      started_on: started || null,
      due_on: due || null,
      notes: notes.trim() || null,
    };
    const res = item
      ? await supabase.from("financial_debts").update(row).eq("id", item.id)
      : await supabase.from("financial_debts").insert({ ...row, space_id: spaceId });
    setBusy(false);
    if (res.error) return void toast.error(errMsg(res.error));
    toast.success(item ? "Debito aggiornato" : "Debito creato");
    onSaved();
    onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{item ? "Modifica debito" : "Nuovo debito"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Nome">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tipologia">
              <Select value={type} onValueChange={(v) => setType(v as Debt["type"])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(debtLabels).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Finanziatore">
              <Input value={lender} onChange={(e) => setLender(e.target.value)} maxLength={120} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Valuta">
              <Input value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={3} />
            </Field>
            <Field label="Tasso annuo (%)">
              <Input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Capitale iniziale">
              <Input
                value={principal}
                onChange={(e) => setPrincipal(e.target.value)}
                inputMode="decimal"
              />
            </Field>
            <Field label="Debito residuo">
              <Input
                value={balance}
                onChange={(e) => setBalance(e.target.value)}
                inputMode="decimal"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Rata mensile">
              <Input
                value={payment}
                onChange={(e) => setPayment(e.target.value)}
                inputMode="decimal"
              />
            </Field>
            <Field label="Data iniziale">
              <Input type="date" value={started} onChange={(e) => setStarted(e.target.value)} />
            </Field>
          </div>
          <Field label="Scadenza">
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          <Field label="Note">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
          </Field>
          <p className="text-xs text-muted-foreground">
            Aggiorna manualmente il residuo dopo i rimborsi o gli eventuali interessi capitalizzati.
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Annulla
            </Button>
            <Button type="submit" disabled={busy}>
              Salva
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
