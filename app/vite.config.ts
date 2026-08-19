import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base is set from BASE_PATH so the same build works locally (/) and on
// GitHub Pages (/<repo>/). CI sets it; local dev does not need it.
export default defineConfig({
  plugins: [react()],
  base: process.env.BASE_PATH ?? "/",
  build: { outDir: "dist", assetsDir: "assets", sourcemap: false },
});
