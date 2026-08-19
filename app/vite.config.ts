import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base is set from BASE_PATH so the same build works locally (/) and on
// GitHub Pages (/<repo>/). CI sets it; local dev does not need it.
export default defineConfig({
  plugins: [react()],
  base: process.env.BASE_PATH ?? "/",
  build: { outDir: "dist", assetsDir: "assets", sourcemap: false },

  // Listen on all interfaces, IPv4 included.
  //
  // Two separate problems, one fix. Vite's default host is "localhost", which
  // here resolves to ::1 and binds IPv6 ONLY, so 127.0.0.1:5173 refuses the
  // connection while the dev server reports "ready" - the forwarder connects
  // over IPv4, gets nothing, and the browser shows a blank page rather than an
  // error. And this runs inside a Docker container, so depending on how you
  // reach it the connection may arrive on the container IP (172.17.x.x) rather
  // than on loopback; binding 127.0.0.1 only would refuse those.
  //
  // "0.0.0.0" covers every path: VS Code Dev Containers forwarding, a published
  // Docker port, or hitting the container IP directly.
  //
  // This is deliberately NOT what live/app.py does. That one shells out to
  // scripts that run the agent, and stays on 127.0.0.1. This server only hands
  // out static demo files, so reachability matters more than isolation.
  server: { host: "0.0.0.0", port: 5173, strictPort: true },
  preview: { host: "0.0.0.0", port: 4173, strictPort: true },
});
