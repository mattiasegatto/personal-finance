import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Fondo, finanze personali" },
      { name: "description", content: "Panoramica di patrimonio, liquidità e spese condivise (dati dimostrativi)." },
      { property: "og:title", content: "Dashboard — Fondo" },
      { property: "og:description", content: "Panoramica di patrimonio, liquidità e spese condivise." },
    ],
  }),
  component: Index,
});

function Index() {
  const kpi = [
    ["Patrimonio netto", "€ 84.250,00"],
    ["Liquidità", "€ 12.430,00"],
    ["Risparmio di ottobre", "€ 1.120,00"],
  ];
  return (
    <div>
      <PageHeader eyebrow="Ottobre 2026 · dati fittizi" title="Buonasera, Mattia" />
      <div className="grid gap-4 md:grid-cols-3">
        {kpi.map(([l, v]) => (
          <div key={l} className="rounded-2xl border bg-card p-6">
            <p className="text-sm text-muted-foreground">{l}</p>
            <p className="num mt-2 font-display text-3xl">{v}</p>
          </div>
        ))}
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-primary p-6 text-primary-foreground">
        <div>
          <p className="font-display text-xl">Spese condivise con Giulia</p>
          <p className="text-sm opacity-80">Consulta saldo, spese del mese e rimborsi.</p>
        </div>
        <Button asChild variant="secondary"><Link to="/spese-condivise">Apri</Link></Button>
      </div>
    </div>
  );
}
