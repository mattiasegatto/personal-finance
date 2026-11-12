import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
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
import { eur, dateFull } from "@/lib/domain";
import { centsToInput, errMsg, financeQuery, parseCents, type Direction } from "@/lib/finance";

export const Route = createFileRoute("/_authenticated/movimenti")({
  head: () => ({
    meta: [
      { title: "Movimenti — Fondo" },
      { name: "description", content: "Entrate e uscite del tuo spazio finanziario personale." },
      { property: "og:title", content: "Movimenti — Fondo" },
      {
        property: "og:description",
        content: "Entrate e uscite del tuo spazio finanziario personale.",
      },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(financeQuery),
  component: Transactions,
  errorComponent: ({ error }) => (
    <div role="alert" className="text-destructive">
      {errMsg(error)}
    </div>
  ),
});

type Fin = Awaited<ReturnType<NonNullable<typeof financeQuery.queryFn>>>;
type Tx = Fin["transactions"][number];
const ALL = "__all";

function Transactions() {
  const { data } = useSuspenseQuery(financeQuery);
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["finance"] });
  const [editing, setEditing] = useState<Tx | "new" | null>(null);
  const [editingTransfer, setEditingTransfer] = useState<Fin["transfers"][number] | "new" | null>(null);
  const [q, setQ] = useState("");
  const [acc, setAcc] = useState(ALL);
  const [dir, setDir] = useState(ALL);
  const [cat, setCat] = useState(ALL);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const accName = (id: string) => data.accounts.find((a) => a.id === id)?.name ?? "—";

  const list = useMemo(() => {
    const ordinary = data.transactions.filter((t) =>
      (acc === ALL || t.account_id === acc) && (dir === ALL || t.direction === dir) &&
      (cat === ALL || t.category_id === cat || data.categories.find((c) => c.id === t.category_id)?.parent_id === cat) &&
      (!from || t.occurred_on >= from) && (!to || t.occurred_on <= to) &&
      (!q || ((t.description ?? "") + " " + t.categoryLabel).toLowerCase().includes(q.toLowerCase()))
    ).map((data) => ({ kind: "ordinary" as const, data }));
    const transfers = data.transfers.filter((t) =>
      (acc === ALL || t.source_account_id === acc || t.destination_account_id === acc) &&
      dir === ALL && cat === ALL && (!from || t.occurred_on >= from) && (!to || t.occurred_on <= to) &&
      (!q || (t.description ?? "Trasferimento").toLowerCase().includes(q.toLowerCase()))
    ).map((data) => ({ kind: "transfer" as const, data }));
    return [...ordinary, ...transfers].sort((a, b) => b.data.occurred_on.localeCompare(a.data.occurred_on) || b.data.created_at.localeCompare(a.data.created_at));
  }, [data, q, acc, dir, cat, from, to]);
  const ordinaryRows = list.filter((r) => r.kind === "ordinary");
  const inflow = ordinaryRows.filter((r) => r.data.direction === "inflow").reduce((sum, r) => sum + r.data.amount_cents, 0);
  const outflow = ordinaryRows.filter((r) => r.data.direction === "outflow").reduce((sum, r) => sum + r.data.amount_cents, 0);
  const remove = async (t: Tx) => {
    if (
      !confirm(
        "Eliminare questo movimento? Il saldo del conto verrà ricalcolato. La cronologia resta conservata.",
      )
    )
      return;
    const { error } = await supabase
      .from("transactions")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", t.id);
    if (error) toast.error(errMsg(error));
    else {
      toast.success("Movimento eliminato");
      refresh();
    }
  };

  const noSetup =
    data.accounts.filter((a) => !a.archived_at).length === 0 || data.categories.length === 0;

  return (
    <div>
      <PageHeader eyebrow="Spazio personale" title="Movimenti">
        <Button onClick={() => setEditing("new")} disabled={noSetup}>
          <Plus className="h-4 w-4" />
          Nuovo movimento
        </Button>
      </PageHeader>

      {noSetup && (
        <div className="mb-6 rounded-2xl border bg-accent p-5 text-sm">
          Per registrare movimenti servono almeno un{" "}
          <Link to="/conti" className="underline">
            conto attivo
          </Link>{" "}
          e alcune{" "}
          <Link to="/categorie" className="underline">
            categorie
          </Link>
          .
        </div>
      )}

      <div className="mb-4 grid gap-3 rounded-2xl border bg-card p-4 md:grid-cols-4 xl:grid-cols-7">
        <Input
          placeholder="Cerca…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="md:col-span-4 xl:col-span-2"
          aria-label="Cerca"
        />
        <Select value={acc} onValueChange={setAcc}>
          <SelectTrigger aria-label="Filtra conto">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Tutti i conti</SelectItem>
            {data.accounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={dir} onValueChange={setDir}>
          <SelectTrigger aria-label="Filtra direzione">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Entrate e uscite</SelectItem>
            <SelectItem value="inflow">Entrate</SelectItem>
            <SelectItem value="outflow">Uscite</SelectItem>
          </SelectContent>
        </Select>
        <Select value={cat} onValueChange={setCat}>
          <SelectTrigger aria-label="Filtra categoria">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Tutte le categorie</SelectItem>
            {data.categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex gap-2 md:col-span-4 xl:col-span-2">
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="Dal"
          />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Al" />
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-6 text-sm">
        <span>
          Entrate <strong className="text-primary">{eur(inflow / 100)}</strong>
        </span>
        <span>
          Uscite <strong>{eur(outflow / 100)}</strong>
        </span>
        <span className="text-muted-foreground">{list.length} movimenti</span>
      </div>

      <div className="overflow-x-auto rounded-2xl border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="p-3">Data</th>
              <th className="p-3">Descrizione</th>
              <th className="p-3">Categoria</th>
              <th className="p-3">Conto</th>
              <th className="p-3 text-right">Importo</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-muted-foreground">
                  Nessun movimento.
                </td>
              </tr>
            )}
            {list.map((row) => row.kind === "transfer" ? (
              <tr key={row.data.id} className="border-b last:border-0" data-testid="transfer-row">
                <td className="p-3 whitespace-nowrap">{dateFull(row.data.occurred_on)}</td>
                <td className="p-3">{row.data.description || "Trasferimento"}</td>
                <td className="p-3 text-muted-foreground">Trasferimento</td>
                <td className="p-3">{accName(row.data.source_account_id)} → {accName(row.data.destination_account_id)}</td>
                <td className="p-3 text-right font-medium whitespace-nowrap">{eur(row.data.amount_cents / 100)}</td>
                <td className="p-3 text-right text-muted-foreground">Trasferimento</td>
              </tr>
            ) : (
              <tr key={row.data.id} className="border-b last:border-0" data-testid="tx-row">
                <td className="p-3 whitespace-nowrap">{dateFull(row.data.occurred_on)}</td>
                <td className="p-3">{row.data.description || <span className="text-muted-foreground">—</span>}</td>
                <td className="p-3">{row.data.categoryLabel}</td>
                <td className="p-3">{accName(row.data.account_id)}</td>
                <td className={"p-3 text-right font-medium whitespace-nowrap " + (row.data.direction === "inflow" ? "text-primary" : "")}>
                  {row.data.direction === "inflow" ? "+" : "−"}{eur(row.data.amount_cents / 100)}
                </td>
                <td className="p-3 text-right whitespace-nowrap">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(row.data)}>Modifica</Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => remove(row.data)}>Elimina</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <TxDialog
          tx={editing === "new" ? null : editing}
          data={data}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}

function TxDialog({
  tx,
  data,
  onClose,
  onSaved,
}: {
  tx: Tx | null;
  data: Fin;
  onClose: () => void;
  onSaved: () => void;
}) {
  const activeAccounts = data.accounts.filter((a) => !a.archived_at || a.id === tx?.account_id);
  const [direction, setDirection] = useState<Direction>(tx?.direction ?? "outflow");
  const [account, setAccount] = useState(tx?.account_id ?? activeAccounts[0]?.id ?? "");
  const [category, setCategory] = useState(tx?.category_id ?? "");
  const [date, setDate] = useState(tx?.occurred_on ?? new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState(tx ? centsToInput(tx.amount_cents) : "");
  const [desc, setDesc] = useState(tx?.description ?? "");
  const [busy, setBusy] = useState(false);
  const want = direction === "inflow" ? "income" : "expense";
  const cats = data.categories.filter(
    (c) => c.rootKind === want && (!c.archived_at || c.id === tx?.category_id),
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const cents = parseCents(amount);
    if (!cents)
      return void toast.error("L'importo deve essere positivo, con al massimo due decimali.");
    if (!account) return void toast.error("Scegli il conto.");
    if (!category || !cats.some((c) => c.id === category))
      return void toast.error("Scegli una categoria coerente con la direzione.");
    if (!date) return void toast.error("Indica la data.");
    const row = {
      direction,
      account_id: account,
      category_id: category,
      occurred_on: date,
      amount_cents: cents,
      description: desc.trim() || null,
    };
    setBusy(true);
    const { error } = tx
      ? await supabase.from("transactions").update(row).eq("id", tx.id)
      : await supabase.from("transactions").insert({ ...row, space_id: data.spaceId });
    setBusy(false);
    if (error) return void toast.error(errMsg(error));
    toast.success(tx ? "Movimento aggiornato" : "Movimento registrato");
    onSaved();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tx ? "Modifica movimento" : "Nuovo movimento"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
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
                {d === "inflow" ? "Entrata" : "Uscita"}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="tx-date">Data</Label>
              <Input
                id="tx-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tx-amount">Importo</Label>
              <Input
                id="tx-amount"
                inputMode="decimal"
                placeholder="0,00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Conto</Label>
            <Select value={account} onValueChange={setAccount}>
              <SelectTrigger aria-label="Conto">
                <SelectValue placeholder="Scegli il conto" />
              </SelectTrigger>
              <SelectContent>
                {activeAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Categoria</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger aria-label="Categoria">
                <SelectValue placeholder="Scegli la categoria" />
              </SelectTrigger>
              <SelectContent>
                {cats.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tx-desc">Descrizione (facoltativa)</Label>
            <Input
              id="tx-desc"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              maxLength={200}
            />
          </div>
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
