import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  // In dev, /api goes to the Express backend, so no CORS or API URL is needed.
  server: { port: 5173, proxy: { "/api": "http://localhost:4000" } },
});
