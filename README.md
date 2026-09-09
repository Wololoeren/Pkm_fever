# Pkm Fever

A monster-collecting RPG that runs in a browser, where **nothing is rolled at
the moment it is needed**.

Every creature, every stat and every rare form is a pure function of the world
seed and where you are standing. Walk away from a patch of grass and come back
and you meet the same creature, with the same nature and the same IVs, because
nothing was ever rolled — it was decided when the world was made. There is no
reset to scum and no save state to abuse.

Three things fall out of that, and they are the reason the game is built this
way:

- **A save file is a seed and a list of your inputs.** Not a blob of state.
  That makes it small, portable, and *verifiable* — replaying it is the
  integrity check, so a forged team has to be an actual playthrough.
- **Shiny hunting is exploration, not a slot machine.** Rare forms are placed
  during world generation, so every world holds exactly one true shiny and
  exactly one of each chroma form, findable and finite.
- **Two players on one seed inhabit the same world.** Which makes "same seed,
  ten hours, bring your best six" a complete and self-balancing tournament
  format.

Fan-made. Not affiliated with Nintendo, Game Freak or The Pokémon Company.

## Playing it

```bash
npm install
npm run dev
```

Then open <http://localhost:3100>. Pick a seed, choose one of the three
starters it deals you — one grass, one fire, one water — and walk east out of
the hub into the grass. Arrow keys or WASD to move; in a battle,
<kbd>1</kbd>–<kbd>4</kbd> for moves, <kbd>B</kbd> to throw a ball, <kbd>R</kbd>
to run, <kbd>Enter</kbd> to dismiss a result.

Your progress autosaves to the browser as you go, and **Save to file** hands
you the seed and input log as JSON — that is the whole save.

```
src/engine/    pure TypeScript. No DOM, no clock, no framework.
src/render/    canvas drawing and the OKLab/OKLCh variant pipeline
src/lib/       save files, narration, and the WebRTC transport
src/components/  the UI
src/data/      the generated manifest: 1,134 species, 791 moves, the type chart
scripts/       the build step that generates it
tests/         115 tests, including the replay property everything rests on
```

Working: world generation and the census, the overworld, wild encounters, a
full single battle system — damage, the type chart, criticals, accuracy, stat
stages, five status conditions, drain, recoil and healing — plus catching,
experience, levelling, move learning, evolution, breeding, the box, save/load,
and **1v1 duels over WebRTC**.

Not yet: a tournament bracket — though a bracket is a spreadsheet and a series
of 1v1s, which already work.

### Starters

One grass, one fire, one water, drawn from the real trios — Bulbasaur through
Sprigatito. Each type is drawn independently, so a world can pair Charmander
with Rowlet and Quaxly: 729 combinations rather than the nine a fixed trio per
world would give.

The list is curated, in `scripts/build-dex.mjs`, because there is nothing to
derive it from. "Is a starter" is a designer's decision, not a property of the
data — the first cut asked for three-stage lines with a base stat total
between 280 and 330 and duly offered Beldum, Klink and Solosis, all of which
are three-stage lines with a base stat total between 280 and 330. The build
step checks the list against the manifest and refuses to emit a broken one,
which is how it caught that Quilava evolves into *both* Typhlosion and
Typhlosion-Hisui: an earlier "exactly one final form" rule had been quietly
disqualifying Cyndaquil, Oshawott and Rowlet.

### Trainers

People stand on the paths, not in the grass, so they are visible and
avoidable: walking into one starts a fight, walking around one does not. Their
teams come from the same encounter table the route's grass uses, a couple of
levels above it, which makes a trainer a reason to come back to a route rather
than a wall across it. Beaten ones stay beaten and grey out on the map.

They also forced a small correction. Battles used to ask one question — "is
this wild?" — which decided both whether you could throw a ball and whether
you gained experience. A trainer is worth experience but cannot be caught, and
a person is neither, so the flag became two.

### Duels

Pick three, share a room code, and the two browsers talk to each other
directly. No server, no account, and nobody refereeing — which means the rules
have to hold without anyone to enforce them. Three things make that true:

- **Neither side sees the other's move first.** Moves are chosen at the same
  time, so whoever transmitted second could otherwise counter every turn. Each
  sends `sha256(action ‖ nonce)` and only reveals once both commitments are in.
  A reveal that does not hash to the commitment already received is a cheat,
  caught on the spot.
- **Neither side owns the dice.** Criticals, accuracy and damage rolls all come
  from the battle seed, so a player who chose it could fish for a good one. The
  seed is `sha256` of *both* opening nonces, each committed before either is
  revealed.
- **Both peers run the same engine and compare hashes every turn.** A modified
  client cannot force a wrong result on an honest opponent — it can only
  diverge, and divergence ends the duel loudly rather than quietly.

Teams are exchanged in the open, as competitive play has done since Open Team
Sheets became standard. It removes a whole class of problem: there is no hidden
state, so no amount of devtools helps.

Roles — who is side 0 — come from the nonces too. The tidier-looking
alternative, where each player is side 0 in its own view, is quietly broken:
rolls are named after the side that makes them, so the two clients would
compute `0-crit` for different creatures and desync on the first critical hit.
`tests/duel.test.ts` wires two sessions together in memory and plays whole
duels out, with no network and no timing involved.

### Breeding

The daycare is in the hub, and it is a place rather than a menu you carry — a
deposit anywhere else is refused, because walking back is what makes walking
out mean anything. Leave two compatible creatures there, walk 120 steps, and
there is an egg.

Every stat is inherited from one parent or the other, and three of the six
additionally **mutate upward**. That mutation is load bearing: wild IVs cap at
6, so without it 6 would be the permanent ceiling for the entire game and
breeding would do nothing at all.

The first cut of this rerolled the *non*-inherited stats at wild strength,
which reads as the natural mirror of "wild creatures are weak" and was a
disaster — half of every generation's progress was thrown away, and a line bred
over twenty generations went precisely nowhere. Inheriting everything and
mutating a few makes the climb monotonic and legible: about twenty-five
generations to perfect a stat, or fewer with the items.

Three items make it faster, and each is found by reaching further out — ring 2,
4 and 6. They are equipment rather than stock: found once, then applied to a
pairing for as long as you want them.

Nothing bred is ever a variant. The world holds exactly one true shiny, placed
when it was made; letting breeding mint more would make the census a lie and
turn every tournament into a breeding race.

### Sprites

Loaded at runtime from [PokeAPI's sprite repository][sprites], which is served
with permissive CORS headers — that matters, because the variant pipeline
reads pixels back off the canvas and a host that omits those headers would
taint it and take every variant with it. Showdown's archive is the better art
and cannot be used for exactly that reason.

Two images per species, normal and shiny, and all eleven appearances are
derived from that pair. Until they arrive — or with no network at all — a
placeholder creature is generated from the species id so nothing is ever a
hole in the page.

Regional forms are mapped to their own art at build time — PokeAPI numbers
them in the 10000s rather than by dex number, so the build script resolves the
mapping once. That is the only network call it makes, and it fails soft: no
connection means base-form sprites rather than no manifest.

[sprites]: https://github.com/PokeAPI/sprites

## How it works

### One seed, derived everywhere

`rngFor(seed, "encounter", routeId, index)` names the *decision* rather than
drawing from a shared stream. That is what makes the world stable under
change: adding an item to a shop must not shift which creature lives in the
twelfth encounter slot of route 3. It is also the anti-cheat, because a client
cannot roll for a better creature when the creature was already a function of a
seed everyone can check.

### The engine is a reducer

`reduce(world, inputs) -> GameState`, with no DOM and no clock in it. Game time
is a tick counter, every number is an integer, and an illegal input throws
rather than being quietly ignored — a log containing one is corrupt, not
merely surprising.

The renderer reads state and draws it. It never writes to it — canvas rather
than a game framework, precisely so nothing can quietly own the loop and feed
a tween result back into game state. That would break replay, and nobody would
notice for three months.

### Stats

Three deliberate departures from the games this resembles, all of them load
bearing:

- **Wild creatures roll IVs in 0..6**, a fifth of the ceiling. A caught
  creature is a starting point, and breeding is the only route to a
  competitive one.
- **Natures are additive vectors, not multipliers.** Vanilla multiplies one
  stat by 1.1 after a floor, so the same nature is worth a different number of
  points on different creatures and no UI can honestly explain it. A vector
  keeps the pipeline linear. The magnitude is 24 rather than something on the
  IV scale, which is not arbitrary: at level 50 one IV point is worth half a
  stat point, so ±24 is worth ±12 — exactly what a vanilla nature is worth.
  A vector of ±6 would move a stat by three points and nobody would care.
- **Eleven appearances, each a fixed multiplier on every stat.** Four gradient
  tints, five chroma sidegrades, and the true shiny at ×1.085. That cap is
  deliberate: a flat multiplier on every stat is far stronger than it feels,
  and at ×1.15 the true shiny would be worth more than the entire IV range,
  which would make the game a lottery instead of a breeding puzzle.

`tests/stats.test.ts` pins all of this against hand-computed numbers, because
if one of them changes, the game changed and every save replays differently.

### The census

Rare forms are not rolled at an encounter. World generation places exactly
1 shiny, 1 of each of the 5 chroma forms and 40 tints at specific encounter
slots, rarer things further from the hub. Nobody finishes a long save having
seen nothing because the dice hated them, and everyone on a seed has the same
census in the same places.

### Battles

Every roll is named — `rngFor(seed, "battle", route, slot, turn, "p-crit")` —
so a battle is a pure function of where it happened and how many turns have
passed. Fighting the same creature twice from the same save gives the same
criticals. Damage is integer arithmetic end to end: type effectiveness travels
in quarters, stage multipliers as numerator/denominator pairs, and nothing
ever produces a float that could round differently on another machine.

## Updating the roster

`src/data/*.json` is generated from `@pkmn/dex` by `npm run data`, and
committed. It reads the **ungenerationed** catalogue on purpose: a
generation-scoped view only contains what that generation could legally use,
and asking Gen 9 for Machop returns nothing at all. This game is not bound by
any generation's legality rules, so it takes every species and the most recent
learnset each one has. It is deliberately **not** wired into `prebuild`: a roster that
changed quietly between two builds would invalidate every save file in
existence without anyone noticing. Run it on purpose, read the diff, then
commit.

Nothing in `src/engine` ever names a species literally — everything goes
through the manifest. Point the build script somewhere else and the game runs
on a different bestiary without an engine change.

## What is next

The build order, roughly: the battle system, then a renderer over Tiled maps,
then the sprite variant pipeline, then save/load as a hash-chained input log,
then peer-to-peer battles over WebRTC.
