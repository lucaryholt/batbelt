import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: "web",
  build: {
    outDir: path.resolve("dist/web"),
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    port: 3871,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:3870",
    },
  },
});
