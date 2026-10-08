import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        dashboard: resolve(__dirname, "dashboard.html"),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:3001" },
  },
});
