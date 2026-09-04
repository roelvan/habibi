import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const project = fileURLToPath(new URL(".", import.meta.url));
const output = path.join(project, "dist");
const client = path.join(output, "client");

await rm(output, { recursive: true, force: true });
await mkdir(client, { recursive: true });

for (const file of [
  "index.html",
  "styles.css",
  "app.mjs",
  "model.mjs",
  "manifest.webmanifest",
  "sw.js",
  "_headers",
]) {
  await cp(path.join(project, file), path.join(client, file));
}

await cp(path.join(project, "icons"), path.join(client, "icons"), {
  recursive: true,
});

console.log("Habibi production bundle created in dist/client");
