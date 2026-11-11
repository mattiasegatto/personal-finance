import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
    tanstackStart({
      // Preserve the custom SSR error-handling entry in src/server.ts.
      server: { entry: "server" },
    }),
    viteReact(),
    tailwindcss(),
    tsconfigPaths(),
  ],
  optimizeDeps: {
    include: [
      "@radix-ui/react-tooltip",
      "@radix-ui/react-dialog",
      "@radix-ui/react-alert-dialog",
      "@radix-ui/react-select",
      "@radix-ui/react-tabs",
      "@radix-ui/react-slider",
      "@radix-ui/react-slot",
      "@radix-ui/react-separator",
      "@radix-ui/react-label",
      "lucide-react",
      "recharts",
      "@supabase/supabase-js",
      "sonner",
      "@tanstack/react-query",
    ],
  },
});
