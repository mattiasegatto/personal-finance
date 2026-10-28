import { createFileRoute } from "@tanstack/react-router";
import { Placeholder } from "@/components/page";

export const Route = createFileRoute("/investimenti")({
  head: () => ({
    meta: [
      { title: "Investimenti — Fondo" },
      { name: "description", content: "Investimenti nel tuo spazio finanziario personale (prototipo)." },
      { property: "og:title", content: "Investimenti — Fondo" },
      { property: "og:description", content: "Investimenti nel tuo spazio finanziario personale (prototipo)." },
    ],
  }),
  component: () => <Placeholder eyebrow="Spazio personale" title="Investimenti" />,
});
