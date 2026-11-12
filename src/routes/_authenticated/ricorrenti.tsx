import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { financeQuery, errMsg, parseCents, centsToInput, type Direction } from "@/lib/finance";

export const Route = createFileRoute("/_authenticated/ricorrenti")({
  head: () => ({ meta: [
    { title: "Redditi e spese ricorrenti — Fondo" },
    { name: "description", content: "Pianifica entrate e uscite ricorrenti senza registrarle automaticamente." },
  ] }),
  loader: ({ context }) => context.queryClient.ensureQueryData(financeQuery),
  component: Recurring,
  errorComponent: ({ error }) => <div role="alert" className="text-destructive">{errMsg(error)}</div>,
});

type Finance = Awaited<ReturnType<NonNullable<typeof financeQuery.queryFn>>>;
type Recurrence = {
  id: string; account_id: string; category_id: string; direction: Direction; amount_cents: number;
  description: string; frequency: "weekly" | "monthly" | "yearly"; start_on: string; next_due_on: string;
  end_on: string | null; active: boolean;
};
const ALL = "__all";
const money = (c: number, currency: string) => new Intl.NumberFormat("it-IT", { style: "currency", currency }).format(c / 100);
const dateLabel = (s: string) => new Intl.DateTimeFormat("it-IT", { dateStyle: "medium" }).format(new Date(s + "T12:00:00"));

function Recurring() {
  const { data } = useSuspenseQuery(financeQuery);
  const qc = useQueryClient();
  const [items, setItems] = useState<Recurrence[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [dialog, setDialog] = useState(false);
  const refresh = async () => { await qc.invalidateQueries({ queryKey: ["finance"] }); await load(); };
  const load = async () => {
    const { data: rows, error } = await supabase.from("recurring_items").select("*").eq("space_id", data.spaceId).order("next_due_on");
    if (error) { toast.error(errMsg(error)); return; }
    setItems((rows ?? []) as Recurrence[]); setLoaded(true);
  };
  useState(() => { void load(); });
  const activeAccounts = data.accounts.filter(a => !a.archived_at);
  const activeCategories = data.categories.filter(c => !c.archived_at);
  const accountName = (id: string) => data.accounts.find(a => a.id === id)?.name ?? "—";
  const categoryName = (id: string) => data.categories.find(c => c.id === id)?.label ?? "—";
  const act = async (item: Recurrence, confirm: boolean) => {
    const result = confirm
      ? await supabase.rpc("confirm_recurring_item", { _id: item.id, _expected_due: item.next_due_on })
      : await supabase.rpc("advance_recurring_due", { _id: item.id, _expected_due: item.next_due_on });
    if (result.error) toast.error(errMsg(result.error));
    else { toast.success(confirm ? "Movimento registrato" : "Scadenza rinviata"); await refresh(); }
  };
  const toggle = async (item: Recurrence) => {
    const { error } = await supabase.from("recurring_items").update({ active: !item.active }).eq("id", item.id);
    if (error) toast.error(errMsg(error)); else await refresh();
  };

  return <div>
    <PageHeader eyebrow="Spazio personale" title="Redditi e spese ricorrenti">
      <Button onClick={() => setDialog(true)} disabled={!activeAccounts.length || !activeCategories.length}><Plus className="h-4 w-4" />Nuova ricorrenza</Button>
    </PageHeader>
    <p className="mb-5 max-w-3xl text-sm text-muted-foreground">Registra stipendi, affitti, utenze, abbonamenti e altri movimenti periodici. Le ricorrenze sono promemoria: nessun movimento viene creato finché non lo confermi.</p>
    {!loaded ? <p className="text-sm text-muted-foreground">Caricamento…</p> : items.length === 0 ? <div className="rounded-2xl border border-dashed bg-card p-8 text-center"><h2 className="font-semibold">Nessuna ricorrenza</h2><p className="mt-2 text-sm text-muted-foreground">Aggiungi una ricorrenza per pianificare entrate o uscite future.</p></div> : <div className="overflow-x-auto rounded-2xl border bg-card"><table className="w-full text-sm"><thead className="border-b text-left text-xs uppercase text-muted-foreground"><tr><th className="p-3">Prossima data</th><th className="p-3">Descrizione</th><th className="p-3">Tipo</th><th className="p-3">Conto</th><th className="p-3 text-right">Importo</th><th className="p-3">Azioni</th></tr></thead><tbody>{items.map(item => {
      const currency = data.accounts.find(a => a.id === item.account_id)?.currency ?? "EUR";
      return <tr key={item.id} className="border-b last:border-0"><td className="p-3 whitespace-nowrap">{dateLabel(item.next_due_on)}</td><td className="p-3">{item.description}<div className="text-xs text-muted-foreground">{categoryName(item.category_id)} · {item.frequency === "weekly" ? "Settimanale" : item.frequency === "monthly" ? "Mensile" : "Annuale"}</div></td><td className="p-3">{item.direction === "inflow" ? "Entrata" : "Uscita"}</td><td className="p-3">{accountName(item.account_id)}</td><td className="p-3 text-right font-medium whitespace-nowrap">{item.direction === "inflow" ? "+" : "−"}{money(item.amount_cents, currency)}</td><td className="p-3 whitespace-nowrap"><Button size="sm" onClick={() => void act(item, true)} disabled={!item.active}>Conferma movimento</Button><Button size="sm" variant="outline" className="ml-1" onClick={() => void act(item, false)} disabled={!item.active}>Rinvia</Button><Button size="sm" variant="ghost" onClick={() => void toggle(item)}>{item.active ? "Disattiva" : "Riattiva"}</Button></td></tr>;
    })}</tbody></table></div>}
    {dialog && <RecurringDialog data={data} onClose={() => setDialog(false)} onSaved={async () => { setDialog(false); await refresh(); }} />}
  </div>;
}

function RecurringDialog({ data, onClose, onSaved }: { data: Finance; onClose: () => void; onSaved: () => void }) {
  const [direction, setDirection] = useState<Direction>("outflow");
  const [account, setAccount] = useState(data.accounts.find(a => !a.archived_at)?.id ?? "");
  const cats = data.categories.filter(c => !c.archived_at && c.rootKind === (direction === "inflow" ? "income" : "expense"));
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState<"weekly" | "monthly" | "yearly">("monthly");
  const [start, setStart] = useState(new Date().toISOString().slice(0,10));
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const cents = parseCents(amount);
    if (!description.trim() || !cents || !account || !category || !start) return void toast.error("Completa tutti i campi obbligatori.");
    setBusy(true);
    const { error } = await supabase.from("recurring_items").insert({
      space_id: data.spaceId, account_id: account, category_id: category, direction, amount_cents: cents,
      description: description.trim(), frequency, start_on: start, next_due_on: start, end_on: end || null,
    });
    setBusy(false);
    if (error) return void toast.error(errMsg(error));
    toast.success("Ricorrenza creata"); onSaved();
  };
  return <Dialog open onOpenChange={o => !o && onClose()}><DialogContent><DialogHeader><DialogTitle>Nuova ricorrenza</DialogTitle></DialogHeader><form onSubmit={submit} className="space-y-3">
    <div className="grid grid-cols-2 gap-2">{(["outflow","inflow"] as const).map(d => <Button key={d} type="button" variant={direction === d ? "default" : "outline"} onClick={() => { setDirection(d); setCategory(""); }}>{d === "inflow" ? "Entrata" : "Uscita"}</Button>)}</div>
    <div className="space-y-1"><Label>Descrizione</Label><Input value={description} onChange={e => setDescription(e.target.value)} maxLength={200} /></div>
    <div className="grid grid-cols-2 gap-2"><div className="space-y-1"><Label>Importo</Label><Input value={amount} onChange={e => setAmount(e.target.value)} placeholder="0,00" inputMode="decimal" /></div><div className="space-y-1"><Label>Frequenza</Label><Select value={frequency} onValueChange={v => setFrequency(v as typeof frequency)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="weekly">Settimanale</SelectItem><SelectItem value="monthly">Mensile</SelectItem><SelectItem value="yearly">Annuale</SelectItem></SelectContent></Select></div></div>
    <div className="space-y-1"><Label>Conto</Label><Select value={account} onValueChange={setAccount}><SelectTrigger><SelectValue placeholder="Seleziona conto" /></SelectTrigger><SelectContent>{data.accounts.filter(a => !a.archived_at).map(a => <SelectItem key={a.id} value={a.id}>{a.name} · {a.currency}</SelectItem>)}</SelectContent></Select></div>
    <div className="space-y-1"><Label>Categoria</Label><Select value={category} onValueChange={setCategory}><SelectTrigger><SelectValue placeholder="Seleziona categoria" /></SelectTrigger><SelectContent>{cats.map(c => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}</SelectContent></Select></div>
    <div className="grid grid-cols-2 gap-2"><div className="space-y-1"><Label>Prima data prevista</Label><Input type="date" value={start} onChange={e => setStart(e.target.value)} /></div><div className="space-y-1"><Label>Ultima data (facoltativa)</Label><Input type="date" value={end} min={start} onChange={e => setEnd(e.target.value)} /></div></div>
    <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Annulla</Button><Button type="submit" disabled={busy}>{busy ? "Salvataggio…" : "Salva ricorrenza"}</Button></DialogFooter>
  </form></DialogContent></Dialog>;
}
