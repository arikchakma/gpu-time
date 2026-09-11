import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://gpu-time.arikko.dev",
  devToolbar: { enabled: false },
  integrations: [react()],
  vite: { plugins: [tailwindcss()], server: { strictPort: true } },
});
