import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowRight, Link2, Repeat, ShieldCheck, Handshake, Trash2 } from "lucide-react";
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
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { dateFull, dateShort as dateLabel, equalShares, eur, monthLabel, monthShort, netBalances, outstandingDebt, validateSettlement, type Settlement, type SharedExpense } from "@/lib/domain";
import { categories, memberName, members, settlements as demoSettlements, sharedExpenses } from "@/lib/mock-data";

export const Route = createFileRoute("/_authenticated/spese-condivise")({
  head: () => ({
    meta: [
      { title: "Spese condivise — Fondo" },
      { name: "description", content: "Spese comuni, quote, saldo e rimborsi tra partecipanti (dati dimostrativi)." },
      { property: "og:title", content: "Spese condivise — Fondo" },
      { property: "og:description", content: "Spese comuni, quote, saldo e rimborsi tra partecipanti." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SharedPage,
});

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
  const [settlements, setSettlements] = useState<Settlement[]>(demoSettlements);
  const [period, setPeriod] = useState("all");
  const [category, setCategory] = useState("all");
  const [person, setPerson] = useState("all");
  const [editing, setEditing] = useState<SharedExpense | null>(null);
  const [settling, setSettling] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const months = useMemo(() => [...new Set(expenses.map((e) => e.date.slice(0, 7)))].sort().reverse(), [expenses]);

  const filtered = expenses.filter(
    (e) =>
      (period === "all" || e.date.startsWith(period)) &&
      (category === "all" || e.category === category) &&
      (person === "all" || e.paidBy === person),
  );
  const filteredSettlements = settlements.filter(
    (s) => (period === "all" || s.date.startsWith(period)) && (person === "all" || s.from === person || s.to === person),
  ).sort((x, y) => y.date.localeCompare(x.date));

  const balances = netBalances(expenses, settlements);
  const creditor = members.find((m) => (balances[m.id] ?? 0) > 0);
  const debtor = members.find((m) => (balances[m.id] ?? 0) < 0);
  const owed = creditor ? balances[creditor.id] : 0;
  const removeTarget = settlements.find((s) => s.id === removing);

  const monthly = [...months].reverse().map((ym) => {
    const list = expenses.filter((e) => e.date.startsWith(ym));
    const row: Record<string, number | string> = { mese: monthShort(ym) };
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
  }, [expenses, settlements]);

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
              <p className="num mt-2 font-display text-4xl">{eur(owed ?? 0)}</p>
              <p className="mt-3 flex items-center gap-2 text-sm">
                <strong>{debtor.name}</strong> <ArrowRight className="h-4 w-4" /> <strong>{creditor.name}</strong>
              </p>
            </>
          ) : (
            <>
              <p className="mt-2 font-display text-3xl">In pari</p>
              <p className="mt-3 text-sm opacity-80">Non ci sono debiti da regolare.</p>
            </>
          )}
          <Button variant="secondary" size="sm" className="mt-5" disabled={!creditor || !debtor} onClick={() => setSettling(true)}><Handshake className="h-4 w-4" />Registra pareggio</Button>
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
          <SelectTrigger className="w-44 bg-card"><SelectValue>{period === "all" ? "Tutti i periodi" : monthLabel(period)}</SelectValue></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tutti i periodi</SelectItem>
            {months.map((m) => <SelectItem key={m} value={m}>{monthLabel(m)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-44 bg-card"><SelectValue>{category === "all" ? "Tutte le categorie" : category}</SelectValue></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tutte le categorie</SelectItem>
            {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={person} onValueChange={setPerson}>
          <SelectTrigger className="w-44 bg-card"><SelectValue>{person === "all" ? "Tutti i partecipanti" : memberName(person)}</SelectValue></SelectTrigger>
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
                  <div><p className="font-medium">{monthLabel(ym)}</p><p className="text-xs text-muted-foreground">{list.length} spese</p></div>
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
                  <span className="flex-1">{ev.label} {ev.type !== "spesa" && <Badge variant="outline" className="ml-1">{ev.type}</Badge>}</span>
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
              <div className="flex-1 text-sm"><p className="font-medium">{memberName(s.from)} ha pagato {memberName(s.to)}{s.note ? ` · ${s.note}` : ""}</p><p className="text-xs text-muted-foreground">{dateFull(s.date)}</p></div>
              <p className="num font-display text-xl">{eur(s.amount)}</p>
              <Button variant="ghost" size="icon" aria-label={`Elimina rimborso del ${dateFull(s.date)}`} onClick={() => setRemoving(s.id)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          {filteredSettlements.length === 0 && <p className="rounded-xl border bg-card px-5 py-4 text-sm text-muted-foreground">Nessun rimborso nel periodo selezionato.</p>}
          <p className="text-xs text-muted-foreground">I rimborsi compensano il saldo: non sono registrati come reddito né come nuova spesa condivisa.</p>
        </TabsContent>
      </Tabs>

      {editing && <SplitDialog
        key={editing.id}
        expense={editing}
        onClose={() => setEditing(null)}
        onSave={(u) => { setExpenses((xs) => xs.map((x) => (x.id === u.id ? u : x))); setEditing(null); }}
      />}

      {settling && <SettlementDialog
        balances={balances}
        defaultFrom={debtor?.id ?? "m2"}
        defaultTo={creditor?.id ?? "m1"}
        onClose={() => setSettling(false)}
        onSave={(s) => { setSettlements((xs) => [...xs, s]); setSettling(false); }}
      />}

      <AlertDialog open={!!removeTarget} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Eliminare questo rimborso?</AlertDialogTitle>
            <AlertDialogDescription>
              {removeTarget && `${memberName(removeTarget.from)} → ${memberName(removeTarget.to)}, ${eur(removeTarget.amount)} del ${dateFull(removeTarget.date)}. Il saldo tornerà al valore precedente.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setSettlements((xs) => xs.filter((x) => x.id !== removing)); setRemoving(null); }}>Elimina rimborso</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function SettlementDialog({ balances, defaultFrom, defaultTo, onClose, onSave }: {
  balances: Record<string, number>; defaultFrom: string; defaultTo: string; onClose: () => void; onSave: (s: Settlement) => void;
}) {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const debt = outstandingDebt(balances, from, to);
  const [amount, setAmount] = useState(debt ? debt.toFixed(2) : "");
  const [date, setDate] = useState("2026-10-28");
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);
  const value = Number(amount.replace(",", "."));
  const error = validateSettlement(balances, { from, to, amount: amount.trim() === "" ? NaN : value, date });
  const submit = () => {
    setTouched(true);
    if (error) return;
    const full = Math.round(value * 100) === Math.round(debt * 100);
    onSave({ id: `s-${Date.now()}`, spaceId: "s-casa", date, from, to, amount: Math.round(value * 100) / 100,
      kind: full ? "pareggio" : "rimborso", ...(note.trim() ? { note: note.trim() } : {}) });
  };
  const swap = (setter: (v: string) => void, other: (v: string) => void) => (v: string) => { setter(v); other(members.find((m) => m.id !== v)!.id); };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">Registra rimborso</DialogTitle>
          <DialogDescription>Debito residuo: {debt ? `${memberName(from)} deve ${eur(debt)} a ${memberName(to)}` : "nessun debito in questa direzione"}. Non viene registrato come entrata né come spesa.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2 sm:grid-cols-2">
          <div className="space-y-1.5"><Label>Chi paga</Label>
            <Select value={from} onValueChange={swap(setFrom, setTo)}><SelectTrigger aria-label="Chi paga"><SelectValue /></SelectTrigger>
              <SelectContent>{members.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="space-y-1.5"><Label>Chi riceve</Label>
            <Select value={to} onValueChange={swap(setTo, setFrom)}><SelectTrigger aria-label="Chi riceve"><SelectValue /></SelectTrigger>
              <SelectContent>{members.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="space-y-1.5"><Label htmlFor="st-amount">Importo (€)</Label>
            <Input id="st-amount" inputMode="decimal" className="num" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-1.5"><Label htmlFor="st-date">Data</Label>
            <Input id="st-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="st-note">Descrizione (facoltativa)</Label>
            <Input id="st-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {touched && error && <p role="alert" className="text-sm text-negative sm:col-span-2">{error}</p>}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Annulla</Button>
          <Button onClick={submit}>Registra rimborso</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SplitDialog({ expense, onClose, onSave }: { expense: SharedExpense; onClose: () => void; onSave: (e: SharedExpense) => void }) {
  const originalA = expense.shares.find((s) => s.memberId === "m1")?.amount ?? 0;
  const [pct, setPct] = useState(expense.amount > 0 ? originalA / expense.amount * 100 : 50);
  const [changed, setChanged] = useState(false);
  const updatePct = (value: number) => {
    if (!Number.isFinite(value)) return;
    setPct(Math.max(0, Math.min(100, value)));
    setChanged(true);
  };
  const defaultShares = equalShares(expense.amount, ["m1", "m2"]);
  const a = !changed ? originalA : pct === 50 ? (defaultShares[0]?.amount ?? 0) : Math.round(expense.amount * pct) / 100;
  const b = Math.round((expense.amount - a) * 100) / 100;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">Quote · {expense.description}</DialogTitle>
          <DialogDescription>{eur(expense.amount)} pagati da {memberName(expense.paidBy)}. Predefinito: 50 / 50.</DialogDescription>
        </DialogHeader>
        <div className="space-y-6 py-2">
          <Slider value={[pct]} min={0} max={100} step={5} onValueChange={([v]) => updatePct(v ?? 50)} />
          <div className="grid grid-cols-2 gap-4">
            {[["m1", pct, a], ["m2", 100 - pct, b]].map(([id, p, v]) => (
              <div key={id as string} className="rounded-xl border p-4">
                <div className="flex items-center gap-2"><Avatar id={id as string} /><Label>{memberName(id as string)}</Label></div>
                <Input
                  type="number" aria-label={`Quota percentuale ${memberName(id as string)}`} step="any" className="num mt-3" value={p as number} min={0} max={100}
                  onChange={(ev) => { const n = Math.max(0, Math.min(100, Number(ev.target.value))); updatePct(id === "m1" ? n : 100 - n); }}
                />
                <p className="num mt-2 text-sm text-muted-foreground">{eur(v as number)}</p>
              </div>
            ))}
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => updatePct(50)}>Ripristina 50 / 50</Button>
          <Button
            onClick={() =>
              onSave({
                ...expense,
                splitMode: !changed ? expense.splitMode : pct === 50 ? "equal" : "percent",
                shares: !changed ? expense.shares : pct === 50 ? defaultShares : [{ memberId: "m1", amount: a }, { memberId: "m2", amount: b }],
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
