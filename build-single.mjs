// SPDX-FileCopyrightText: 2026 Logan Bissonnette
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Bundles the site into one self-contained HTML file (`dist/index.html`) with the
 * stylesheet, scripts, data and every image inlined, so it can be shared or hosted
 * as a single file.
 *
 * Run with:  node biome-map/build-single.mjs   (after build-data.mjs)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = name => readFileSync(join(here, name), "utf8");

let html = read("index.html")
  .replace('<link rel="stylesheet" href="fonts.css" />', () => `<style>\n${read("fonts.css")}</style>`)
  .replace('<link rel="stylesheet" href="style.css" />', () => `<style>\n${read("style.css")}</style>`)
  .replace('<script src="data.js"></script>', () => `<script>\n${read("data.js")}</script>`)
  .replace('<script src="app.js"></script>', () => `<script>\n${read("app.js")}</script>`);

// Every remaining `assets/...png` reference (HTML, CSS url(), data.js paths) becomes a data URI.
const cache = new Map();
html = html.replace(/assets\/[\w./-]+\.png/g, path => {
  if (!cache.has(path)) {
    const file = join(here, path);
    if (!existsSync(file)) {
      console.warn(`missing ${path}`);
      return path;
    }
    cache.set(path, `data:image/png;base64,${readFileSync(file).toString("base64")}`);
  }
  return cache.get(path);
});

mkdirSync(join(here, "dist"), { recursive: true });
writeFileSync(join(here, "dist/index.html"), html);
console.log(`dist/index.html: ${(html.length / 1024).toFixed(0)} KB, ${cache.size} images inlined`);
