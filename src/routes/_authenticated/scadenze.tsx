import { createFileRoute } from "@tanstack/react-router";
import { Placeholder } from "@/components/page";

export const Route = createFileRoute("/_authenticated/scadenze")({
  head: () => ({
    meta: [
      { title: "Scadenze — Fondo" },
      {
        name: "description",
        content: "Scadenze nel tuo spazio finanziario personale (prototipo).",
      },
      { property: "og:title", content: "Scadenze — Fondo" },
      {
        property: "og:description",
        content: "Scadenze nel tuo spazio finanziario personale (prototipo).",
      },
    ],
  }),
  component: () => <Placeholder eyebrow="Spazio personale" title="Scadenze" />,
});
