/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In dev, Vite serves the SPA on :5173 and proxies /api to FastAPI on :8000 (same-origin
// cookies just work). In prod, `npm run build` writes dist/ and FastAPI serves it.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: { "/api": "http://127.0.0.1:8000" } },
  // `npm test`: Vitest + Testing Library in jsdom against a fake fetch (src/App.test.tsx).
  test: { environment: "jsdom", include: ["src/**/*.test.tsx"], css: false },
});
