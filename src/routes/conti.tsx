import { createFileRoute } from "@tanstack/react-router";
import { Placeholder } from "@/components/page";

export const Route = createFileRoute("/conti")({
  head: () => ({
    meta: [
      { title: "Conti e carte — Fondo" },
      { name: "description", content: "Conti e carte nel tuo spazio finanziario personale (prototipo)." },
      { property: "og:title", content: "Conti e carte — Fondo" },
      { property: "og:description", content: "Conti e carte nel tuo spazio finanziario personale (prototipo)." },
    ],
  }),
  component: () => <Placeholder eyebrow="Spazio personale" title="Conti e carte" />,
});
