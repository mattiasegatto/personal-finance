import { createFileRoute } from "@tanstack/react-router";
import { Placeholder } from "@/components/page";

export const Route = createFileRoute("/_authenticated/ricorrenti")({
  head: () => ({
    meta: [
      { title: "Redditi e spese ricorrenti — Fondo" },
      {
        name: "description",
        content: "Redditi e spese ricorrenti nel tuo spazio finanziario personale (prototipo).",
      },
      { property: "og:title", content: "Redditi e spese ricorrenti — Fondo" },
      {
        property: "og:description",
        content: "Redditi e spese ricorrenti nel tuo spazio finanziario personale (prototipo).",
      },
    ],
  }),
  component: () => <Placeholder eyebrow="Spazio personale" title="Redditi e spese ricorrenti" />,
});
