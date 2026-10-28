import { createFileRoute } from "@tanstack/react-router";
import { Placeholder } from "@/components/page";

export const Route = createFileRoute("/report")({
  head: () => ({
    meta: [
      { title: "Report e analisi — Fondo" },
      { name: "description", content: "Report e analisi nel tuo spazio finanziario personale (prototipo)." },
      { property: "og:title", content: "Report e analisi — Fondo" },
      { property: "og:description", content: "Report e analisi nel tuo spazio finanziario personale (prototipo)." },
    ],
  }),
  component: () => <Placeholder eyebrow="Spazio personale" title="Report e analisi" />,
});
