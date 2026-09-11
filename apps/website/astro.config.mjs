import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  devToolbar: { enabled: false },
  vite: { plugins: [tailwindcss()], server: { strictPort: true } },
});
