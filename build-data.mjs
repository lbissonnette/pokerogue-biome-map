// SPDX-FileCopyrightText: 2026 Logan Bissonnette
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Regenerates `data.js` and copies the art the site needs from a PokéRogue
 * checkout (with its `assets` and `locales` submodules initialised).
 *
 * Everything is read straight from the game sources so the site stays in sync:
 *   - biome ids:       src/enums/biome-id.ts
 *   - biome links:     src/data/balance/biomes/*.ts   (`const biomeLinks: BiomeLinks = [...]`)
 *   - wild pools:      src/data/balance/biomes/*.ts   (`const pokemonPool: BiomePokemonPools = {...}`)
 *   - species:         src/enums/species-id.ts, src/data/balance/species/generation-*.ts
 *   - names:           locales/en/biomes.json, locales/en/pokemon.json
 *   - arena art:       assets/images/arenas/<key>_{bg,a,b}.png
 *   - Pokémon icons:   assets/images/pokemon_icons_<gen>.{png,json}
 *   - default wanted:  wanted.json (species keys; the page lets viewers change the list)
 *
 * Run with:  node build-data.mjs --game <path to pokerogue checkout>
 *        or  POKEROGUE_DIR=<path> node build-data.mjs
 * Without either it looks one folder up, for the case where this lives inside the game repo.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function findGameRoot() {
  const flagIndex = process.argv.indexOf("--game");
  const candidate = flagIndex !== -1 ? process.argv[flagIndex + 1] : (process.env.POKEROGUE_DIR ?? resolve(here, ".."));
  const root = resolve(candidate);
  const missing = ["src/enums/biome-id.ts", "assets/images/arenas", "locales/en/biomes.json"].filter(p => !existsSync(join(root, p)));
  if (missing.length) {
    console.error(`Not a PokéRogue checkout with submodules: ${root}\n  missing: ${missing.join(", ")}`);
    console.error("Point at one with --game <dir> or POKEROGUE_DIR, and run `git submodule update --init --depth 1` inside it.");
    process.exit(1);
  }
  return root;
}
const root = findGameRoot();

const enumSource = readFileSync(join(root, "src/enums/biome-id.ts"), "utf8");
const biomeDir = join(root, "src/data/balance/biomes");
const names = JSON.parse(readFileSync(join(root, "locales/en/biomes.json"), "utf8"));
const itemNames = JSON.parse(readFileSync(join(root, "locales/en/modifier-type.json"), "utf8"));
const pokemonNames = JSON.parse(readFileSync(join(root, "locales/en/pokemon.json"), "utf8"));
const defaultWanted = JSON.parse(readFileSync(join(here, "wanted.json"), "utf8"));

// ---------------------------------------------------------------------------
// 1. Biome ids
// ---------------------------------------------------------------------------
/** @type {Map<string, number>} enum key -> numeric id, in declaration order */
const biomeIds = new Map();
for (const match of enumSource.matchAll(/^\s*([A-Z_]+):\s*(\d+),?\s*$/gm)) {
  biomeIds.set(match[1], Number(match[2]));
}
if (biomeIds.size === 0) {
  throw new Error("Could not parse any BiomeId entries from src/enums/biome-id.ts");
}

/** `TALL_GRASS` -> `tallGrass` (mirrors `toCamelCase` used by the game's i18n keys) */
function toCamelCase(key) {
  return key
    .toLowerCase()
    .split("_")
    .map((part, i) => (i === 0 ? part : part[0].toUpperCase() + part.slice(1)))
    .join("");
}

// ---------------------------------------------------------------------------
// 1b. Species ids (a TS enum that auto-increments from BULBASAUR = 1, with a
//     few explicit jumps for regional forms)
// ---------------------------------------------------------------------------
/** @type {Map<string, number>} */
const speciesIds = new Map();
{
  let next = 0;
  for (const line of readFileSync(join(root, "src/enums/species-id.ts"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z][A-Z0-9_]*)(?:\s*=\s*(\d+))?\s*,?\s*$/);
    if (!m) {
      continue;
    }
    next = m[2] !== undefined ? Number(m[2]) : next + 1;
    speciesIds.set(m[1], next);
  }
}

// ---------------------------------------------------------------------------
// 2. Biome links + wild Pokémon pools
// ---------------------------------------------------------------------------
/**
 * @type {Map<string, {
 *   key: string,
 *   links: {to: string, weight: number}[],
 *   trainerChance: number,
 *   pool: Record<string, Record<string, string[]>>,
 * }>}
 */
const parsed = new Map();
for (const file of readdirSync(biomeDir).filter(f => f.endsWith(".ts"))) {
  const source = readFileSync(join(biomeDir, file), "utf8");
  const idMatch = source.match(/biomeId:\s*BiomeId\.([A-Z_]+)/);
  const linksMatch = source.match(/const biomeLinks:\s*BiomeLinks\s*=\s*(\[[\s\S]*?\]);/);
  const poolMatch = source.match(/const pokemonPool:\s*BiomePokemonPools\s*=\s*(\{[\s\S]*?\n\});/);
  if (!idMatch || !linksMatch || !poolMatch) {
    throw new Error(`Could not parse biomeId / biomeLinks / pokemonPool from ${file}`);
  }
  const key = idMatch[1];
  if (!biomeIds.has(key)) {
    throw new Error(`${file} references unknown BiomeId.${key}`);
  }
  const json = linksMatch[1]
    .replace(/\/\/.*$/gm, "")
    .replace(/BiomeId\.([A-Z_]+)/g, '"$1"')
    .replace(/,\s*([\]}])/g, "$1");
  /** @type {(string | [string, number])[]} */
  const raw = JSON.parse(json);
  const links = raw.map(entry => (Array.isArray(entry) ? { to: entry[0], weight: entry[1] } : { to: entry, weight: 1 }));
  for (const link of links) {
    if (!biomeIds.has(link.to)) {
      throw new Error(`${file} links to unknown BiomeId.${link.to}`);
    }
  }
  /** @type {Record<string, Record<string, string[]>>} tier -> time of day -> species keys */
  const rawPool = JSON.parse(
    poolMatch[1]
      .replace(/\/\/.*$/gm, "")
      .replace(/\[BiomePoolTier\.([A-Z_]+)\]:/g, '"$1":')
      .replace(/\[TimeOfDay\.([A-Z_]+)\]:/g, '"$1":')
      .replace(/SpeciesId\.([A-Z0-9_]+)/g, '"$1"')
      .replace(/,\s*([\]}])/g, "$1"),
  );
  // Keep only the non-empty lists; the page fills in the rest.
  const pool = {};
  for (const [tier, byTime] of Object.entries(rawPool)) {
    for (const [time, list] of Object.entries(byTime)) {
      if (list.length) {
        (pool[tier] ??= {})[time] = list;
        for (const species of list) {
          if (!speciesIds.has(species)) {
            throw new Error(`${file} lists unknown SpeciesId.${species}`);
          }
        }
      }
    }
  }
  const trainerChance = Number(source.match(/trainerChance:\s*(\d+)/)?.[1] ?? 0);
  parsed.set(key, { key, links, trainerChance, pool });
}

// ---------------------------------------------------------------------------
// 3. Exact transition odds
// ---------------------------------------------------------------------------
// SelectBiomePhase: every weighted link `[biome, n]` is rolled independently and
// kept with probability 1/n (unweighted links are always kept). One of the kept
// links is then picked uniformly at random. With a Map item the player chooses
// among the kept links instead, so the "offered" chance is just 1/n.
// A biome with exactly one link always goes there, whatever its weight.

function gcd(a, b) {
  return b === 0n ? a : gcd(b, a % b);
}
/** Minimal exact fraction helper (BigInt numerator/denominator). */
function frac(n, d = 1n) {
  const g = gcd(n < 0n ? -n : n, d);
  return { n: n / g, d: d / g };
}
const add = (a, b) => frac(a.n * b.d + b.n * a.d, a.d * b.d);
const mul = (a, b) => frac(a.n * b.n, a.d * b.d);
const toNumber = f => Number(f.n) / Number(f.d);
const toString = f => (f.d === 1n ? `${f.n}` : `${f.n}/${f.d}`);

function transitionOdds(links) {
  const result = new Map(links.map(l => [l.to, frac(0n)]));
  if (links.length === 0) {
    // Dead end (only END): the game rolls a random biome instead of following a link.
    return { result, unreachable: frac(0n) };
  }
  if (links.length === 1) {
    result.set(links[0].to, frac(1n));
    return { result, unreachable: frac(0n) };
  }
  const keep = links.map(l => frac(1n, BigInt(l.weight)));
  let unreachable = frac(0n);
  for (let mask = 0; mask < 1 << links.length; mask++) {
    let p = frac(1n);
    const kept = [];
    for (let i = 0; i < links.length; i++) {
      if (mask & (1 << i)) {
        p = mul(p, keep[i]);
        kept.push(links[i].to);
      } else {
        p = mul(p, frac(keep[i].d - keep[i].n, keep[i].d));
      }
    }
    if (p.n === 0n) {
      continue;
    }
    if (kept.length === 0) {
      unreachable = add(unreachable, p);
      continue;
    }
    const share = mul(p, frac(1n, BigInt(kept.length)));
    for (const to of kept) {
      result.set(to, add(result.get(to), share));
    }
  }
  return { result, unreachable };
}

// ---------------------------------------------------------------------------
// 4. Depth (shortest number of biome changes from Town, ignoring odds)
// ---------------------------------------------------------------------------
const depth = new Map([["TOWN", 0]]);
const queue = ["TOWN"];
while (queue.length > 0) {
  const current = queue.shift();
  for (const link of parsed.get(current)?.links ?? []) {
    if (!depth.has(link.to)) {
      depth.set(link.to, depth.get(current) + 1);
      queue.push(link.to);
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Species catalog: names, stats and icons for everything
// ---------------------------------------------------------------------------
// Icon atlases (one per generation): frame "150" is Mewtwo, "1017-teal-mask" a
// form, "150s" shiny. Every atlas is copied so any species can be shown.
mkdirSync(join(here, "assets/icons"), { recursive: true });
/** @type {Map<string, { gen: number, frame: object, size: {w: number, h: number} }>} */
const frameIndex = new Map();
const atlasFiles = [];
for (let gen = 1; gen <= 9; gen++) {
  const jsonPath = join(root, `assets/images/pokemon_icons_${gen}.json`);
  if (!existsSync(jsonPath)) {
    continue;
  }
  const texture = JSON.parse(readFileSync(jsonPath, "utf8")).textures[0];
  const file = `pokemon_icons_${gen}.png`;
  copyFileSync(join(root, "assets/images", file), join(here, "assets/icons", file));
  atlasFiles.push({ file: `assets/icons/${file}`, w: texture.size.w, h: texture.size.h });
  for (const frame of texture.frames) {
    frameIndex.set(frame.filename, { atlas: atlasFiles.length - 1, frame });
  }
}

/** Default-form, non-shiny icon frame for a dex number, as [atlas, x, y, w, h]. */
function iconFor(dex) {
  let entry = frameIndex.get(`${dex}`);
  if (!entry) {
    const candidates = [...frameIndex.keys()]
      .filter(name => name.startsWith(`${dex}-`) && !/-tera$|mega|gmax|primal|eternamax/.test(name))
      .sort((a, b) => a.length - b.length);
    entry = candidates.length ? frameIndex.get(candidates[0]) : null;
  }
  if (!entry) {
    return null;
  }
  const f = entry.frame.frame;
  return [entry.atlas, f.x, f.y, f.w, f.h];
}

// Base stat total and legendary-ness, from src/data/balance/species/generation-*.ts.
const speciesDir = join(root, "src/data/balance/species");
/** @type {Map<string, { bst: number, legendLike: boolean }>} */
const statsIndex = new Map();
for (const file of readdirSync(speciesDir).filter(f => /^generation-\d+\.ts$/.test(f))) {
  const source = readFileSync(join(speciesDir, file), "utf8");
  for (const m of source.matchAll(/SpeciesData\[SpeciesId\.([A-Z0-9_]+)\]\s*=\s*\{/g)) {
    const end = source.indexOf("levelMoves:", m.index);
    const block = source.slice(m.index, end === -1 ? m.index + 4000 : end);
    statsIndex.set(m[1], {
      bst: Number(block.match(/baseTotal:\s*(\d+)/)?.[1] ?? 0),
      legendLike: /\b(legendary|subLegendary|mythical):\s*true/.test(block),
    });
  }
}

const REGION_PREFIX = { ALOLA: "Alolan", GALAR: "Galarian", HISUI: "Hisuian", PALDEA: "Paldean" };
function speciesName(key) {
  const base = pokemonNames[toCamelCase(key)];
  if (!base) {
    return null;
  }
  const region = REGION_PREFIX[key.split("_")[0]];
  return region ? `${region} ${base}` : base;
}

const species = [];
for (const [key, dex] of speciesIds) {
  const name = speciesName(key);
  if (!name) {
    continue;
  }
  const stats = statsIndex.get(key) ?? { bst: 0, legendLike: false };
  species.push({
    key,
    dex,
    name,
    bst: stats.bst,
    legendLike: stats.legendLike,
    // Arena.checkLegendBST rerolls legend-likes generated too early:
    // BST >= 660 before wave 80, any other legend-like before wave 55.
    minWave: stats.legendLike ? (stats.bst >= 660 ? 80 : 55) : 1,
    icon: iconFor(dex),
  });
}

// ---------------------------------------------------------------------------
// 6. Assemble + copy arena art
// ---------------------------------------------------------------------------
const arenaSrc = join(root, "assets/images/arenas");
const arenaDst = join(here, "assets/arenas");
mkdirSync(arenaDst, { recursive: true });
mkdirSync(join(here, "assets/items"), { recursive: true });
mkdirSync(join(here, "assets/ui"), { recursive: true });

const biomes = [];
for (const [key, id] of biomeIds) {
  const entry = parsed.get(key);
  if (!entry) {
    console.warn(`No biome definition found for BiomeId.${key}; skipping`);
    continue;
  }
  const fileKey = key.toLowerCase();
  const art = {};
  for (const layer of ["bg", "a", "b"]) {
    const name = `${fileKey}_${layer}.png`;
    if (existsSync(join(arenaSrc, name))) {
      copyFileSync(join(arenaSrc, name), join(arenaDst, name));
      art[layer] = `assets/arenas/${name}`;
    }
  }
  const { result, unreachable } = transitionOdds(entry.links);
  if (unreachable.n !== 0n) {
    console.warn(`${key}: ${toString(unreachable)} chance that no link is kept (the game would misbehave here)`);
  }
  biomes.push({
    id,
    key,
    name: names[toCamelCase(key)] ?? key,
    depth: depth.get(key) ?? null,
    trainerChance: entry.trainerChance,
    art,
    links: entry.links.map(link => ({
      to: link.to,
      weight: link.weight,
      /** Overall chance of ending up there when the game picks for you. */
      p: toNumber(result.get(link.to)),
      pExact: toString(result.get(link.to)),
      /** Chance the biome shows up as an option (what a Map lets you pick from). */
      pOffered: entry.links.length === 1 ? 1 : 1 / link.weight,
    })),
    pool: entry.pool,
  });
}

for (const [src, dst] of [
  ["assets/images/items/map.png", "assets/items/map.png"],
  ["assets/images/ui/windows/window_1.png", "assets/ui/window_1.png"],
  ["assets/images/ui/bg.png", "assets/ui/bg.png"],
]) {
  copyFileSync(join(root, src), join(here, dst));
}

// Classic-mode schedule, for the route planner (src/enums/fixed-boss-waves.ts,
// GameMode.isWaveTrainer: gym leaders sit on waves ≡ 20 or ≡ 0 mod 30 depending on the run seed).
const fixedBattleWaves = [...readFileSync(join(root, "src/enums/fixed-boss-waves.ts"), "utf8").matchAll(/=\s*(\d+)/g)].map(
  m => Number(m[1]),
);

const data = {
  generatedAt: new Date().toISOString(),
  mapItem: itemNames.ModifierType?.MAP ?? { name: "Map", description: "" },
  /** Display names for pool tiers and times of day, from the game's locale. */
  labels: Object.fromEntries(
    ["common", "uncommon", "rare", "superRare", "ultraRare", "boss", "bossRare", "bossSuperRare", "bossUltraRare", "dawn", "day", "dusk", "night", "all"].map(k => [
      k,
      names[k] ?? k,
    ]),
  ),
  // Tier roll odds from Arena.generateBossBiomeTier (roll 0-63) and
  // generateNonBossBiomeTier (roll 0-511), at luck 0.
  tierChance: {
    COMMON: [356, 512],
    UNCOMMON: [124, 512],
    RARE: [26, 512],
    SUPER_RARE: [5, 512],
    ULTRA_RARE: [1, 512],
    BOSS: [44, 64],
    BOSS_RARE: [14, 64],
    BOSS_SUPER_RARE: [5, 64],
    BOSS_ULTRA_RARE: [1, 64],
  },
  atlases: atlasFiles,
  species,
  biomes,
  defaultWanted: defaultWanted.filter(k => speciesIds.has(k)),
  classic: {
    finalWave: 200,
    fixedBattleWaves,
    gymWaves: { 20: [20, 50, 80, 110, 140, 170], 30: [30, 60, 90, 120, 150, 180] },
  },
};

for (const k of defaultWanted) {
  if (!speciesIds.has(k)) {
    console.warn(`wanted.json: unknown SpeciesId.${k}, ignored`);
  }
}

// The header written into data.js (these strings are not this file's own licence tags).
// REUSE-IgnoreStart
const dataHeader = [
  "// SPDX-FileCopyrightText: 2024-2026 Pagefault Games (game data), 2026 Logan Bissonnette (extraction)",
  "//",
  "// SPDX-License-Identifier: AGPL-3.0-only",
  "//",
  "// Generated by build-data.mjs from the PokéRogue sources (src/data/balance, src/enums, locales). Do not edit by hand.",
];
// REUSE-IgnoreEnd
writeFileSync(join(here, "data.js"), [...dataHeader, `window.BIOME_MAP_DATA = ${JSON.stringify(data)};`, ""].join("\n"));

const poolEntries = biomes.reduce((n, b) => n + Object.values(b.pool).reduce((m, t) => m + Object.values(t).reduce((k, l) => k + l.length, 0), 0), 0);
console.log(
  `Wrote ${biomes.length} biomes (${biomes.reduce((n, b) => n + b.links.length, 0)} links, ${poolEntries} pool entries), ${species.length} species (${
    species.filter(s => s.icon).length
  } with icons) to data.js`,
);
