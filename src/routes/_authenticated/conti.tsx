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
import { eur, dateFull } from "@/lib/domain";
import { accountTypeLabel, centsToInput, errMsg, financeQuery, parseCents, type AccountType } from "@/lib/finance";

export const Route = createFileRoute("/_authenticated/conti")({
  head: () => ({
    meta: [
      { title: "Conti e carte — Fondo" },
      { name: "description", content: "Conti e carte nel tuo spazio finanziario personale, con saldi calcolati dai movimenti." },
      { property: "og:title", content: "Conti e carte — Fondo" },
      { property: "og:description", content: "Conti e carte nel tuo spazio finanziario personale, con saldi calcolati dai movimenti." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(financeQuery),
  component: Accounts,
  errorComponent: ({ error }) => <div role="alert" className="text-destructive">{errMsg(error)}</div>,
});

type Acc = Awaited<ReturnType<NonNullable<typeof financeQuery.queryFn>>>["accounts"][number];

function Accounts() {
  const { data } = useSuspenseQuery(financeQuery);
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["finance"] });
  const [editing, setEditing] = useState<Acc | "new" | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const list = data.accounts.filter((a) => showArchived || !a.archived_at);
  const total = data.accounts.filter((a) => !a.archived_at).reduce((s, a) => s + a.balance_cents, 0);

  const act = async (p: PromiseLike<{ error: unknown }>, ok: string) => {
    const { error } = await p;
    if (error) toast.error(errMsg(error)); else { toast.success(ok); refresh(); }
  };

  return (
    <div>
      <PageHeader eyebrow="Spazio personale" title="Conti e carte">
        <Button onClick={() => setEditing("new")}><Plus className="h-4 w-4" />Nuovo conto</Button>
      </PageHeader>

      <div className="mb-6 rounded-2xl border bg-card p-5">
        <p className="text-sm text-muted-foreground">Saldo complessivo dei conti attivi</p>
        <p className="mt-1 font-display text-3xl" data-testid="total-balance">{eur(total / 100)}</p>
      </div>

      {list.length === 0 ? (
        <div className="grid min-h-48 place-items-center rounded-2xl border border-dashed bg-card p-10 text-center text-muted-foreground">
          Nessun conto. Crea il primo conto per iniziare a registrare movimenti.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {list.map((a) => (
            <article key={a.id} className="rounded-2xl border bg-card p-5" data-testid="account-card">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-lg">{a.name}</h2>
                  <p className="text-xs text-muted-foreground">{accountTypeLabel[a.type]} · {a.currency}{a.opened_on ? ` · aperto il ${dateFull(a.opened_on)}` : ""}</p>
                </div>
                {a.archived_at && <span className="rounded-full bg-muted px-2 py-0.5 text-xs">Archiviato</span>}
              </div>
              <p className="mt-4 font-display text-2xl" data-testid="account-balance">{eur(a.balance_cents / 100)}</p>
              <p className="text-xs text-muted-foreground">Saldo iniziale {eur(a.initial_balance_cents / 100)}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setEditing(a)}>Modifica</Button>
                {a.archived_at ? (
                  <Button size="sm" variant="outline" onClick={() => act(supabase.from("accounts").update({ archived_at: null }).eq("id", a.id), "Conto ripristinato")}>Ripristina</Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => act(supabase.from("accounts").update({ archived_at: new Date().toISOString() }).eq("id", a.id), "Conto archiviato")}>Archivia</Button>
                )}
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => {
                  if (confirm(`Eliminare il conto "${a.name}"? È possibile solo se non contiene movimenti.`))
                    act(supabase.from("accounts").delete().eq("id", a.id), "Conto eliminato");
                }}>Elimina</Button>
              </div>
            </article>
          ))}
        </div>
      )}
      {data.accounts.some((a) => a.archived_at) && (
        <button className="mt-4 text-sm text-muted-foreground underline" onClick={() => setShowArchived((v) => !v)}>
          {showArchived ? "Nascondi conti archiviati" : "Mostra conti archiviati"}
        </button>
      )}

      {editing && <AccountDialog account={editing === "new" ? null : editing} spaceId={data.spaceId} onClose={() => setEditing(null)} onSaved={refresh} />}
    </div>
  );
}

function AccountDialog({ account, spaceId, onClose, onSaved }: { account: Acc | null; spaceId: string; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(account?.name ?? "");
  const [type, setType] = useState<AccountType>(account?.type ?? "checking");
  const [currency, setCurrency] = useState(account?.currency ?? "EUR");
  const [initial, setInitial] = useState(account ? centsToInput(account.initial_balance_cents) : "0,00");
  const [opened, setOpened] = useState(account?.opened_on ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const cents = parseCents(initial, true);
    if (!name.trim()) return void toast.error("Indica il nome del conto.");
    if (cents === null) return void toast.error("Saldo iniziale non valido (massimo due decimali).");
    const row = { name: name.trim(), type, currency: currency.toUpperCase(), initial_balance_cents: cents, opened_on: opened || null };
    setBusy(true);
    const { error } = account
      ? await supabase.from("accounts").update(row).eq("id", account.id)
      : await supabase.from("accounts").insert({ ...row, space_id: spaceId });
    setBusy(false);
    if (error) return void toast.error(errMsg(error));
    toast.success(account ? "Conto aggiornato" : "Conto creato");
    onSaved(); onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{account ? "Modifica conto" : "Nuovo conto"}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5"><Label htmlFor="acc-name">Nome</Label><Input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Tipologia</Label>
              <Select value={type} onValueChange={(v) => setType(v as AccountType)}>
                <SelectTrigger aria-label="Tipologia"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(accountTypeLabel).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label htmlFor="acc-cur">Valuta</Label><Input id="acc-cur" value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={3} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label htmlFor="acc-init">Saldo iniziale</Label><Input id="acc-init" inputMode="decimal" value={initial} onChange={(e) => setInitial(e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="acc-open">Data di apertura</Label><Input id="acc-open" type="date" value={opened} onChange={(e) => setOpened(e.target.value)} /></div>
          </div>
          <p className="text-xs text-muted-foreground">Il saldo iniziale è il punto di partenza, non un'entrata. Il saldo corrente si calcola dai movimenti.</p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Annulla</Button>
            <Button type="submit" disabled={busy}>Salva</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
