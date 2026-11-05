import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { errMsg, financeQuery, kindLabel, type CategoryKind } from "@/lib/finance";

export const Route = createFileRoute("/_authenticated/categorie")({
  head: () => ({
    meta: [
      { title: "Categorie personali — Fondo" },
      { name: "description", content: "Categorie e sottocategorie provvisorie per classificare entrate e spese personali." },
      { property: "og:title", content: "Categorie personali — Fondo" },
      { property: "og:description", content: "Categorie e sottocategorie provvisorie per classificare entrate e spese personali." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(financeQuery),
  component: Categories,
  errorComponent: ({ error }) => <div role="alert" className="text-destructive">{errMsg(error)}</div>,
});

const NONE = "__root";

function Categories() {
  const { data } = useSuspenseQuery(financeQuery);
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["finance"] });
  const [name, setName] = useState("");
  const [parent, setParent] = useState(NONE);
  const [kind, setKind] = useState<CategoryKind>("expense");
  const roots = data.categories.filter((c) => !c.parent_id);

  const act = async (p: PromiseLike<{ error: unknown }>, ok: string) => {
    const { error } = await p;
    if (error) toast.error(errMsg(error)); else { toast.success(ok); refresh(); }
  };
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return void toast.error("Indica il nome.");
    await act(supabase.from("categories").insert(parent === NONE
      ? { space_id: data.spaceId, name: name.trim(), kind }
      : { space_id: data.spaceId, name: name.trim(), parent_id: parent }), "Categoria creata");
    setName("");
  };
  const rename = (id: string, old: string) => {
    const n = prompt("Nuovo nome", old)?.trim();
    if (n && n !== old) act(supabase.from("categories").update({ name: n }).eq("id", id), "Categoria rinominata");
  };
  const toggleArchive = (id: string, archived: boolean) =>
    act(supabase.from("categories").update({ archived_at: archived ? null : new Date().toISOString() }).eq("id", id), archived ? "Categoria ripristinata" : "Categoria archiviata");

  const Row = ({ c, sub }: { c: (typeof data.categories)[number]; sub?: boolean }) => (
    <li className={`flex items-center justify-between gap-3 py-2 ${sub ? "pl-6" : ""} ${c.archived_at ? "text-muted-foreground" : ""}`}>
      <span className={sub ? "" : "font-medium"}>{c.name}{c.archived_at && " (archiviata)"}</span>
      <span className="flex gap-1">
        <Button size="sm" variant="ghost" onClick={() => rename(c.id, c.name)}>Rinomina</Button>
        <Button size="sm" variant="ghost" onClick={() => toggleArchive(c.id, !!c.archived_at)}>{c.archived_at ? "Ripristina" : "Archivia"}</Button>
      </span>
    </li>
  );

  return (
    <div>
      <PageHeader eyebrow="Spazio personale" title="Categorie personali" />
      <p className="mb-6 max-w-2xl text-sm text-muted-foreground">
        Classificazione provvisoria, utile per provare i movimenti. Massimo due livelli. Le categorie non si eliminano: si archiviano, così i movimenti già registrati restano invariati.
      </p>

      {data.categories.length === 0 && (
        <div className="mb-6 rounded-2xl border bg-accent p-5 text-sm">
          Non hai ancora categorie.{" "}
          <Button size="sm" className="ml-2" onClick={() => act(supabase.rpc("create_starter_categories", { _space: data.spaceId }), "Categorie di partenza create")}>Crea categorie di partenza</Button>
        </div>
      )}

      <form onSubmit={add} className="mb-6 grid gap-3 rounded-2xl border bg-card p-4 md:grid-cols-4">
        <Input placeholder="Nome categoria" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} aria-label="Nome categoria" />
        <Select value={parent} onValueChange={setParent}><SelectTrigger aria-label="Categoria padre"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value={NONE}>Categoria principale</SelectItem>{roots.filter((r) => !r.archived_at).map((r) => <SelectItem key={r.id} value={r.id}>Sotto: {r.name}</SelectItem>)}</SelectContent></Select>
        <Select value={kind} onValueChange={(v) => setKind(v as CategoryKind)} disabled={parent !== NONE}><SelectTrigger aria-label="Tipo"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="expense">Spese</SelectItem><SelectItem value="income">Entrate</SelectItem></SelectContent></Select>
        <Button type="submit">Aggiungi</Button>
      </form>

      <div className="grid gap-4 md:grid-cols-2">
        {(["income", "expense"] as const).map((k) => (
          <section key={k} className="rounded-2xl border bg-card p-5">
            <h2 className="text-lg">{kindLabel[k]}</h2>
            <ul className="mt-2 divide-y text-sm">
              {roots.filter((r) => r.kind === k).map((r) => (
                <div key={r.id}>
                  <Row c={r} />
                  {data.categories.filter((c) => c.parent_id === r.id).map((c) => <Row key={c.id} c={c} sub />)}
                </div>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
