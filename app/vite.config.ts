import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base is set from BASE_PATH so the same build works locally (/) and on
// GitHub Pages (/<repo>/). CI sets it; local dev does not need it.
export default defineConfig({
  plugins: [react()],
  base: process.env.BASE_PATH ?? "/",
  build: { outDir: "dist", assetsDir: "assets", sourcemap: false },

  // Bind IPv4 explicitly.
  //
  // Vite's default host is "localhost", which on this machine resolves to ::1
  // and binds IPv6 ONLY - so 127.0.0.1:5173 refuses the connection. Editor and
  // SSH port forwarding generally connect over IPv4, so the tunnel opens, the
  // browser gets nothing, and the page sits blank forever with the dev server
  // cheerfully reporting "ready". Pinning 127.0.0.1 makes `npm run dev` work
  // through a forwarded port with no flags.
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true },
});
