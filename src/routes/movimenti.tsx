import { createFileRoute } from "@tanstack/react-router";
import { Placeholder } from "@/components/page";

export const Route = createFileRoute("/movimenti")({
  head: () => ({
    meta: [
      { title: "Movimenti — Fondo" },
      { name: "description", content: "Movimenti nel tuo spazio finanziario personale (prototipo)." },
      { property: "og:title", content: "Movimenti — Fondo" },
      { property: "og:description", content: "Movimenti nel tuo spazio finanziario personale (prototipo)." },
    ],
  }),
  component: () => <Placeholder eyebrow="Spazio personale" title="Movimenti" />,
});
