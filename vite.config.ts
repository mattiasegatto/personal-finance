import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { defineConfig, loadEnv } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Optional dev-only proxy: set SUPABASE_DEV_PROXY_TARGET (e.g. http://127.0.0.1:54321)
// in .env.local and VITE_SUPABASE_URL=http://localhost:5173/__supabase so the
// browser reaches the local Supabase stack through the Vite origin. Useful for
// embedded browsers that block cross-origin requests to other local ports.
const SUPABASE_DEV_PROXY_PATH = "/__supabase";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxyTarget = env["SUPABASE_DEV_PROXY_TARGET"];

  return {
    ...(proxyTarget && {
      server: {
        proxy: {
          [SUPABASE_DEV_PROXY_PATH]: {
            target: proxyTarget,
            changeOrigin: true,
            ws: true,
            rewrite: (path: string) => path.slice(SUPABASE_DEV_PROXY_PATH.length) || "/",
          },
        },
      },
    }),
    plugins: [
      cloudflare({ viteEnvironment: { name: "ssr" } }),
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
  };
});
