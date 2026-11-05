import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type E = Database["public"]["Enums"];
export type AccountType = E["account_type"];
export type CategoryKind = E["category_kind"];
export type Direction = E["tx_direction"];

export const accountTypeLabel: Record<AccountType, string> = {
  checking: "Conto corrente", savings: "Conto deposito", card: "Carta", cash: "Contanti", other: "Altro",
};
export const kindLabel: Record<CategoryKind, string> = { income: "Entrate", expense: "Spese" };

/** Converte "12,34" o "12.34" in centesimi interi; null se non valido. */
export function parseCents(input: string, allowNegative = false): number | null {
  const s = input.trim().replace(/\s/g, "").replace(/\./g, (m, i, str) => (str.includes(",") ? "" : m)).replace(",", ".");
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  const c = Math.round(Number(s) * 100);
  if (!allowNegative && c < 0) return null;
  return c;
}
export const centsToInput = (c: number) => (c / 100).toFixed(2).replace(".", ",");

export const errMsg = (e: unknown) =>
  e instanceof Error ? e.message : ((e as { message?: string })?.message ?? "Operazione non riuscita");

async function personalSpaceId() {
  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase.from("spaces").select("id").eq("kind", "personal").eq("created_by", auth.user!.id).single();
  if (error) throw error;
  return data.id;
}

/** Dati finanziari dello spazio personale: la RLS restituisce solo ciò che appartiene all'utente. */
export const financeQuery = queryOptions({
  queryKey: ["finance"],
  queryFn: async () => {
    const spaceId = await personalSpaceId();
    const [a, b, c, t] = await Promise.all([
      supabase.from("accounts").select("*").eq("space_id", spaceId).order("created_at"),
      supabase.from("account_balances").select("*").eq("space_id", spaceId),
      supabase.from("categories").select("*").eq("space_id", spaceId).order("name"),
      supabase.from("transactions").select("*").eq("space_id", spaceId).is("deleted_at", null)
        .order("occurred_on", { ascending: false }).order("created_at", { ascending: false }),
    ]);
    const err = a.error ?? b.error ?? c.error ?? t.error;
    if (err) throw err;
    const bal = new Map((b.data ?? []).map((r) => [r.account_id, Number(r.balance_cents ?? 0)]));
    const categories = c.data ?? [];
    const byId = new Map(categories.map((x) => [x.id, x]));
    const catLabel = (id: string) => {
      const x = byId.get(id); if (!x) return "—";
      const p = x.parent_id ? byId.get(x.parent_id) : undefined;
      return p ? `${p.name} › ${x.name}` : x.name;
    };
    const rootKind = (id: string): CategoryKind | null => {
      const x = byId.get(id); if (!x) return null;
      return x.kind ?? (x.parent_id ? byId.get(x.parent_id)?.kind ?? null : null);
    };
    return {
      spaceId,
      accounts: (a.data ?? []).map((x) => ({ ...x, initial_balance_cents: Number(x.initial_balance_cents), balance_cents: bal.get(x.id) ?? Number(x.initial_balance_cents) })),
      categories: categories.map((x) => ({ ...x, label: catLabel(x.id), rootKind: rootKind(x.id) })),
      transactions: (t.data ?? []).map((x) => ({ ...x, amount_cents: Number(x.amount_cents), categoryLabel: catLabel(x.category_id) })),
    };
  },
});
