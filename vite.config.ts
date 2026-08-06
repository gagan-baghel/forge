import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf8"));

// Tauri expects a fixed port and ignores the src-tauri folder when watching.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  // Prevent Vite from obscuring Rust errors.
  clearScreen: false,
  server: {
    port: 1620,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1621 } : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: {
    target: "es2021",
    sourcemap: false,
    // transformers.js (local embeddings) is a single large lazy-loaded chunk;
    // the default 500 kB warning is noise for it.
    chunkSizeWarningLimit: 600,
  },
});
