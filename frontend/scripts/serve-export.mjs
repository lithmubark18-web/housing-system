import { copyFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const names = readdirSync(root).filter((n) => n.endsWith(".html") && n !== "index.html");
let done = 0;
for (const name of names) {
  const dir = join(root, name.replace(/\.html$/, ""));
  if (!existsSync(dir)) continue;
  const dest = join(dir, "index.html");
  copyFileSync(join(root, name), dest);
  done++;
}
console.log(`serve-export: duplicated ${done} route html into <route>/index.html`);