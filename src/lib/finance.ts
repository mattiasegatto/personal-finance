import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type E = Database["public"]["Enums"];
export type AccountType = E["account_type"];
export type CategoryKind = E["category_kind"];
export type Direction = E["tx_direction"];

export const accountTypeLabel: Record<AccountType, string> = {
  checking: "Conto corrente",
  savings: "Conto deposito",
  card: "Carta",
  cash: "Contanti",
  other: "Altro",
};
export const kindLabel: Record<CategoryKind, string> = { income: "Entrate", expense: "Spese" };

/** Data corrente nel fuso locale, nel formato richiesto dai campi date (YYYY-MM-DD). */
export function localDateISO(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Converte "12,34", "1.250,00", "2.000" o "12.34" in centesimi interi; null se non valido.
 * Senza virgola, i punti seguiti da gruppi di tre cifre ("2.000", "1.250.000") sono
 * separatori delle migliaia; altrimenti il punto è il separatore decimale ("12.5").
 */
export function parseCents(input: string, allowNegative = false): number | null {
  let s = input.trim().replace(/\s|€/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  const c = Math.round(Number(s) * 100);
  if (!allowNegative && c < 0) return null;
  return c;
}
export const centsToInput = (c: number) => (c / 100).toFixed(2).replace(".", ",");

export const errMsg = (e: unknown) =>
  e instanceof Error
    ? e.message
    : ((e as { message?: string })?.message ?? "Operazione non riuscita");

async function personalSpaceId() {
  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("spaces")
    .select("id")
    .eq("kind", "personal")
    .eq("created_by", auth.user!.id)
    .single();
  if (error) throw error;
  return data.id;
}

type CategoryNode = { id: string; parent_id: string | null; archived_at: string | null };

/**
 * Una categoria è utilizzabile per nuovi movimenti, ricorrenze e scadenze solo se né lei
 * né la categoria padre sono archiviate (il database rifiuta comunque gli altri casi).
 */
export function isCategoryUsable(
  category: CategoryNode,
  byId: ReadonlyMap<string, CategoryNode>,
): boolean {
  if (category.archived_at) return false;
  const parent = category.parent_id ? byId.get(category.parent_id) : undefined;
  return !parent?.archived_at;
}

/**
 * Categorie attive selezionabili, con etichetta "Padre › Figlia" e ordinate per etichetta.
 * Riceve solo categorie non archiviate: una figlia il cui padre manca (archiviato) è esclusa.
 */
export function selectableCategories<
  T extends { id: string; name: string; parent_id: string | null },
>(active: readonly T[]): (T & { label: string })[] {
  const byId = new Map(active.map((c) => [c.id, c]));
  return active
    .filter((c) => !c.parent_id || byId.has(c.parent_id))
    .map((c) => {
      const parent = c.parent_id ? byId.get(c.parent_id) : undefined;
      return { ...c, label: parent ? `${parent.name} › ${c.name}` : c.name };
    })
    .sort((a, b) => a.label.localeCompare(b.label, "it"));
}

/** Dati finanziari dello spazio personale: la RLS restituisce solo ciò che appartiene all'utente. */
export const financeQuery = queryOptions({
  queryKey: ["finance"],
  queryFn: async () => {
    const spaceId = await personalSpaceId();
    const [a, b, c, t, tr, i, d] = await Promise.all([
      supabase.from("accounts").select("*").eq("space_id", spaceId).order("created_at"),
      supabase.from("account_balances").select("*").eq("space_id", spaceId),
      supabase.from("categories").select("*").eq("space_id", spaceId).order("name"),
      supabase
        .from("transactions")
        .select("*")
        .eq("space_id", spaceId)
        .is("deleted_at", null)
        .order("occurred_on", { ascending: false })
        .order("created_at", { ascending: false }),
      supabase
        .from("transfers")
        .select("*")
        .eq("space_id", spaceId)
        .is("deleted_at", null)
        .order("occurred_on", { ascending: false })
        .order("created_at", { ascending: false }),
      supabase.from("investments").select("*").eq("space_id", spaceId).order("name"),
      supabase.from("financial_debts").select("*").eq("space_id", spaceId).order("name"),
    ]);
    const err = a.error ?? b.error ?? c.error ?? t.error ?? tr.error ?? i.error ?? d.error;
    if (err) throw err;
    const bal = new Map((b.data ?? []).map((r) => [r.account_id, Number(r.balance_cents ?? 0)]));
    const categories = c.data ?? [];
    const byId = new Map(categories.map((x) => [x.id, x]));
    const catLabel = (id: string) => {
      const x = byId.get(id);
      if (!x) return "—";
      const p = x.parent_id ? byId.get(x.parent_id) : undefined;
      return p ? `${p.name} › ${x.name}` : x.name;
    };
    const rootKind = (id: string): CategoryKind | null => {
      const x = byId.get(id);
      if (!x) return null;
      return x.kind ?? (x.parent_id ? (byId.get(x.parent_id)?.kind ?? null) : null);
    };
    return {
      spaceId,
      accounts: (a.data ?? []).map((x) => ({
        ...x,
        initial_balance_cents: Number(x.initial_balance_cents),
        balance_cents: bal.get(x.id) ?? Number(x.initial_balance_cents),
      })),
      categories: categories.map((x) => ({
        ...x,
        label: catLabel(x.id),
        rootKind: rootKind(x.id),
        usable: isCategoryUsable(x, byId),
      })),
      transactions: (t.data ?? []).map((x) => ({
        ...x,
        amount_cents: Number(x.amount_cents),
        categoryLabel: x.category_id ? catLabel(x.category_id) : "—",
      })),
      transfers: (tr.data ?? []).map((x) => ({
        ...x,
        amount_cents: Number(x.amount_cents),
      })),
      investments: (i.data ?? []).map((x) => ({
        ...x,
        invested_amount_cents: Number(x.invested_amount_cents),
        current_value_cents: Number(x.current_value_cents),
        quantity: x.quantity === null ? null : Number(x.quantity),
      })),
      debts: (d.data ?? []).map((x) => ({
        ...x,
        original_principal_cents: Number(x.original_principal_cents),
        outstanding_balance_cents: Number(x.outstanding_balance_cents),
        monthly_payment_cents:
          x.monthly_payment_cents === null ? null : Number(x.monthly_payment_cents),
        annual_interest_rate:
          x.annual_interest_rate === null ? null : Number(x.annual_interest_rate),
      })),
    };
  },
});
