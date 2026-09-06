# PokéRogue Biome Map

A small static site that draws every PokéRogue biome, the links between them, and the exact chance of
taking each link. Hover or click a biome to see where it leads, where it is reached from, and every Pokémon that
can show up as its boss (by tier, with the tier's odds; click one to add it to the wanted list); toggle
between the odds a destination is *offered* when you hold a Map (the default) and the odds with no Map, when the
game picks for you.

## Running it

Open `index.html` directly, or serve the folder with any static server:

```sh
python -m http.server 8765 --directory biome-map
```

No build step or dependencies are needed to view it.

## Regenerating the data

`data.js` and the copied art are generated from a PokéRogue checkout, so they can be refreshed whenever the game's
biome tables change. Clone the game (this tool is not part of it) with its submodules, then point the script at it:

```sh
git clone https://github.com/pagefaultgames/pokerogue.git
cd pokerogue && git submodule update --init --depth 1 && cd ..   # assets/ and locales/
node build-data.mjs --game ../pokerogue      # or POKEROGUE_DIR=../pokerogue node build-data.mjs
node build-single.mjs                        # optional: dist/index.html, everything inlined
```

The script reads `src/enums/biome-id.ts`, `src/enums/species-id.ts`, every `biomeLinks` list and `pokemonPool` in
`src/data/balance/biomes/`, the species tables in `src/data/balance/species/`, the English names in `locales/en/`,
and copies the arena backdrops, icon sheets, Map icon and window frame out of `assets/`. `fonts.css` is a
Latin-only subset of the game's `pokemon-emerald-pro.ttf`, made once with fontTools and inlined as a data URI.

## Hosting

The page is static and uses relative paths, so any static host works, including GitHub Pages serving the root of
the default branch. No build step is needed to serve it.

## Wanted Pokémon

The "Wanted" strip above the map is editable in the page: type a name (or species key) in the box to add a
Pokémon, use the × next to an entry to remove it, and "Clear" to empty the list. The list is remembered
in the browser and mirrored into the URL as `#w=MEWTWO,GROUDON`, so a link carries it to someone else. Species
show up as gold chips on the biome cards, in the strip (hover to highlight their biomes, click to jump there), in
the side panel, and in the boss planner. A species that is in no wild pool is listed as egg-only.

`data.js` carries every biome's `pokemonPool` and a catalog of every species (name, base stat total,
legendary flag, icon frame in the `pokemon_icons_<gen>` atlases), so the page works out biomes, tiers, times of
day and pool sizes itself. `wanted.json` only sets the default list.

## Boss planner

Plans boss waves only: a Pokémon that appears solely on ordinary wild waves is listed but not routed.

Open it from the "Boss planner" button in the Wanted strip (or "I'm here" on a biome). Enter your wave, your
current biome and which waves your run's gym leaders fall on (20/50/80… or 30/60/90…, decided by the run seed).
"Best full routes" lists whole-run routes to wave 180 as a trade-off curve: for each number of free boss waves
spent where a wanted Pokémon can roll, the most likely route to get them (under the current odds mode), keeping
only routes that are more likely than every route with more boss waves. Each shows the chance of holding the route
and the overall chance of rolling at least one wanted Pokémon, which also accounts for the route breaking. Below that,
"One target at a time" lists, for every wanted Pokémon, the wild boss waves you can still reach in its biome and
the most likely route to each. Click any route to draw it on the map with the waves you would spend in each biome.

Rules it applies (Classic mode, from `GameMode` and `Arena` in the game source):

- Biomes change after every wave ending in 0, and that wave is a wild boss unless a gym leader (`waveIndex % 30`
  equals 20 or 0 depending on the seed) or the champion (190) takes it. Waves 191–200 are the final biome.
- A biome is reached on boss wave `10t` by walking exactly `t - s` links from the current stretch `s`, so the
  planner keeps the best route for every hop count.
- Boss tiers roll 44/64, 14/64, 5/64 and 1/64, then a species is drawn uniformly from the tier's pool for the
  current time of day (the planner averages over the four times of day). A roll on a tier whose live pool is
  empty is downgraded to the next filled tier, so for a biome with nothing in Boss Super Rare or Boss Ultra Rare
  the Boss Rare tier effectively gets 20/64; the biome cards and the planner both use these effective shares. Luck (each shiny in the party adds its
  variant + 1, capped at 14) shrinks the roll range to 64 − luck/2 for bosses and 512 − 2 × luck otherwise without
  moving the thresholds, so the rare tiers get slightly likelier; enter it in the planner. Legendary-like species
  with BST ≥ 660 are rerolled before wave 80, other legendary-likes before wave 55.
- A wave ending in 0 is a double battle 1 in 32 times (1 in 8 otherwise). Each active lure (Lure, Super Lure,
  Max Lure are separate modifiers) divides that by 4, clamped to a certain double: 1 lure → 1 in 8, 2 → 1 in 2,
  3 → always. Every Pokémon in a double rolls its species independently, so a double is two draws from the boss
  pool; the planner folds this in as `(1 − d)·p + d·(1 − (1 − p)²)` per boss wave, where `d` is the double chance.

Switching the planner to **Endless** changes the schedule: biomes move every 5 waves (`hasShortBiomes`), so only
every other stretch ends on a boss wave; every wave is wild, so nothing blocks a boss slot; and every 50th wave is
the End biome, after which the next biome is random (`generateRandomBiome`). The plan therefore runs from your wave
to the stretch before the next End. The post-250 random-boss chance (2% per 50 waves past 250, capped at 30%) is
mentioned but not counted.

Inputs are remembered in the browser.

## How the odds are computed

`SelectBiomePhase` rolls every weighted link `[biome, n]` independently and keeps it with probability
`1/n` (unweighted links are always kept), then picks one of the kept links uniformly at random. A biome with
a single link always goes there. The generator enumerates every subset of links to get exact fractions
(for example Mountain → Volcano is 23/36). With a Map the player chooses among the kept links instead, so
the "offered" chance is simply `1/n`.

## Files

- `index.html`, `style.css`, `app.js` — the page. Node positions are the hand-placed `GRID` table in `app.js`;
  a biome without an entry is placed automatically by its distance from Town.
- `build-data.mjs` → `data.js` — data generator and its output. `wanted.json` seeds the default wanted list.
- `build-single.mjs` → `dist/index.html` — optional single-file bundle (ignored by git).
- `fonts.css` — a Latin-only subset of the game's `pokemon-emerald-pro.ttf`, inlined so the page works from disk.
- `assets/` — copies of the game's arena backdrops, Pokémon icon sheets, the Map item icon and a UI window frame.

## License

This repository follows the [REUSE](https://reuse.software/) convention: every file's licence is declared either
in a header or in `REUSE.toml`, and the full texts are in `LICENSES/`.

- The tool's own code and documentation (`index.html`, `style.css`, `app.js`, the build scripts, this README) are
  © Logan Bissonnette and licensed under [AGPL-3.0-only](LICENSES/AGPL-3.0-only.txt), the same licence as the game
  whose data it is built from.
- `data.js` is extracted from PokéRogue's AGPL-licensed source and is likewise
  [AGPL-3.0-only](LICENSES/AGPL-3.0-only.txt), © Pagefault Games for the game data.
- Everything under `assets/` and the font embedded in `fonts.css` come from the
  [PokéRogue asset repository](https://github.com/pagefaultgames/pokerogue-assets), which offers them, to the
  extent they are licensable, under [CC BY-NC-SA 4.0](LICENSES/CC-BY-NC-SA-4.0.txt), © Pagefault Games. They are
  used here non-commercially, with attribution, and under the same terms.
- Pokémon, its characters and names are © Nintendo, Creatures Inc. and GAME FREAK inc. This is a non-commercial fan
  project and is not affiliated with, endorsed by, or connected to them or to PokéRogue.

Because of the asset licence the whole project must stay non-commercial.
