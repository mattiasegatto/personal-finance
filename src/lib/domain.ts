/**
 * Modello di dominio (prototipo). Nessuna persistenza: solo tipi e struttura.
 *
 * Principi:
 * - Ogni dato appartiene a uno Space (personale o condiviso). L'accesso passa
 *   sempre da SpaceMembership: essere membri di uno spazio condiviso NON dà
 *   accesso agli spazi personali degli altri membri.
 * - I movimenti bancari (Transaction) vivono solo negli spazi personali.
 *   Una SharedExpense può *riferirsi* a un movimento tramite linkedTransactionId,
 *   senza duplicarlo.
 * - Un Settlement (rimborso/pareggio) sposta debiti tra membri: non è reddito
 *   né nuova spesa condivisa.
 * - Le quote (shares) sono una lista per membro: supporta N partecipanti e
 *   quote variabili. recurrenceId prepara le spese ricorrenti.
 */

export type SpaceKind = "personal" | "shared";
export type Role = "owner" | "member" | "viewer";

export interface Member {
  id: string;
  name: string;
  initials: string;
}

export interface Space {
  id: string;
  kind: SpaceKind;
  name: string;
}

export interface SpaceMembership {
  spaceId: string;
  memberId: string;
  role: Role;
}

/** Movimento bancario, sempre in uno spazio personale. */
export interface Transaction {
  id: string;
  spaceId: string;
  date: string;
  description: string;
  amount: number; // negativo = uscita
  account: string;
}

export type SplitMode = "equal" | "percent" | "amount";

export interface Share {
  memberId: string;
  amount: number; // quota in euro dovuta dal membro
}

export interface SharedExpense {
  id: string;
  spaceId: string;
  date: string;
  description: string;
  category: string;
  amount: number;
  paidBy: string;
  splitMode: SplitMode;
  shares: Share[];
  /** Riferimento al movimento personale del pagatore (nessuna duplicazione). */
  linkedTransactionId?: string;
  recurrenceId?: string;
}

export type SettlementKind = "rimborso" | "pareggio";

export interface Settlement {
  id: string;
  spaceId: string;
  date: string;
  from: string;
  to: string;
  amount: number;
  kind: SettlementKind;
  note?: string;
  linkedTransactionId?: string;
}

/** Spazi visibili a un membro: solo quelli di cui è membro. */
export function visibleSpaces(memberId: string, spaces: Space[], memberships: SpaceMembership[]) {
  const ids = new Set(memberships.filter((m) => m.memberId === memberId).map((m) => m.spaceId));
  return spaces.filter((s) => ids.has(s.id));
}

export function equalShares(amount: number, memberIds: string[]): Share[] {
  const cents = Math.round(amount * 100);
  const base = Math.floor(cents / memberIds.length);
  let rest = cents - base * memberIds.length;
  return memberIds.map((memberId) => {
    const c = base + (rest-- > 0 ? 1 : 0);
    return { memberId, amount: c / 100 };
  });
}

/**
 * Saldo netto per membro (dimostrativo). Positivo = deve ricevere.
 * Spesa: il pagatore riceve credito per l'importo, ogni membro addebita la sua quota.
 * Rimborso: chi paga riduce il proprio debito; non tocca le spese.
 */
export function netBalances(expenses: SharedExpense[], settlements: Settlement[]) {
  const bal: Record<string, number> = {};
  const add = (id: string, v: number) => (bal[id] = Math.round(((bal[id] ?? 0) + v) * 100) / 100);
  for (const e of expenses) {
    add(e.paidBy, e.amount);
    for (const s of e.shares) add(s.memberId, -s.amount);
  }
  for (const s of settlements) {
    add(s.from, s.amount);
    add(s.to, -s.amount);
  }
  return bal;
}

/** Formattazione deterministica (uguale su server e browser). */
export const eur = (v: number) => {
  const [i, d] = Math.abs(v).toFixed(2).split(".");
  return `${v < 0 ? "-" : ""}${i!.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${d} €`;
};
const MESI = ["gennaio","febbraio","marzo","aprile","maggio","giugno","luglio","agosto","settembre","ottobre","novembre","dicembre"];
export const monthLabel = (ym: string) => { const [y, m] = ym.split("-"); const n = MESI[Number(m) - 1]!; return `${n[0]!.toUpperCase()}${n.slice(1)} ${y}`; };
export const monthShort = (ym: string) => MESI[Number(ym.slice(5, 7)) - 1]!.slice(0, 3);
export const dateShort = (d: string) => `${d.slice(8, 10)} ${monthShort(d)}`;
export const dateFull = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

/** Debito residuo che `from` ha verso `to` (0 se non deve nulla). Solo due partecipanti. */
export function outstandingDebt(balances: Record<string, number>, from: string, to: string) {
  const f = balances[from] ?? 0, t = balances[to] ?? 0;
  return f < 0 && t > 0 ? Math.min(-f, t) : 0;
}

/** Valida un rimborso: importo positivo e non superiore al debito residuo (nessun eccedente). */
export function validateSettlement(balances: Record<string, number>, s: { from: string; to: string; amount: number; date: string }): string | null {
  if (s.from === s.to) return "Chi paga e chi riceve devono essere diversi.";
  if (!s.date) return "Indica la data.";
  if (!Number.isFinite(s.amount) || Math.round(s.amount * 100) <= 0) return "L'importo deve essere maggiore di zero.";
  if (Math.abs(s.amount * 100 - Math.round(s.amount * 100)) > 1e-6) return "Usa al massimo due decimali.";
  const debt = outstandingDebt(balances, s.from, s.to);
  if (debt === 0) return "Non ci sono debiti da regolare in questa direzione.";
  if (Math.round(s.amount * 100) > Math.round(debt * 100)) return `L'importo supera il debito residuo (${eur(debt)}).`;
  return null;
}
