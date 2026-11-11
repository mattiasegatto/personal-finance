import {
  equalShares,
  type Member,
  type Settlement,
  type SharedExpense,
  type Space,
  type SpaceMembership,
  type Transaction,
} from "./domain";

// Dati interamente fittizi.
export const members: Member[] = [
  { id: "m1", name: "Mattia", initials: "MA" },
  { id: "m2", name: "Giulia", initials: "GI" },
];
export const currentMemberId = "m1";

export const spaces: Space[] = [
  { id: "p-m1", kind: "personal", name: "Finanze di Mattia" },
  { id: "p-m2", kind: "personal", name: "Finanze di Giulia" },
  { id: "s-casa", kind: "shared", name: "Casa" },
];

export const memberships: SpaceMembership[] = [
  { spaceId: "p-m1", memberId: "m1", role: "owner" },
  { spaceId: "p-m2", memberId: "m2", role: "owner" },
  { spaceId: "s-casa", memberId: "m1", role: "owner" },
  { spaceId: "s-casa", memberId: "m2", role: "member" },
];

export const transactions: Transaction[] = [
  {
    id: "t1",
    spaceId: "p-m1",
    date: "2026-10-26",
    description: "Esselunga",
    amount: -86.4,
    account: "Conto Demo A",
  },
  {
    id: "t2",
    spaceId: "p-m1",
    date: "2026-10-01",
    description: "Bonifico affitto",
    amount: -950,
    account: "Conto Demo A",
  },
  {
    id: "t3",
    spaceId: "p-m1",
    date: "2026-10-15",
    description: "Stipendio (demo)",
    amount: 2400,
    account: "Conto Demo A",
  },
  {
    id: "t4",
    spaceId: "p-m1",
    date: "2026-10-20",
    description: "Ristorante Da Nino",
    amount: -64,
    account: "Carta Demo",
  },
  {
    id: "t5",
    spaceId: "p-m1",
    date: "2026-10-22",
    description: "Benzina",
    amount: -55,
    account: "Carta Demo",
  },
];

export const categories = [
  "Spesa",
  "Casa",
  "Bollette",
  "Ristoranti",
  "Viaggi",
  "Svago",
  "Trasporti",
];

const both = ["m1", "m2"];
const exp = (
  id: string,
  date: string,
  description: string,
  category: string,
  amount: number,
  paidBy: string,
  extra: Partial<SharedExpense> = {},
): SharedExpense => ({
  id,
  spaceId: "s-casa",
  date,
  description,
  category,
  amount,
  paidBy,
  splitMode: "equal",
  shares: equalShares(amount, both),
  ...extra,
});

export const sharedExpenses: SharedExpense[] = [
  exp("e1", "2026-10-26", "Spesa settimanale", "Spesa", 86.4, "m1", { linkedTransactionId: "t1" }),
  exp("e2", "2026-10-22", "Bolletta luce", "Bollette", 72.3, "m2"),
  exp("e3", "2026-10-20", "Cena Da Nino", "Ristoranti", 64, "m1", {
    linkedTransactionId: "t4",
    splitMode: "amount",
    shares: [
      { memberId: "m1", amount: 24 },
      { memberId: "m2", amount: 40 },
    ],
  }),
  exp("e4", "2026-10-12", "Cinema", "Svago", 22, "m2"),
  exp("e5", "2026-10-01", "Affitto ottobre", "Casa", 950, "m1", {
    linkedTransactionId: "t2",
    recurrenceId: "r-affitto",
    splitMode: "percent",
    shares: [
      { memberId: "m1", amount: 570 },
      { memberId: "m2", amount: 380 },
    ],
  }),
  exp("e6", "2026-09-28", "Weekend a Verona", "Viaggi", 340, "m2"),
  exp("e7", "2026-09-18", "Spesa mensile", "Spesa", 132.8, "m1"),
  exp("e8", "2026-09-10", "Internet fibra", "Bollette", 29.9, "m2", { recurrenceId: "r-internet" }),
  exp("e9", "2026-09-01", "Affitto settembre", "Casa", 950, "m1", {
    recurrenceId: "r-affitto",
    splitMode: "percent",
    shares: [
      { memberId: "m1", amount: 570 },
      { memberId: "m2", amount: 380 },
    ],
  }),
  exp("e10", "2026-08-21", "Treno Milano", "Trasporti", 48, "m2"),
  exp("e11", "2026-08-14", "Spesa Ferragosto", "Spesa", 96.5, "m1"),
  exp("e12", "2026-08-01", "Affitto agosto", "Casa", 950, "m1", {
    recurrenceId: "r-affitto",
    splitMode: "percent",
    shares: [
      { memberId: "m1", amount: 570 },
      { memberId: "m2", amount: 380 },
    ],
  }),
];

export const settlements: Settlement[] = [
  {
    id: "s1",
    spaceId: "s-casa",
    date: "2026-10-05",
    from: "m2",
    to: "m1",
    amount: 300,
    kind: "rimborso",
    note: "Acconto affitto",
  },
  {
    id: "s2",
    spaceId: "s-casa",
    date: "2026-09-30",
    from: "m2",
    to: "m1",
    amount: 286.5,
    kind: "pareggio",
    note: "Pareggio di settembre",
  },
  {
    id: "s3",
    spaceId: "s-casa",
    date: "2026-08-31",
    from: "m2",
    to: "m1",
    amount: 404.25,
    kind: "pareggio",
    note: "Pareggio di agosto",
  },
];

export const memberName = (id: string) => members.find((m) => m.id === id)?.name ?? id;
