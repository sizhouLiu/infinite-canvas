import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/director-desk/",
  assetsInclude: ["**/*.fbx", "**/*.obj"],
  plugins: [react()],
  server: {
    port: 5174,
    // Bind IPv4 explicitly: the canvas proxies to 127.0.0.1, while "localhost" may resolve to ::1 only on Windows.
    host: "127.0.0.1",
    fs: {
      // fileURLToPath, not URL.pathname: on Windows the pathname is "/D:/…" and Vite turns it into "D:/D:/…".
      allow: [fileURLToPath(new URL(".", import.meta.url)), fileURLToPath(new URL("../模型库", import.meta.url))],
    },
  },
  build: {
    outDir: "../web/public/director-desk",
    emptyOutDir: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    pool: "threads",
    maxWorkers: 1,
    setupFiles: "./src/test/setup.ts",
  },
});
