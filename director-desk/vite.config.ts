import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/director-desk/",
  assetsInclude: ["**/*.fbx", "**/*.obj"],
  plugins: [react()],
  server: {
    port: 5174,
    fs: {
      allow: [
        decodeURIComponent(new URL(".", import.meta.url).pathname),
        decodeURIComponent(new URL("../模型库", import.meta.url).pathname),
      ],
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
