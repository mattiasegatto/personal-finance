import { createFileRoute } from "@tanstack/react-router";
import { Placeholder } from "@/components/page";

export const Route = createFileRoute("/_authenticated/patrimonio")({
  head: () => ({
    meta: [
      { title: "Patrimonio — Fondo" },
      { name: "description", content: "Patrimonio nel tuo spazio finanziario personale (prototipo)." },
      { property: "og:title", content: "Patrimonio — Fondo" },
      { property: "og:description", content: "Patrimonio nel tuo spazio finanziario personale (prototipo)." },
    ],
  }),
  component: () => <Placeholder eyebrow="Spazio personale" title="Patrimonio" />,
});
