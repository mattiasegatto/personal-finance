import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowRight, Link2, Repeat, ShieldCheck, Handshake } from "lucide-react";
import { PageHeader } from "@/components/page";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { equalShares, eur, netBalances, type SharedExpense } from "@/lib/domain";
import { categories, memberName, members, settlements, sharedExpenses } from "@/lib/mock-data";

export const Route = createFileRoute("/spese-condivise")({
  head: () => ({
    meta: [
      { title: "Spese condivise — Fondo" },
      { name: "description", content: "Spese comuni, quote, saldo e rimborsi tra partecipanti (dati dimostrativi)." },
      { property: "og:title", content: "Spese condivise — Fondo" },
      { property: "og:description", content: "Spese comuni, quote, saldo e rimborsi tra partecipanti." },
    ],
  }),
  component: SharedPage,
});

const monthLabel = (ym: string) =>
  new Date(ym + "-01").toLocaleDateString("it-IT", { month: "long", year: "numeric" });
const dateLabel = (d: string) => new Date(d).toLocaleDateString("it-IT", { day: "2-digit", month: "short" });
const splitLabel = { equal: "50 / 50", percent: "Percentuale", amount: "Importi" } as const;

function Avatar({ id }: { id: string }) {
  const m = members.find((x) => x.id === id)!;
  return (
    <span className={`inline-grid h-6 w-6 place-items-center rounded-full text-[10px] font-bold text-primary-foreground ${id === "m1" ? "bg-person-a" : "bg-person-b"}`}>
      {m.initials}
    </span>
  );
}

function SharedPage() {
  const [expenses, setExpenses] = useState<SharedExpense[]>(sharedExpenses);
  const [period, setPeriod] = useState("all");
  const [category, setCategory] = useState("all");
  const [person, setPerson] = useState("all");
  const [editing, setEditing] = useState<SharedExpense | null>(null);

  const months = useMemo(() => [...new Set(expenses.map((e) => e.date.slice(0, 7)))].sort().reverse(), [expenses]);

  const filtered = expenses.filter(
    (e) =>
      (period === "all" || e.date.startsWith(period)) &&
      (category === "all" || e.category === category) &&
      (person === "all" || e.paidBy === person),
  );
  const filteredSettlements = settlements.filter(
    (s) => (period === "all" || s.date.startsWith(period)) && (person === "all" || s.from === person || s.to === person),
  );

  const balances = netBalances(expenses, settlements);
  const creditor = members.find((m) => (balances[m.id] ?? 0) > 0);
  const debtor = members.find((m) => (balances[m.id] ?? 0) < 0);
  const owed = creditor ? balances[creditor.id] : 0;

  const monthly = [...months].reverse().map((ym) => {
    const list = expenses.filter((e) => e.date.startsWith(ym));
    const row: Record<string, number | string> = { mese: new Date(ym + "-01").toLocaleDateString("it-IT", { month: "short" }) };
    for (const m of members) row[m.name] = list.filter((e) => e.paidBy === m.id).reduce((a, e) => a + e.amount, 0);
    return row;
  });

  // Saldo progressivo: eventi in ordine cronologico, saldo dal punto di vista di Mattia.
  const timeline = useMemo(() => {
    const events = [
      ...expenses.map((e) => ({ date: e.date, id: e.id, label: e.description, type: "spesa" as const,
        delta: (e.paidBy === "m1" ? e.amount : 0) - (e.shares.find((s) => s.memberId === "m1")?.amount ?? 0) })),
      ...settlements.map((s) => ({ date: s.date, id: s.id, label: s.note ?? "Rimborso", type: s.kind,
        delta: s.from === "m1" ? s.amount : -s.amount })),
    ].sort((a, b) => a.date.localeCompare(b.date));
    let run = 0;
    return events.map((ev) => ({ ...ev, balance: (run = Math.round((run + ev.delta) * 100) / 100) })).reverse();
  }, [expenses]);

  const total = filtered.reduce((a, e) => a + e.amount, 0);

  return (
    <div>
      <PageHeader eyebrow="Spazio condiviso · Casa" title="Spese condivise">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-positive" />
          Conti e investimenti personali restano privati
        </div>
      </PageHeader>

      {/* Saldo */}
      <div className="grid gap-4 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="rounded-2xl bg-primary p-6 text-primary-foreground">
          <p className="text-sm opacity-80">Saldo attuale</p>
          {creditor && debtor ? (
            <>
              <p className="num mt-2 font-display text-4xl">{eur(owed)}</p>
              <p className="mt-3 flex items-center gap-2 text-sm">
                <strong>{debtor.name}</strong> <ArrowRight className="h-4 w-4" /> <strong>{creditor.name}</strong>
              </p>
            </>
          ) : (
            <p className="mt-2 font-display text-3xl">In pari</p>
          )}
          <Button variant="secondary" size="sm" className="mt-5"><Handshake className="h-4 w-4" />Registra pareggio</Button>
        </div>
        {members.map((m) => {
          const paid = expenses.filter((e) => e.paidBy === m.id).reduce((a, e) => a + e.amount, 0);
          const share = expenses.flatMap((e) => e.shares).filter((s) => s.memberId === m.id).reduce((a, s) => a + s.amount, 0);
          return (
            <div key={m.id} className="rounded-2xl border bg-card p-6">
              <div className="flex items-center gap-2"><Avatar id={m.id} /><span className="font-medium">{m.name}</span></div>
              <dl className="mt-4 space-y-1.5 text-sm">
                <div className="flex justify-between"><dt className="text-muted-foreground">Ha pagato</dt><dd className="num">{eur(paid)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Sua quota</dt><dd className="num">{eur(share)}</dd></div>
                <div className="flex justify-between border-t pt-1.5 font-semibold">
                  <dt>Netto</dt>
                  <dd className={`num ${(balances[m.id] ?? 0) >= 0 ? "text-positive" : "text-negative"}`}>{eur(balances[m.id] ?? 0)}</dd>
                </div>
              </dl>
            </div>
          );
        })}
      </div>

      {/* Filtri */}
      <div className="mt-8 flex flex-wrap gap-3">
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-44 bg-card"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tutti i periodi</SelectItem>
            {months.map((m) => <SelectItem key={m} value={m} className="capitalize">{monthLabel(m)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-44 bg-card"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tutte le categorie</SelectItem>
            {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={person} onValueChange={setPerson}>
          <SelectTrigger className="w-44 bg-card"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tutti i partecipanti</SelectItem>
            {members.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Tabs defaultValue="spese" className="mt-6">
        <TabsList>
          <TabsTrigger value="spese">Spese</TabsTrigger>
          <TabsTrigger value="riepilogo">Riepilogo mensile</TabsTrigger>
          <TabsTrigger value="saldo">Saldo progressivo</TabsTrigger>
          <TabsTrigger value="rimborsi">Rimborsi</TabsTrigger>
        </TabsList>

        <TabsContent value="spese" className="mt-4">
          <div className="overflow-hidden rounded-2xl border bg-card">
            <div className="flex items-center justify-between border-b px-5 py-3 text-sm">
              <span className="text-muted-foreground">{filtered.length} spese</span>
              <span className="num font-semibold">{eur(total)}</span>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead><TableHead>Descrizione</TableHead><TableHead className="hidden md:table-cell">Categoria</TableHead>
                  <TableHead>Pagato da</TableHead><TableHead className="hidden md:table-cell">Divisione</TableHead><TableHead className="text-right">Importo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((e) => (
                  <TableRow key={e.id} className="cursor-pointer" onClick={() => setEditing(e)}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{dateLabel(e.date)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 font-medium">
                        {e.description}
                        {e.linkedTransactionId && <span title="Collegata a un movimento personale"><Link2 className="h-3.5 w-3.5 text-transfer" /></span>}
                        {e.recurrenceId && <span title="Ricorrente"><Repeat className="h-3.5 w-3.5 text-muted-foreground" /></span>}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell"><Badge variant="secondary">{e.category}</Badge></TableCell>
                    <TableCell><div className="flex items-center gap-2"><Avatar id={e.paidBy} /><span className="hidden sm:inline">{memberName(e.paidBy)}</span></div></TableCell>
                    <TableCell className="hidden md:table-cell">
                      <span className="text-xs text-muted-foreground">{splitLabel[e.splitMode]}</span>
                      <span className="num ml-2 text-xs">{e.shares.map((s) => eur(s.amount)).join(" · ")}</span>
                    </TableCell>
                    <TableCell className="num text-right font-semibold">{eur(e.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Link2 className="h-3 w-3 text-transfer" /> Collegata al movimento bancario del pagatore: non viene duplicata nelle uscite. Clicca una spesa per modificarne le quote.
          </p>
        </TabsContent>

        <TabsContent value="riepilogo" className="mt-4 grid gap-4 md:grid-cols-[2fr_1fr]">
          <div className="rounded-2xl border bg-card p-6">
            <h3 className="text-lg">Spese comuni per mese</h3>
            <div className="mt-4 h-64">
              <ResponsiveContainer>
                <BarChart data={monthly}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="mese" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} width={50} />
                  <Tooltip formatter={(v: number) => eur(v)} />
                  <Bar dataKey="Mattia" stackId="a" fill="var(--person-a)" />
                  <Bar dataKey="Giulia" stackId="a" fill="var(--person-b)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="space-y-3">
            {months.map((ym) => {
              const list = expenses.filter((e) => e.date.startsWith(ym));
              return (
                <div key={ym} className="flex items-center justify-between rounded-xl border bg-card px-5 py-4">
                  <div><p className="font-medium capitalize">{monthLabel(ym)}</p><p className="text-xs text-muted-foreground">{list.length} spese</p></div>
                  <p className="num font-display text-xl">{eur(list.reduce((a, e) => a + e.amount, 0))}</p>
                </div>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="saldo" className="mt-4">
          <div className="rounded-2xl border bg-card">
            <p className="border-b px-5 py-3 text-sm text-muted-foreground">Saldo dal punto di vista di Mattia: positivo = Giulia deve a Mattia.</p>
            <ul className="divide-y">
              {timeline.map((ev) => (
                <li key={ev.id} className="flex items-center gap-4 px-5 py-3 text-sm">
                  <span className="w-16 text-muted-foreground">{dateLabel(ev.date)}</span>
                  <span className="flex-1">{ev.label} {ev.type !== "spesa" && <Badge variant="outline" className="ml-1 capitalize">{ev.type}</Badge>}</span>
                  <span className={`num w-24 text-right ${ev.delta >= 0 ? "text-positive" : "text-negative"}`}>{ev.delta >= 0 ? "+" : ""}{eur(ev.delta)}</span>
                  <span className="num w-28 text-right font-semibold">{eur(ev.balance)}</span>
                </li>
              ))}
            </ul>
          </div>
        </TabsContent>

        <TabsContent value="rimborsi" className="mt-4 space-y-3">
          {filteredSettlements.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-4 rounded-xl border bg-card px-5 py-4">
              <Badge className={s.kind === "pareggio" ? "bg-primary" : "bg-transfer"}>{s.kind === "pareggio" ? "Pareggio" : "Rimborso"}</Badge>
              <div className="flex items-center gap-2 text-sm"><Avatar id={s.from} /><ArrowRight className="h-4 w-4 text-muted-foreground" /><Avatar id={s.to} /></div>
              <div className="flex-1 text-sm"><p className="font-medium">{s.note}</p><p className="text-xs text-muted-foreground">{new Date(s.date).toLocaleDateString("it-IT")}</p></div>
              <p className="num font-display text-xl">{eur(s.amount)}</p>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">I rimborsi compensano il saldo: non sono registrati come reddito né come nuova spesa condivisa.</p>
        </TabsContent>
      </Tabs>

      <SplitDialog
        expense={editing}
        onClose={() => setEditing(null)}
        onSave={(u) => { setExpenses((xs) => xs.map((x) => (x.id === u.id ? u : x))); setEditing(null); }}
      />
    </div>
  );
}

function SplitDialog({ expense, onClose, onSave }: { expense: SharedExpense | null; onClose: () => void; onSave: (e: SharedExpense) => void }) {
  const [pct, setPct] = useState(50);
  const [key, setKey] = useState<string | null>(null);
  if (expense && key !== expense.id) {
    setKey(expense.id);
    setPct(Math.round(((expense.shares.find((s) => s.memberId === "m1")?.amount ?? 0) / expense.amount) * 100));
  }
  if (!expense) return null;
  const a = Math.round(expense.amount * pct) / 100;
  const b = Math.round((expense.amount - a) * 100) / 100;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">Quote · {expense.description}</DialogTitle>
          <DialogDescription>{eur(expense.amount)} pagati da {memberName(expense.paidBy)}. Predefinito: 50 / 50.</DialogDescription>
        </DialogHeader>
        <div className="space-y-6 py-2">
          <Slider value={[pct]} min={0} max={100} step={5} onValueChange={([v]) => setPct(v)} />
          <div className="grid grid-cols-2 gap-4">
            {[["m1", pct, a], ["m2", 100 - pct, b]].map(([id, p, v]) => (
              <div key={id as string} className="rounded-xl border p-4">
                <div className="flex items-center gap-2"><Avatar id={id as string} /><Label>{memberName(id as string)}</Label></div>
                <Input
                  type="number" className="num mt-3" value={p as number} min={0} max={100}
                  onChange={(ev) => { const n = Math.max(0, Math.min(100, Number(ev.target.value))); setPct(id === "m1" ? n : 100 - n); }}
                />
                <p className="num mt-2 text-sm text-muted-foreground">{eur(v as number)}</p>
              </div>
            ))}
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setPct(50)}>Ripristina 50 / 50</Button>
          <Button
            onClick={() =>
              onSave({
                ...expense,
                splitMode: pct === 50 ? "equal" : "percent",
                shares: pct === 50 ? equalShares(expense.amount, ["m1", "m2"]) : [{ memberId: "m1", amount: a }, { memberId: "m2", amount: b }],
              })
            }
          >
            Salva quote
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
