import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type SpaceRole = Database["public"]["Enums"]["space_role"];
export const roleLabel: Record<SpaceRole, string> = {
  owner: "Proprietario",
  member: "Membro",
  viewer: "Sola lettura",
};

/** Spazi visibili all'utente: la RLS restituisce solo quelli di cui è membro. */
export const spacesQuery = queryOptions({
  queryKey: ["spaces"],
  queryFn: async () => {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    const [
      { data: spaces, error: e1 },
      { data: members, error: e2 },
      { data: profiles, error: e3 },
      { data: invites, error: e4 },
    ] = await Promise.all([
      supabase.from("spaces").select("*").is("archived_at", null).order("kind").order("created_at"),
      supabase.from("space_memberships").select("*"),
      supabase.from("profiles").select("id, display_name"),
      supabase.from("space_invitations").select("*").eq("status", "pending"),
    ]);
    const err = e1 ?? e2 ?? e3 ?? e4;
    if (err) throw err;
    const name = (id: string) => profiles?.find((p) => p.id === id)?.display_name || "Utente";
    const email = auth.user?.email?.toLowerCase() ?? "";
    return {
      uid,
      spaces: (spaces ?? []).map((s) => {
        const ms = (members ?? [])
          .filter((m) => m.space_id === s.id)
          .map((m) => ({ ...m, name: name(m.user_id) }));
        return {
          ...s,
          members: ms,
          myRole: ms.find((m) => m.user_id === uid)?.role,
          invitations: (invites ?? []).filter((i) => i.space_id === s.id),
        };
      }),
      myInvitations: (invites ?? []).filter((i) => i.email === email),
    };
  },
});
