// Copy the committed bundles into the Vite public directory.
//
// A symlink would be simpler but does not survive every CI checkout, and Vite
// copies publicDir verbatim. An explicit sync also makes it obvious in a build
// log exactly which bundles were published.
import { cp, mkdir, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "..", "bundles");
const dest = join(here, "..", "public", "bundles");

if (!existsSync(src)) {
  console.error(`no bundles directory at ${src}`);
  process.exit(1);
}
// Replace the CONTENTS, never the directory itself.
//
// `rm -rf` on dest gives the recreated directory a new inode, and a dev server
// that is already serving publicDir keeps the old one - so every request under
// /bundles/ falls through to the SPA handler and returns index.html with a 200.
// The app then tries to JSON.parse "<!doctype html>" and shows an error instead
// of the site. Running `npm run build` while `npm run dev` was up did exactly
// that, and the failure looks nothing like its cause.
await mkdir(dest, { recursive: true });
for (const entry of await readdir(dest)) {
  await rm(join(dest, entry), { recursive: true, force: true });
}
await cp(src, dest, { recursive: true });

const names = (await readdir(dest, { withFileTypes: true }))
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

// The index is what the app fetches first; it must never be hand-maintained.
await import("node:fs/promises").then(({ writeFile }) =>
  writeFile(join(dest, "index.json"), JSON.stringify(names, null, 1) + "\n")
);
console.log(`synced ${names.length} bundle(s): ${names.join(", ")}`);
