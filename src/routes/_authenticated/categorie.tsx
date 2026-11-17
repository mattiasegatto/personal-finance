import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page";
import { errMsg, financeQuery, kindLabel } from "@/lib/finance";

export const Route = createFileRoute("/_authenticated/categorie")({
  head: () => ({
    meta: [
      { title: "Categorie — Personal Finance" },
      {
        name: "description",
        content: "Categorie predefinite per classificare entrate e spese.",
      },
      { property: "og:title", content: "Categorie — Personal Finance" },
      {
        property: "og:description",
        content: "Categorie predefinite per classificare entrate e spese.",
      },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(financeQuery),
  component: Categories,
  errorComponent: ({ error }) => (
    <div role="alert" className="text-destructive">
      {errMsg(error)}
    </div>
  ),
});

function Categories() {
  const { data } = useSuspenseQuery(financeQuery);
  const roots = data.categories.filter((c) => !c.parent_id);

  const Row = ({ c, sub }: { c: (typeof data.categories)[number]; sub?: boolean }) => (
    <li
      className={`py-2 ${sub ? "pl-6" : "font-medium"} ${c.archived_at ? "text-muted-foreground" : ""}`}
    >
      {c.name}
      {c.archived_at && " (archiviata)"}
    </li>
  );

  return (
    <div>
      <PageHeader eyebrow="Spazio personale" title="Categorie" />
      <p className="mb-6 max-w-2xl text-sm text-muted-foreground">
        Le categorie sono predefinite e uguali per tutti gli spazi: non si possono aggiungere,
        rinominare o archiviare. Gli spazi condivisi usano soltanto le categorie di spesa.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        {(["income", "expense"] as const).map((k) => (
          <section key={k} className="rounded-2xl border bg-card p-5">
            <h2 className="text-lg">{kindLabel[k]}</h2>
            <ul className="mt-2 divide-y text-sm">
              {roots
                .filter((r) => r.kind === k)
                .map((r) => (
                  <div key={r.id}>
                    <Row c={r} />
                    {data.categories
                      .filter((c) => c.parent_id === r.id)
                      .map((c) => (
                        <Row key={c.id} c={c} sub />
                      ))}
                  </div>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
