import { createFileRoute } from "@tanstack/react-router";
import { Placeholder } from "@/components/page";

export const Route = createFileRoute("/_authenticated/impostazioni")({
  head: () => ({
    meta: [
      { title: "Impostazioni — Fondo" },
      { name: "description", content: "Impostazioni nel tuo spazio finanziario personale (prototipo)." },
      { property: "og:title", content: "Impostazioni — Fondo" },
      { property: "og:description", content: "Impostazioni nel tuo spazio finanziario personale (prototipo)." },
    ],
  }),
  component: () => <Placeholder eyebrow="Spazio personale" title="Impostazioni" />,
});
