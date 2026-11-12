import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ArrowRight, Handshake, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { spacesQuery } from "@/lib/spaces";
import { parseCents } from "@/lib/finance";

export const Route = createFileRoute("/_authenticated/spese-condivise")({
  loader: ({ context }) => context.queryClient.ensureQueryData(spacesQuery),
  head: () => ({ meta: [{ title: "Spese condivise — Personal Finance" }] }),
  component: SharedPage,
});

type Member = { user_id: string; role: "owner" | "member" | "viewer"; name: string };
type Expense = {
  id: string;
  occurred_on: string;
  description: string;
  category_id: string;
  amount_cents: number;
  paid_by_user_id: string;
  split_mode: string;
  linked_transaction_id: string | null;
  shares: { member_user_id: string; amount_cents: number }[];
};
type Settlement = {
  id: string;
  occurred_on: string;
  from_user_id: string;
  to_user_id: string;
  amount_cents: number;
  kind: string;
  note: string | null;
};
type Category = {
  id: string;
  name: string;
  parent_id: string | null;
  kind: "income" | "expense" | null;
};
const money = (c: number) =>
  new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(c / 100);
const today = () => new Date().toISOString().slice(0, 10);

function SharedPage() {
  const { data: spacesData } = useSuspenseQuery(spacesQuery);
  const spaces = spacesData.spaces.filter((s) => s.kind === "shared" && !s.archived_at);
  const [selected, setSelected] = useState("");
  const space = spaces.find((s) => s.id === selected) ?? spaces[0];
  const qc = useQueryClient();
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [settlementOpen, setSettlementOpen] = useState(false);
  const [period, setPeriod] = useState("all");
  const [person, setPerson] = useState("all");
  const q = useQuery({
    queryKey: ["shared-finance", space?.id],
    enabled: !!space,
    queryFn: async () => {
      const sid = space!.id;
      const [mr, cr, er, sr] = await Promise.all([
        supabase.from("space_memberships").select("space_id,user_id,role").eq("space_id", sid),
        supabase
          .from("categories")
          .select("id,name,parent_id,kind")
          .eq("space_id", sid)
          .is("archived_at", null)
          .order("name"),
        supabase
          .from("shared_expenses")
          .select("*")
          .eq("space_id", sid)
          .is("deleted_at", null)
          .order("occurred_on", { ascending: false }),
        supabase
          .from("shared_settlements")
          .select("*")
          .eq("space_id", sid)
          .is("deleted_at", null)
          .order("occurred_on", { ascending: false }),
      ]);
      const error = mr.error ?? cr.error ?? er.error ?? sr.error;
      if (error) throw error;
      const ids = (mr.data ?? []).map((m) => m.user_id);
      const pr = ids.length
        ? await supabase.from("profiles").select("id,display_name").in("id", ids)
        : { data: [], error: null };
      if (pr.error) throw pr.error;
      const members: Member[] = (mr.data ?? []).map((m) => ({
        ...m,
        role: m.role,
        name: pr.data?.find((p) => p.id === m.user_id)?.display_name || "Membro",
      }));
      const rows = er.data ?? [];
      const shr = rows.length
        ? await supabase
            .from("shared_expense_shares")
            .select("*")
            .in(
              "expense_id",
              rows.map((e) => e.id),
            )
        : { data: [], error: null };
      if (shr.error) throw shr.error;
      const expenses: Expense[] = rows.map((e) => ({
        ...e,
        amount_cents: Number(e.amount_cents),
        shares: (shr.data ?? [])
          .filter((s) => s.expense_id === e.id)
          .map((s) => ({ member_user_id: s.member_user_id, amount_cents: Number(s.amount_cents) })),
      }));
      const settlements: Settlement[] = (sr.data ?? []).map((s) => ({
        ...s,
        amount_cents: Number(s.amount_cents),
      }));
      return { members, categories: (cr.data ?? []) as Category[], expenses, settlements };
    },
  });
  const data = q.data;
  const members = data?.members ?? [],
    expenses = data?.expenses ?? [],
    settlements = data?.settlements ?? [];
  const balances = useMemo(() => {
    const b: Record<string, number> = {};
    const add = (id: string, v: number) => {
      b[id] = (b[id] ?? 0) + v;
    };
    expenses.forEach((e) => {
      add(e.paid_by_user_id, e.amount_cents);
      e.shares.forEach((s) => add(s.member_user_id, -s.amount_cents));
    });
    settlements.forEach((s) => {
      add(s.from_user_id, s.amount_cents);
      add(s.to_user_id, -s.amount_cents);
    });
    return b;
  }, [expenses, settlements]);
  const debtor = members.find((m) => (balances[m.user_id] ?? 0) < 0),
    creditor = members.find((m) => (balances[m.user_id] ?? 0) > 0);
  const canEdit = space?.myRole === "owner" || space?.myRole === "member";
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["shared-finance", space?.id] });
  };
  const removeExpense = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("delete_shared_expense", { _id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Spesa annullata");
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const removeSettlement = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("delete_shared_settlement", { _id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Rimborso annullato");
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const visibleExpenses = expenses.filter(
    (e) =>
      (period === "all" || e.occurred_on.startsWith(period)) &&
      (person === "all" ||
        e.paid_by_user_id === person ||
        e.shares.some((s) => s.member_user_id === person)),
  );
  const visibleSettlements = settlements.filter(
    (s) =>
      (period === "all" || s.occurred_on.startsWith(period)) &&
      (person === "all" || s.from_user_id === person || s.to_user_id === person),
  );
  if (!spaces.length)
    return (
      <div>
        <PageHeader eyebrow="Spazio condiviso" title="Spese condivise" />
        <div className="rounded-2xl border border-dashed p-8 text-center">
          <h2 className="font-semibold">Nessuno spazio condiviso attivo</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Crea uno spazio condiviso o accetta un invito nelle Impostazioni.
          </p>
          <Button
            className="mt-4"
            onClick={() => {
              window.location.href = "/impostazioni";
            }}
          >
            Vai alle impostazioni
          </Button>
        </div>
      </div>
    );
  return (
    <div>
      <PageHeader eyebrow="Gestione condivisa" title="Spese condivise">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-positive" />I dati personali restano privati
        </div>
      </PageHeader>
      <div className="mb-6 flex flex-wrap gap-3">
        <Select value={space!.id} onValueChange={setSelected}>
          <SelectTrigger className="w-56 bg-card">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {spaces.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canEdit && (
          <>
            <Button onClick={() => setExpenseOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Nuova spesa
            </Button>
            <Button variant="outline" onClick={() => setSettlementOpen(true)}>
              <Handshake className="mr-2 h-4 w-4" />
              Registra rimborso
            </Button>
          </>
        )}
      </div>
      {q.isLoading ? (
        <p>Caricamento…</p>
      ) : q.isError ? (
        <p className="text-destructive">{q.error.message}</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {members.map((m) => (
              <section key={m.user_id} className="rounded-2xl border bg-card p-5">
                <p className="font-medium">
                  {m.name}
                  {m.user_id === spacesData.uid ? " · tu" : ""}
                </p>
                <p className="mt-3 text-xs text-muted-foreground">Ha pagato</p>
                <p className="num text-lg">
                  {money(
                    expenses
                      .filter((e) => e.paid_by_user_id === m.user_id)
                      .reduce((a, e) => a + e.amount_cents, 0),
                  )}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">Saldo netto</p>
                <p
                  className={`num text-xl font-semibold ${(balances[m.user_id] ?? 0) >= 0 ? "text-positive" : "text-negative"}`}
                >
                  {money(balances[m.user_id] ?? 0)}
                </p>
              </section>
            ))}
          </div>
          <section className="mt-4 rounded-2xl border bg-card p-5">
            <p className="text-sm text-muted-foreground">Situazione complessiva</p>
            {debtor && creditor ? (
              <p className="mt-2">
                <strong>{debtor.name}</strong> deve versare a <strong>{creditor.name}</strong>{" "}
                <strong className="num">
                  {money(
                    Math.min(-(balances[debtor.user_id] ?? 0), balances[creditor.user_id] ?? 0),
                  )}
                </strong>
              </p>
            ) : (
              <p className="mt-2 font-semibold">Tutti i saldi sono in pari.</p>
            )}
          </section>
          <div className="mt-7 flex flex-wrap gap-3">
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="w-48 bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti i periodi</SelectItem>
                {[...new Set(expenses.map((e) => e.occurred_on.slice(0, 7)))]
                  .sort()
                  .reverse()
                  .map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Select value={person} onValueChange={setPerson}>
              <SelectTrigger className="w-48 bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti i partecipanti</SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.user_id} value={m.user_id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <section className="mt-4 overflow-hidden rounded-2xl border bg-card">
            <div className="border-b px-5 py-3 font-semibold">Spese · {visibleExpenses.length}</div>
            {visibleExpenses.length ? (
              visibleExpenses.map((e) => (
                <div
                  key={e.id}
                  className="flex flex-wrap items-center gap-3 border-b px-5 py-4 last:border-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{e.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {e.occurred_on} · pagata da{" "}
                      {members.find((m) => m.user_id === e.paid_by_user_id)?.name ?? "—"} ·{" "}
                      {e.shares
                        .map(
                          (s) =>
                            `${members.find((m) => m.user_id === s.member_user_id)?.name ?? "?"}: ${money(s.amount_cents)}`,
                        )
                        .join(" · ")}
                    </p>
                  </div>
                  <span className="num font-semibold">{money(e.amount_cents)}</span>
                  {e.linked_transaction_id && (
                    <span className="text-xs text-muted-foreground">Collegata</span>
                  )}
                  {canEdit && (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Annulla spesa"
                      onClick={() => removeExpense.mutate(e.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))
            ) : (
              <p className="px-5 py-8 text-sm text-muted-foreground">Nessuna spesa registrata.</p>
            )}
          </section>
          <section className="mt-6 overflow-hidden rounded-2xl border bg-card">
            <div className="border-b px-5 py-3 font-semibold">
              Rimborsi · {visibleSettlements.length}
            </div>
            {visibleSettlements.length ? (
              visibleSettlements.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-3 border-b px-5 py-4 last:border-0"
                >
                  <span className="min-w-0 flex-1 text-sm">
                    <strong>{members.find((m) => m.user_id === s.from_user_id)?.name}</strong>
                    <ArrowRight className="mx-2 inline h-3 w-3" />
                    <strong>{members.find((m) => m.user_id === s.to_user_id)?.name}</strong>
                    <span className="ml-2 text-muted-foreground">
                      {s.note ?? s.kind} · {s.occurred_on}
                    </span>
                  </span>
                  <strong className="num">{money(s.amount_cents)}</strong>
                  {canEdit && (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Annulla rimborso"
                      onClick={() => removeSettlement.mutate(s.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))
            ) : (
              <p className="px-5 py-8 text-sm text-muted-foreground">Nessun rimborso registrato.</p>
            )}
          </section>
        </>
      )}
      {expenseOpen && (
        <ExpenseDialog
          spaceId={space!.id}
          members={members}
          categories={data?.categories ?? []}
          uid={spacesData.uid!}
          onClose={() => setExpenseOpen(false)}
          onSaved={refresh}
        />
      )}
      {settlementOpen && (
        <SettlementDialog
          spaceId={space!.id}
          members={members}
          balances={balances}
          uid={spacesData.uid!}
          onClose={() => setSettlementOpen(false)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4">
      <section className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl border bg-background p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">{title}</h2>
          <Button type="button" variant="ghost" onClick={onClose}>
            Chiudi
          </Button>
        </div>
        {children}
      </section>
    </div>
  );
}
function ExpenseDialog({
  spaceId,
  members,
  categories,
  uid,
  onClose,
  onSaved,
}: {
  spaceId: string;
  members: Member[];
  categories: Category[];
  uid: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const active = members.filter((m) => m.role !== "viewer");
  const [date, setDate] = useState(today()),
    [description, setDescription] = useState(""),
    [amount, setAmount] = useState(""),
    [payer, setPayer] = useState(uid),
    [category, setCategory] = useState(
      categories.find((c) => c.parent_id)?.id ?? categories[0]?.id ?? "",
    ),
    [shares, setShares] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false);
  const cents = parseCents(amount);
  const equal = active.length && cents !== null ? Math.floor(cents / active.length) : 0;
  const split = active.map((m, i) => ({
    member_user_id: m.user_id,
    amount_cents:
      shares[m.user_id] === undefined
        ? equal + (cents !== null && i < cents % active.length ? 1 : 0)
        : (parseCents(shares[m.user_id]) ?? -1),
  }));
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!cents || cents <= 0 || !description.trim() || !category) return;
    if (
      split.some((s) => s.amount_cents < 0) ||
      split.reduce((a, s) => a + s.amount_cents, 0) !== cents
    ) {
      toast.error("Le quote devono coincidere con l'importo totale.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("save_shared_expense", {
      _id: null,
      _space_id: spaceId,
      _occurred_on: date,
      _description: description.trim(),
      _category_id: category,
      _amount_cents: cents,
      _paid_by_user_id: payer,
      _split_mode: Object.keys(shares).length ? "amount" : "equal",
      _shares: split,
      _linked_transaction_id: null,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Spesa registrata");
      onSaved();
      onClose();
    }
  };
  return (
    <Modal title="Nuova spesa condivisa" onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Data</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <div>
            <Label>Importo</Label>
            <Input
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setShares({});
              }}
              placeholder="0,00"
              required
            />
          </div>
        </div>
        <div>
          <Label>Descrizione</Label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={200}
            required
          />
        </div>
        <div>
          <Label>Categoria</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger>
              <SelectValue placeholder="Seleziona categoria" />
            </SelectTrigger>
            <SelectContent>
              {categories
                .filter((c) => c.kind === "expense" || c.parent_id !== null)
                .map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Pagato da</Label>
          <Select value={payer} onValueChange={setPayer}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {active.map((m) => (
                <SelectItem key={m.user_id} value={m.user_id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Quote individuali (predefinite 50/50 o ripartite equamente)</Label>
          {active.map((m, i) => (
            <div key={m.user_id} className="grid grid-cols-[1fr_120px] items-center gap-2">
              <span className="text-sm">{m.name}</span>
              <Input
                value={
                  shares[m.user_id] ??
                  (cents !== null ? (split[i].amount_cents / 100).toFixed(2).replace(".", ",") : "")
                }
                onChange={(e) => setShares((old) => ({ ...old, [m.user_id]: e.target.value }))}
                placeholder="0,00"
              />
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            Totale quote: {money(split.reduce((a, s) => a + Math.max(0, s.amount_cents), 0))} /{" "}
            {cents === null ? "—" : money(cents)}
          </p>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Annulla
          </Button>
          <Button
            type="submit"
            disabled={busy || !cents || cents <= 0 || !description.trim() || !category}
          >
            Salva spesa
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function SettlementDialog({
  spaceId,
  members,
  balances,
  uid,
  onClose,
  onSaved,
}: {
  spaceId: string;
  members: Member[];
  balances: Record<string, number>;
  uid: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const debtor = members.find((m) => (balances[m.user_id] ?? 0) < 0),
    creditor = members.find((m) => (balances[m.user_id] ?? 0) > 0);
  const [from, setFrom] = useState(debtor?.user_id ?? uid),
    [to, setTo] = useState(
      creditor?.user_id ?? members.find((m) => m.user_id !== uid)?.user_id ?? "",
    ),
    [date, setDate] = useState(today()),
    [amount, setAmount] = useState(
      debtor && creditor
        ? (Math.min(-(balances[debtor.user_id] ?? 0), balances[creditor.user_id] ?? 0) / 100)
            .toFixed(2)
            .replace(".", ",")
        : "",
    ),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false);
  const cents = parseCents(amount);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!cents || cents <= 0 || from === to) return;
    setBusy(true);
    const { error } = await supabase.rpc("save_shared_settlement", {
      _id: null,
      _space_id: spaceId,
      _occurred_on: date,
      _from_user_id: from,
      _to_user_id: to,
      _amount_cents: cents,
      _kind: "rimborso",
      _note: note.trim() || null,
      _linked_transaction_id: null,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Rimborso registrato");
      onSaved();
      onClose();
    }
  };
  return (
    <Modal title="Registra un rimborso" onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <div>
          <Label>Chi paga</Label>
          <Select value={from} onValueChange={setFrom}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {members.map((m) => (
                <SelectItem key={m.user_id} value={m.user_id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Chi riceve</Label>
          <Select value={to} onValueChange={setTo}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {members
                .filter((m) => m.user_id !== from)
                .map((m) => (
                  <SelectItem key={m.user_id} value={m.user_id}>
                    {m.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Data</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <div>
            <Label>Importo</Label>
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0,00"
              required
            />
          </div>
        </div>
        <div>
          <Label>Nota</Label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Annulla
          </Button>
          <Button type="submit" disabled={busy || !cents || cents <= 0 || from === to}>
            Registra rimborso
          </Button>
        </div>
      </form>
    </Modal>
  );
}
