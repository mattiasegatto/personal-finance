import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { financeQuery, errMsg, parseCents, type Direction } from "@/lib/finance";

export const Route = createFileRoute("/_authenticated/scadenze")({
  head: () => ({
    meta: [
      { title: "Scadenze — Fondo" },
      { name: "description", content: "Pianifica e monitora pagamenti e incassi futuri." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(financeQuery),
  component: Deadlines,
  errorComponent: ({ error }) => (
    <div role="alert" className="text-destructive">
      {errMsg(error)}
    </div>
  ),
});

type Finance = Awaited<ReturnType<NonNullable<typeof financeQuery.queryFn>>>;
type Deadline = {
  id: string;
  account_id: string;
  category_id: string;
  direction: Direction;
  amount_cents: number;
  title: string;
  due_on: string;
  notes: string | null;
  status: "pending" | "completed" | "cancelled";
};
const today = () => new Date().toISOString().slice(0, 10);
const dateText = (s: string) =>
  new Intl.DateTimeFormat("it-IT", { dateStyle: "medium" }).format(new Date(s + "T12:00:00"));
const money = (c: number, currency: string) =>
  new Intl.NumberFormat("it-IT", { style: "currency", currency }).format(c / 100);

function Deadlines() {
  const { data } = useSuspenseQuery(financeQuery);
  const qc = useQueryClient();
  const [items, setItems] = useState<Deadline[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const load = useCallback(async () => {
    const { data: rows, error } = await db
      .from("deadlines")
      .select("*")
      .eq("space_id", data.spaceId)
      .order("due_on");
    if (error) {
      toast.error(errMsg(error));
      return;
    }
    setItems((rows ?? []) as Deadline[]);
    setLoaded(true);
  }, [data.spaceId]);
  useEffect(() => {
    void load();
  }, [load]);
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["finance"] });
    await load();
  };
  const accountName = (id: string) => data.accounts.find((a) => a.id === id)?.name ?? "—";
  const categoryName = (id: string) => data.categories.find((c) => c.id === id)?.label ?? "—";
  const complete = async (item: Deadline) => {
    const { error } = await supabase.rpc("complete_deadline", { _id: item.id });
    if (error) toast.error(errMsg(error));
    else {
      toast.success("Movimento registrato e scadenza completata");
      await refresh();
    }
  };
  const cancel = async (item: Deadline) => {
    const { error } = await supabase.rpc("cancel_deadline", { _id: item.id });
    if (error) toast.error(errMsg(error));
    else {
      toast.success("Scadenza annullata");
      await load();
    }
  };
  const visible = items.filter((x) => filter === "all" || x.status === "pending");
  const pending = items.filter((x) => x.status === "pending");
  const overdue = pending.filter((x) => x.due_on < today());
  const upcoming = pending.filter((x) => x.due_on >= today());
  return (
    <div>
      <PageHeader eyebrow="Spazio personale" title="Scadenze">
        <Button
          onClick={() => setDialog(true)}
          disabled={
            !data.accounts.some((a) => !a.archived_at) ||
            !data.categories.some((c) => !c.archived_at)
          }
        >
          <Plus className="h-4 w-4" />
          Nuova scadenza
        </Button>
      </PageHeader>
      <p className="mb-5 max-w-3xl text-sm text-muted-foreground">
        Tieni sotto controllo bollette, rate, imposte, abbonamenti e incassi attesi. La scadenza non
        modifica il saldo: il movimento viene creato soltanto quando la contrassegni come
        completata.
      </p>
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Metric label="Scadenze aperte" value={String(pending.length)} />
        <Metric label="In ritardo" value={String(overdue.length)} />
        <Metric label="Prossime" value={String(upcoming.length)} />
      </div>
      <div className="mb-3 flex justify-end">
        <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">Solo aperte</SelectItem>
            <SelectItem value="all">Tutte le scadenze</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {!loaded ? (
        <p className="text-sm text-muted-foreground">Caricamento…</p>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card p-8 text-center">
          <h2 className="font-semibold">Nessuna scadenza</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Aggiungi un pagamento o un incasso futuro per tenerlo sotto controllo.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-3">Data</th>
                <th className="p-3">Scadenza</th>
                <th className="p-3">Conto</th>
                <th className="p-3 text-right">Importo</th>
                <th className="p-3">Stato</th>
                <th className="p-3">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => {
                const currency =
                  data.accounts.find((a) => a.id === item.account_id)?.currency ?? "EUR";
                const late = item.status === "pending" && item.due_on < today();
                return (
                  <tr key={item.id} className="border-b last:border-0">
                    <td className="p-3 whitespace-nowrap">{dateText(item.due_on)}</td>
                    <td className="p-3">
                      <div className="font-medium">{item.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {categoryName(item.category_id)}
                        {item.notes ? " · " + item.notes : ""}
                      </div>
                    </td>
                    <td className="p-3">{accountName(item.account_id)}</td>
                    <td className="p-3 text-right font-medium whitespace-nowrap">
                      {item.direction === "inflow" ? "+" : "−"}
                      {money(item.amount_cents, currency)}
                    </td>
                    <td className="p-3 whitespace-nowrap">
                      {late ? (
                        <span className="text-destructive">In ritardo</span>
                      ) : item.status === "pending" ? (
                        "Aperta"
                      ) : item.status === "completed" ? (
                        "Completata"
                      ) : (
                        "Annullata"
                      )}
                    </td>
                    <td className="p-3 whitespace-nowrap">
                      {item.status === "pending" ? (
                        <>
                          <Button size="sm" onClick={() => void complete(item)}>
                            Completa
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => void cancel(item)}>
                            Annulla
                          </Button>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {dialog && (
        <DeadlineDialog
          data={data}
          onClose={() => setDialog(false)}
          onSaved={async () => {
            setDialog(false);
            await refresh();
          }}
        />
      )}
    </div>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <section className="rounded-2xl border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </section>
  );
}
function DeadlineDialog({
  data,
  onClose,
  onSaved,
}: {
  data: Finance;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [direction, setDirection] = useState<Direction>("outflow");
  const [account, setAccount] = useState(data.accounts.find((a) => !a.archived_at)?.id ?? "");
  const [category, setCategory] = useState("");
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [due, setDue] = useState(today());
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const categories = data.categories.filter(
    (c) => !c.archived_at && c.rootKind === (direction === "inflow" ? "income" : "expense"),
  );
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const cents = parseCents(amount);
    if (!title.trim() || !cents || !account || !category || !due)
      return void toast.error("Completa tutti i campi obbligatori.");
    setBusy(true);
    const { error } = await db.from("deadlines").insert({
      space_id: data.spaceId,
      account_id: account,
      category_id: category,
      direction,
      amount_cents: cents,
      title: title.trim(),
      due_on: due,
      notes: notes.trim() || null,
    });
    setBusy(false);
    if (error) return void toast.error(errMsg(error));
    toast.success("Scadenza creata");
    onSaved();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuova scadenza</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {(["outflow", "inflow"] as const).map((d) => (
              <Button
                key={d}
                type="button"
                variant={direction === d ? "default" : "outline"}
                onClick={() => {
                  setDirection(d);
                  setCategory("");
                }}
              >
                {d === "inflow" ? "Incasso atteso" : "Pagamento"}
              </Button>
            ))}
          </div>
          <div className="space-y-1">
            <Label>Descrizione</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>Importo</Label>
              <Input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0,00"
                inputMode="decimal"
              />
            </div>
            <div className="space-y-1">
              <Label>Data di scadenza</Label>
              <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Conto</Label>
            <Select value={account} onValueChange={setAccount}>
              <SelectTrigger>
                <SelectValue placeholder="Seleziona conto" />
              </SelectTrigger>
              <SelectContent>
                {data.accounts
                  .filter((a) => !a.archived_at)
                  .map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name} · {a.currency}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Categoria</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue placeholder="Seleziona categoria" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Note (facoltative)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Annulla
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Salvataggio…" : "Salva scadenza"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
