// Run the combined application from the repository root with npm run dev.
// This optional standalone UI still uses the Express session and analytics proxy.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5175,
    proxy: { "/api": "http://127.0.0.1:3001" },
  },
});
