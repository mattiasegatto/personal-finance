import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Lock, Users, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { roleLabel, spacesQuery, type SpaceRole } from "@/lib/spaces";

export const Route = createFileRoute("/_authenticated/impostazioni")({
  head: () => ({
    meta: [
      { title: "Impostazioni e spazi — Fondo" },
      { name: "description", content: "Gestisci il tuo spazio personale e gli spazi condivisi." },
      { property: "og:title", content: "Impostazioni e spazi — Fondo" },
      { property: "og:description", content: "Gestisci il tuo spazio personale e gli spazi condivisi." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(spacesQuery),
  component: Settings,
});

const msg = (e: unknown) => (e instanceof Error ? e.message : (e as { message?: string })?.message ?? "Operazione non riuscita");

function Settings() {
  const { data } = useSuspenseQuery(spacesQuery);
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["spaces"] });
  const run = (fn: () => PromiseLike<{ error: unknown }>, ok: string) => async () => {
    const { error } = await fn();
    if (error) toast.error(msg(error)); else { toast.success(ok); refresh(); }
  };

  const [newName, setNewName] = useState("");
  const create = useMutation({
    mutationFn: async (name: string) => { const { error } = await supabase.rpc("create_shared_space", { _name: name }); if (error) throw error; },
    onSuccess: () => { setNewName(""); toast.success("Spazio condiviso creato"); refresh(); },
    onError: (e) => toast.error(msg(e)),
  });

  return (
    <div>
      <PageHeader eyebrow="Account" title="Impostazioni e spazi" />

      {data.myInvitations.length > 0 && (
        <section className="mb-6 rounded-2xl border bg-accent p-5">
          <h2 className="text-lg">Inviti ricevuti</h2>
          <ul className="mt-3 space-y-2">
            {data.myInvitations.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 text-sm">
                <span>Invito come {roleLabel[i.role].toLowerCase()} a uno spazio condiviso</span>
                <Button size="sm" onClick={run(() => supabase.rpc("accept_invitation", { _invitation: i.id }), "Invito accettato")}>Accetta</Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {data.spaces.map((s) => <SpaceCard key={s.id} space={s} uid={data.uid} run={run} />)}

        <form
          onSubmit={(e: FormEvent) => { e.preventDefault(); if (newName.trim()) create.mutate(newName.trim()); }}
          className="rounded-2xl border border-dashed bg-card p-6"
        >
          <h2 className="text-lg">Nuovo spazio condiviso</h2>
          <p className="mt-1 text-sm text-muted-foreground">Gli altri membri vedranno solo i dati di questo spazio, mai quelli personali.</p>
          <div className="mt-4 flex gap-2">
            <Input aria-label="Nome del nuovo spazio" placeholder="Es. Casa" value={newName} maxLength={80} onChange={(e) => setNewName(e.target.value)} />
            <Button type="submit" disabled={create.isPending || !newName.trim()}>Crea</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

type SpaceView = Awaited<ReturnType<NonNullable<typeof spacesQuery.queryFn>>>["spaces"][number];

function SpaceCard({ space: s, uid, run }: {
  space: SpaceView; uid?: string;
  run: (fn: () => PromiseLike<{ error: unknown }>, ok: string) => () => Promise<void>;
}) {
  const isOwner = s.myRole === "owner";
  const shared = s.kind === "shared";
  const [name, setName] = useState(s.name);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<SpaceRole>("member");

  return (
    <section className="rounded-2xl border bg-card p-6">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {shared ? <Users className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
        {shared ? "Spazio condiviso" : "Spazio personale · visibile solo a te"}
      </div>

      {isOwner ? (
        <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); void run(() => supabase.from("spaces").update({ name: name.trim() }).eq("id", s.id), "Nome aggiornato")(); }}>
          <Input aria-label={`Nome spazio ${s.name}`} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" variant="outline" disabled={!name.trim() || name.trim() === s.name}>Rinomina</Button>
        </form>
      ) : <h2 className="mt-2 text-xl">{s.name}</h2>}

      {shared && (
        <>
          <h3 className="mt-5 text-sm font-semibold">Membri</h3>
          <ul className="mt-2 divide-y text-sm">
            {s.members.map((m) => (
              <li key={m.user_id} className="flex items-center justify-between gap-2 py-2">
                <span>{m.name}{m.user_id === uid && " (tu)"}</span>
                <span className="flex items-center gap-2">
                  {isOwner && m.user_id !== uid ? (
                    <select aria-label={`Ruolo di ${m.name}`} className="rounded-md border bg-background px-2 py-1 text-xs" value={m.role}
                      onChange={(e) => void run(() => supabase.from("space_memberships").update({ role: e.target.value as SpaceRole }).eq("space_id", s.id).eq("user_id", m.user_id), "Ruolo aggiornato")()}>
                      {(Object.keys(roleLabel) as SpaceRole[]).map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}
                    </select>
                  ) : <span className="text-xs text-muted-foreground">{roleLabel[m.role]}</span>}
                  {(isOwner || m.user_id === uid) && (
                    <Button size="sm" variant="ghost" onClick={run(() => supabase.from("space_memberships").delete().eq("space_id", s.id).eq("user_id", m.user_id), m.user_id === uid ? "Sei uscito dallo spazio" : "Membro rimosso")}>
                      {m.user_id === uid ? "Esci" : "Rimuovi"}
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>

          {isOwner && (
            <>
              {s.invitations.length > 0 && (
                <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
                  {s.invitations.map((i) => (
                    <li key={i.id} className="flex items-center justify-between">
                      <span>In attesa: {i.email} · {roleLabel[i.role]}</span>
                      <Button size="icon" variant="ghost" aria-label={`Revoca invito a ${i.email}`}
                        onClick={run(() => supabase.from("space_invitations").update({ status: "revoked" }).eq("id", i.id), "Invito revocato")}><X className="h-4 w-4" /></Button>
                    </li>
                  ))}
                </ul>
              )}
              <form className="mt-4 space-y-2" onSubmit={(e) => { e.preventDefault(); void run(() => supabase.rpc("invite_to_space", { _space: s.id, _email: email, _role: role }), "Invito creato")().then(() => setEmail("")); }}>
                <Label htmlFor={`inv-${s.id}`}>Invita per email</Label>
                <div className="flex gap-2">
                  <Input id={`inv-${s.id}`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                  <select aria-label="Ruolo invito" className="rounded-md border bg-background px-2 text-sm" value={role} onChange={(e) => setRole(e.target.value as SpaceRole)}>
                    <option value="member">{roleLabel.member}</option><option value="viewer">{roleLabel.viewer}</option>
                  </select>
                  <Button type="submit" variant="outline">Invita</Button>
                </div>
                <p className="text-xs text-muted-foreground">La persona vedrà l'invito qui, dopo l'accesso con questa email.</p>
              </form>
              <Button className="mt-4" size="sm" variant="ghost" onClick={run(() => supabase.from("spaces").update({ archived_at: new Date().toISOString() }).eq("id", s.id), "Spazio archiviato")}>Archivia spazio</Button>
            </>
          )}
        </>
      )}
    </section>
  );
}
