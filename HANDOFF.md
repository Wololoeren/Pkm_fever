# Handoff — Pkm Fever

Status as of 2026-09-14. Read this before changing anything. The README is the
long-form design record; this file is what the next session needs to not break
something, and what was left half-done.

## What this is

A browser monster-collecting RPG (Next.js static export, no server) where a save
is **a world seed plus an input log**. The engine (`src/engine/`) is a pure
reducer: `reduce(world, inputs)` rebuilds the whole game, so a save replays and
verifies anywhere. PvP battles, trades and 4–16 player brackets run peer to peer.

```bash
npm run dev          # http://localhost:3100 (also .claude/launch.json "pkm-fever")
npx vitest run       # ~925 tests, ~2 minutes
npx tsc --noEmit -p .
npx eslint src tests
```

Pushing to `main` deploys to GitHub Pages (`.github/workflows/pages.yml`), so a
push is a release to players.

## Rules that are load-bearing

- **`ENGINE_VERSION` (`src/engine/types.ts`).** Bump it whenever a change makes
  an old input log replay into a different game — any battle rule, roll,
  schedule, world placement, or what an input does. A mismatched save is
  refused (`lib/save.ts`), so a bump discards everyone's autosave: that is the
  intended behaviour, not a bug. The comment above it is the changelog; add an
  entry. If the current number has not been pushed yet, fold into it instead.
- **`src/lib/pack.ts` opcodes are a file format.** Append new inputs at the
  end; never renumber. Adding an input without an opcode is a compile error.
- **`stateHash` in `engine.ts`** must include every piece of state (eggs and
  nicknames were added this session). The per-creature `individual()` string
  is also there.
- **Numbers in prose are guarded by tests.** `tests/hints.test.ts` (HN12) pins
  phrases in `hints.ts` to constants — change the constant, rewrite the
  sentence and the row, never the other way round. `docs/status.md`,
  `docs/items.md` (counts per shelf and total), `docs/abilities.md` are guarded
  the same way.
- **Some tests grep source.** e.g. F19 in `tests/fieldmoves.test.ts` requires
  `BattleView.tsx` not to contain `<PartyStrip` and to contain `aside(`.
- **Do not run `prettier --write`.** The repo is not Prettier-formatted; it
  rewraps whole files and breaks the source-grep tests.
- **Line endings are mixed (CRLF and LF).** Edit scripts that match multi-line
  strings must detect the file's newline first.
- **Watch for control characters from tooling.** The Write tool turned `\u0000`
  in a test into a real NUL, which made git treat `tests/nickname.test.ts` as
  binary. Fixed in the working copy (2026-09-14); keep escapes as text.

## 2026-09-13 → 14: what changed

Committed as `7c0642a` (ENGINE_VERSION 34, pushed), plus the uncommitted work
listed at the end.

### PvP / tournament
- **Battle layout without a party panel.** `.stage` is a three-column grid; PvP
  and brackets passed no `aside`, so the field fell into the narrow column.
  `BattleView` now defaults `aside` to `teamPanel(...)` (in `PartyStrip.tsx`),
  which shows the battle's own team and is where switching is clicked.
- **Seed and move count under player names.** `hello` carries `seed` and
  `moves`; they flow into the lobby roster and `bracket.players`. Peer claims
  are shape-checked (`introduced()` in `tourney.ts`) and dropped if malformed.
  Not seen on screen — needs real peers; covered by test U0.

### Breeding and eggs
- Daycare lays an egg every **300** steps (`STEPS_PER_EGG`).
- Taking an egg puts an `Egg` (`breeding.ts`) in `state.eggs`, not a creature
  in the party. The child is rolled at collection, so the egg is fixed.
- **Eggs take a party slot.** `partyFull()` counts `party + eggs` against the
  limit of 6 everywhere a creature joins; `collectEgg` refuses a full party;
  hatching always lands in the party.
- **Hatch timer 250–2500 steps**, `hatchSteps()`: a 450-step window placed by
  `hatchRarity()` (catch rate scaled over the data's real range 18–247, plus
  shine and chroma). Counted per footstep in `walked()`.
- **The count is hidden from the player** by request: the egg card shows a
  mood line (`eggMood()` in `PartyStrip.tsx`), no number or bar. Keep it that
  way.
- When an egg reaches 0 in the field, `page.tsx` plays `EvolutionScene` with
  `from={EGG}`; its end dispatches the `hatch` input. Walking is paused while a
  scene is up (`sceneUp`).
- **Egg sprite** is PokeAPI `sprites/pokemon/egg.png`. `tintEgg()` in
  `render/sprites.ts` rotates the green spots to the swatch reference orange
  and then applies the chroma, so the spots match the chroma's colour dot
  (a straight rotation gave Ember → teal). Onyx/Ivory tint the whole shell.
- Dev cheat **Give as egg** (Ctrl+Shift+Alt+Z) gives an egg 3 steps from
  hatching.

### Battle and world rules
- **Running away:** fail chance = `max(10, 10 × levels the wild one is above
  you)`%, capped at 100 (`fleeFailPercent`). Speed no longer matters. Smoke Ball
  still always escapes.
- **Rival:** first appears at move 500 (`RIVAL_FIRST`), then every 2500 after
  his last visit. He catches you 20 moves after appearing, so the first fight
  is at ~520.
- **Balls actually use their multiplier.** The `ball` input's `item` used to be
  dropped in `applyInput` and the battle always rolled at ×1.
  `ballMultiplier()` in `battle.ts` handles: Great ×1.5, Ultra ×2, Quick ×5
  turn 1, Timer +0.3×/turn to ×4, Net ×3.5 Water/Bug, Nest (41−lvl)/10 under
  30, Level ×2/4/8, Fast ×4 base Spe ≥ 100, Dive ×3.5 on `:rod:` battles,
  Master always. All are sold in the Mart (Master 50,000 — a pricing
  placeholder, may want to be found instead). The battle screen shows one
  button per ball owned; B throws a Poké Ball.

### UI and data
- **Item descriptions rewritten** to state effects in numbers (`items.ts`,
  `carry.ts`). Mints were printing raw stat ids.
- **Nicknames:** `rename` input (opcode 44), by uid, party or box, refused
  mid-battle; `cleanNickname()` trims, strips control characters, 12 max, and
  the species name or empty clears it. UI is `NameEditor` in `Inspect.tsx`.

## Committed on 2026-09-15, not pushed — ENGINE_VERSION 36

- **68 new abilities** (180 total) in `abilities.ts`. Adding to `ABILITIES` changes
  every wild ability roll (`pickAbilities` indexes the list), so this breaks old
  saves; it rides on 36 because 36 never shipped.
  - 12 classes: `power` with `when: "signature"` and `move`, ×2 on one move.
  - `lack-*` / `affinity-*` for 18 types: `typesWith()`, read by `typesOf` and
    `typesAgainst` in `battle.ts`. Battle only; NPC wants, quests and the AI's
    features still read species types. Inspect shows an IN BATTLE tag.
  - 9 effort abilities on the existing `regimen` shape.
  - 4 `temper` abilities: `natureTerms()` in `stats.ts` (Inspect and StatHover use it).
  - 7 `forage` abilities: `forageStep()` in `engine.ts`, new state `forageWalk`
    (hashed), `FORAGE_EVERY` 500, notice `foraged`.
  - Tests in `newabilities.test.ts`; `docs/abilities.md` updated.
- **Born holding items.** `rollHeld()` and the pools in `carry.ts`: wild (grass,
  fishing, idlers, authored critters) 1% from common berries + Nugget + Pearl;
  starters 10% from `STARTER_HELD_ITEMS` (Leftovers, Focus Sash, Lucky Egg, ...).
  Each a separate named rng stream. Caught creatures keep the item. Also
  save-breaking, also on 36. Tests in `bornheld.test.ts`.
- **Found eggs.** `placeFoundEggs()` in `world.ts`: one per ring from ring 2,
  on a random route of that ring, on open non-grass ground. A `PickupSpec` with
  `egg: { speciesId }` and `item: "egg"` (not a real item: code iterating
  pickups must skip `drop.egg`). Species: any base form not in Undiscovered.
  The creature is `foundEggCreature()` (wild IVs, level 1). Picking it up in
  `move()` needs a free party slot, else notice `foundEgg` with `taken: false`
  and it stays. 3000 steps. Drawn as a speckled egg in `GameCanvas.tsx`.
  Save-breaking, on 36. Tests in `foundegg.test.ts`.
- **Every remaining move.** 51 status moves honoured in `statusmoves.ts` +
  `applyMoveEffect` (rooms, hazards, restriction, Substitute, Baton Pass /
  Shed Tail / Parting Shot, ability rewrites, item moves, Snatch / Magic Coat
  / Me First / Nature Power / Mimic, Curse and the four guards), plus Fury
  Cutter, Echoed Voice, Stomping Tantrum, Temper Flare, Lash Out, Rage Fist,
  Knock Off / Thief / Covet / Incinerate and the eight damaging riders (Glaive
  Rush, Rage, Uproar, Smack Down, Psychic Noise, Salt Cure, Sparkling Aria,
  Syrup Bomb). Only the 11 ally-only moves stay filtered (`docs/moves-deferred.md`).
  New state: `Field.rooms`, `Combatant.hazards/spent/beaten/lent/knocked`,
  `BattleState.ground` (set by `grounds()` in the engine funnel from the
  biome), ~30 volatiles (all badged in `tags.ts`, narrated in `narrate.ts`,
  documented in `docs/status.md`). Simple ability added for Simple Beam.
  Item moves: Knock Off always returns the item after battle; Thief/Trick/
  Bestow are permanent in wild battles and returned otherwise (`returnItems`).
  Embargo / Magic Room move the item into `volatiles.muffled`.
  Two bugs fixed that `tests/fuzzmoves.test.ts` found: Struggle legality is
  now judged at the start of the turn (an Imprison user switching out made a
  chosen Struggle throw), and `aiAction` continues a forced move instead of
  picking a refused Struggle when every PP is spent (pre-existing, could
  crash a trainer battle). Learnsets changed, so this is save-breaking, on 36.
  Tests: `lastmoves.test.ts`, `fuzzmoves.test.ts`.
- **Master Ball** (price stays 50,000): one lies on a route of the outermost
  ring of every world (`placeMasterBall()` in `world.ts`), and Ball Collector
  rolls a 0.5% Master Ball before its ordinary list (`forage.rare`). World
  change, so save-breaking, on 36. Tests `masterball.test.ts`.
- **Names out of the hash.** Nicknames and box-tab names are no longer in
  `stateHash` (only the tab count is), and `rename`, `renameBox` and `trainer`
  no longer advance `tick`, so two players who name things differently on
  the same seed hash the same.
- **TURN for strict networks.** `turnServers()` in `src/lib/relays.ts` reads
  `NEXT_PUBLIC_TURN_URLS` / `_USERNAME` / `_CREDENTIAL` at build time; the
  Pages workflow passes them from repo secrets `TURN_URLS`, `TURN_USERNAME`,
  `TURN_CREDENTIAL`. Unset = direct connections only. Needs the user to
  create a TURN account (Metered, ExpressTURN, Cloudflare…) and add secrets. Skipped for now by the user.
- **Mr. Vane, the swindler** (Hearth, `trade-swindler` in `npc.ts`): shows a
  level 1 Mew for a level 10+ Pikachu and delivers a level 1 Metapod nicknamed
  "Mew". New `NpcSpec.delivers` (what is really handed over) and `afterLines`
  (`dialogueOf(npc, helped)`); notice `swindled`.
- **Pawnbroker** (Southpass, kind `pawn`): buys a party creature for 50 per
  level (`PAWN_PER_LEVEL`), returns its held item, then refuses until
  `PAWN_COOLDOWN` (1200) real steps have passed. New state `stepsTaken`
  (every map step, in `walked()`) and `pawnedAt`; input `pawn` (opcode 49);
  notice `pawned`. New NPCs shift world placement: save-breaking, on 36.
  Tests `swindlepawn.test.ts`.
- **Auction house** (New Willow, kind `auction`; board logic in
  `src/engine/auction.ts`). Lot n closes at step 1000·(n+1) and is on the
  board the 6000 steps before, so six are always up, one closing every 1000
  steps. Lots are 70% exotic (first forms whose line peaks at base total
  ≥530) and 30% legendary (Undiscovered first forms, total ≥570); level
  10–30; price (20000 + 1500·level), ×2.5 for a legend. A bid (input `bid`,
  opcode 50) pays now into `state.bids`; after the close `collectBids`
  (opcode 51) delivers the creature (50% roll `bidWins`, named per lot) or
  refunds. The catch rates in the manifest are not canon (Dratini is 194), so
  they cannot identify rare species. Save-breaking (new NPC), on 36. Board
  checked in the browser on the dev server. Tests `auction.test.ts`.
- **Workshop** (Sanchford, kind `workshop`, in `engine.ts` beside the
  auction): three jobs — `ice` (ice cream), `fire` (roast chicken), `water`
  (plants) — each holding one party creature of that type in
  `state.workshop`. `workshopStep()` in `walked()` gives each 1 exp per step
  (`worked()`): level from exp, health kept proportional, and nothing else —
  no learnset moves and no evolution offers, so moves passed while working
  are skipped for good. Inputs `workshopLeave` / `workshopTake` (opcodes
  52/53). Save-breaking (new NPC), on 36. Tests `workshop.test.ts`.
- **The lake and the shortcuts** (`buildRoute` in `world.ts`). One route per
  world (`lakeRoute` in `generateWorld`, a land-walled biome) floods a 4x3
  block of maze rooms with water and lays the maze's own corridors back
  across it as 2-wide sand causeways, so on foot the maze is unchanged and
  Surf crosses it. Every route also turns 1–3 walls between two reachable,
  unjoined rooms into a band of bushes (Cut) or water (Surf; bushes where
  the biome's walls are already water). Both use their own named rng
  streams so nothing else on the route moves. W25 now measures walks on
  foot, since tool shortcuts are meant to shorten them. Save-breaking
  (world layout), on 36. Tests `lake.test.ts`.
- **The vault** (no server). `src/lib/vault.ts` keeps `VaultEntry`s in
  localStorage (`pkm-fever.vault`), exportable/importable as a file.
  Entries come from a save file or the autosave (`entriesFromSave`: replay
  with this engine → `proven` unless the run cheated; otherwise the save's
  `roster` snapshot, unproven) or from the live run ("Add this run to the
  vault" button, `entriesFromRun`). Entry id = `seed-run:uid`, so a later
  save of the same run updates rather than duplicates. Saves now carry
  `roster` (all creatures, so a future engine can still read them) and a
  random `run` name (`newRunId`, kept in `Session.run`); neither is read by
  the engine. `VaultScreen.tsx` (main menu → Open the vault): 7x7 pages,
  search, details via `StatHover`, remove, Begin Vault Adventure. That
  dispatches `trainer` + `vaultStart` (opcode 54); `vaultArrival()` rebuilds
  and sanitises the creature: level 5, EVs 0, moves for level 5, keeps
  species/look/nature/gender/IVs (clamped)/valid abilities/held item/name/
  caughtBy/cheat/prize, sets `Individual.vault`. VAULT tag in Inspect and on
  the verify page (`Verification.vaultStart`). Saves from engine 35 have no
  roster and cannot be read. Checked end to end in the browser. Tests
  `vault.test.ts`.
- **PvP warnings for flagged teams.** `src/engine/integrity.ts` counts
  cheated / vault / traded / prize creatures (`teamFlags`, `flagsText`).
  Duels: `PvpScreen` holds on a "Before you battle" screen at turn 0 when
  either team has any (both teams already arrive in the `hello`), with
  Battle anyway / Leave; no protocol change. Tournaments: `hello` now carries
  `flags` (optional, old clients ignore it; `readFlags` sanitises), shown on
  each player chip and as a warning above Start in the lobby. Flags are what
  each client reports, so a modified client could hide them; the verify page
  is the proof. Not exercised between two real browsers. Tests
  `integrity.test.ts`.
- **Bug: the nurse refused a party that was only missing PP** ("everyone is
  well"). `offerRefusal` for `heal` now asks `needsCentre()` — health, a
  condition, or any move below its max PP. Not save-breaking: a refused
  input was never recorded. Test N6b in `npc.test.ts`.
- **Variant tracking removed** (user's call). `GameState.found`, the
  "Variants N of 53" header entry and the journal's "Variants found" are
  gone; it only ever counted catches, NPC trades and joining critters, so a
  shiny starter or a bred shiny never showed. Changes `stateHash`; on 36.
- **Bug: the hatching/evolution scene flashed the new shape** in colour at
  the start of the flicker (4s). The swap counter counted the upcoming swap,
  so the first flicker frame was "after" while the silhouette filter was
  still fading in. `shapeAt()` in `EvolutionScene.tsx` now counts only
  swaps that have happened. Tests `evolutionscene.test.ts`.
- **Ability chevrons.** `AbilityMark` in `Sprite.tsx`: one gold sergeant
  chevron per ability (max 3) in the sprite's top-left corner, names on
  hover. `Sprite` takes an optional `abilities` prop, passed by every caller
  that has an Individual (party, box, battle, Inspect, daycare, PvP,
  tournament, starters, vault, arena, cheat menu); `.abilityMark` in
  `globals.css`, not hidden in box cells like `.mark` is. Checked in the
  browser (one chevron on the Scholar Mudkip, none on the plain one).
- **Bug: a trainer ready for a rematch stayed faded on the map** (and off
  the minimap). Both drew from `state.beaten`, which never clears; they now
  ask `wantsRematch`, the check walking into them uses (1000 moves after
  the loss).
- **Held item on the stat sheet.** `HeldLine` in `Inspect.tsx` shows what
  it holds and the item's blurb, with a Take back button (`holdItem` with
  `item: null`, refused through `holdRefusal`). Boxed creatures show the
  item and say to take them into the party first. There was no way to
  remove an item before, except swapping in another.

## Earlier on 2026-09-15 — committed locally, not pushed (ENGINE_VERSION 36)

- **Poison on the map.** `poisonStep()` in `engine.ts`, called at the top of
  `walked()`: every `POISON_STEP_EVERY` (5) steps each poisoned party member
  loses 1 HP or is cured (`POISON_CURE_PERCENT`, 2%), rolled from
  `rngFor(seed, "field-poison", tick, uid)`. At 1 HP the poison wears off, so
  it never faints. New state `poisonWalk` and `poisonedAt` (both hashed);
  `PoisonFlash` in `page.tsx` blinks `.poisonFlash` when `poisonedAt` changes.
  Tests in `fieldpoison.test.ts`. 35 was pushed, so this is **36**.
- **PvP timing out (live site).** Two causes. (1) Trystero's built-in relay pick for app id
  `pkm-fever` was 4 of 5 dead, so every room hung on one relay. Rooms now use
  `RELAY_URLS` in `src/lib/relays.ts` (7 relays, each verified pairing two
  browsers from the live origin on 2026-09-15). (2) `room.ts`/`party.ts` set
  status `failed` 12 s after joining if nobody had arrived, i.e. while the
  host waited for a friend to type the code. Now only "no relay open" fails,
  re-checked every 12 s, and it recovers. Still no TURN server: two players
  both behind strict NATs (some mobile carriers, corporate networks) cannot
  connect directly, and nothing free fixes that.
- **Ability blurbs** in `abilities.ts` rewritten to state exact numbers and
  exceptions, checked against `battle.ts`. Text only.

## Committed (2026-09-14) — ENGINE_VERSION 35

- **Evolution played twice.** Accepting an offered evolution left an `evolved`
  notice that the page also used as the stone-evolution reveal. The notice now
  carries `watched: true` from `answerEvolution`, and `page.tsx` skips the
  reveal for it. Not verified in the browser (no quick way to raise an offer).
- **Sleep did nothing a third of the time.** `canAct` woke a creature when the
  counter reached 1 and let it move, so rolls of 1/2/3 cost 0/1/2 turns. The
  counter is now turns still to lose (wake at 0), `REST_TURNS` is 2. Tests B9b
  and B9c. Because 34 was already pushed, this is **35**.
- **Hex and Infernal Parade** now double against a target with any condition
  (`powerAgainst()` in `moves.ts`, applied in the damage loop in `battle.ts`).
  They were a flat 65/60. Test B9d. Still missing the same kind of rule:
  Venoshock and Barb Barrage (poisoned target), Facade (user statused, and
  ignores burn's halving), Brine (target at half HP or less), Wake-Up Slap and
  Smelling Salts (asleep/paralysed target, and cure it).
- **Transform was permanent.** It rewrites the creature itself (species, IVs,
  EVs, nature, abilities, moves, PP), and nothing put it back — a caught Ditto
  kept the copy, and so did the player's own Ditto after a battle. The original
  is now stored in the `transformed` volatile and restored by
  `revertTransform()` on switching out (before the fainted early-return in
  `onLeaving`), in `finish()` whenever the battle has an outcome, and read via
  `untransformed()` for the catch roll and the caught creature. HP is clamped
  to the original's maximum. The volatile shows as a TRANSFORMED badge
  (`tags.ts`) and has a row in `docs/status.md`. Tests X38b, X38c. Known leftover: while
  transformed, max HP follows the copied species' base HP, unlike the games.
- **Box as tabs of 7×7.** `state.box` stays one flat list (every input that
  names a box index is unchanged); `boxNames` and `boxOf` (uid → tab) say
  where each sits. `shelved()` at the end of `applyInput` gives every boxed
  creature a tab (first with room, opening a new one if all are full) and drops
  stale entries; it only runs when `box` or `boxOf` changed. Inputs `addBox`
  (max 32), `renameBox` (16 chars), `moveToBox` (refused into a full tab),
  opcodes 45–47. UI is `BoxPanel.tsx`: left click → sheet, right click → take
  out, drag onto a tab → move, double-click a tab → rename, search highlights
  and counts matches per tab. Release and daycare for boxed creatures moved to
  the sheet (`BoxActions` in `Inspect.tsx`). Tests in `tests/box.test.ts`.
  A hand-built state (tests) is not shelved until an input changes the box.
- **Daycare IVs.** The daycare panel shows expected IVs per egg
  (`expectedIvs()`, exact; checked against 4000 simulated eggs in BR20) and the
  chance any IV mutates (`mutationChance()`). Three found items add a chance
  for IVs outside the mutating slots to mutate anyway: Spore of Change +10%
  (`mycelia:2`), Living Amber +20% (`fellgarden:2`), Primordial Seed +35%
  (`ashflats:3`). The extra roll only happens when one is applied, so eggs
  without them are unchanged.
- **Daycare kit** (`DAYCARE_GEAR` in `items.ts`; helpers in `breeding.ts`). All
  applied at the daycare, never used up; the first of each kind is sold at the
  Mart, the rest found (`meadow:3`, `duskhollow:1`, `emberfields:2`,
  `saltpan:2`, `glacier:1`).
  - Pairing wait: `eggSteps()` = max(30, round((300 − flat) × (100 − percent)
    / 100)). Pairing Bell −50, Courting Song −100, Rose Incense −20%, Moonlit
    Charm −40%. The percentage is applied last.
  - Hatching: Warm Blanket −15%, Ember Cradle −30%, cap 75%, applied to the
    egg's total when it is taken (`reducedHatch()`), not to eggs already out.
  - Incubators: Incubator +1, Brood Lamp +1, Hatchery Stone +2, max 4.
    `collectEgg` takes `to: "incubator"`; eggs sit in `daycare.incubating`,
    walk down with every step anywhere, and `readyEgg()` offers them after
    carried eggs; `hatch` with `from: "incubator"` plays the same scene and
    puts the creature in the box. An incubator item cannot be toggled off
    while its egg is inside. Tests BR22–BR24.
- **Multi-hit animation.** `Beat` in `lib/beats.ts` now carries `lunges` and
  `hits` lists (with `lungeAt`/`hitAt` kept as the first of each). Blows are
  `BLOW_GAP_MS` (180) apart and push the rest of the turn back; `useBeat` plays
  every one, and `sound.ts` times each hit cue to its blow. Test A14.
- **Situational moves** (`battle.ts`): `situationalPower()` (Hex, Infernal
  Parade, Venoshock, Barb Barrage, Wake-Up Slap, Smelling Salts, Brine, Knock
  Off, Facade, Acrobatics, Eruption/Water Spout/Dragon Energy, Stored
  Power/Power Trip, Last Respects, Payback, Bolt Beak/Fishious Rend,
  Revenge/Avalanche, Assurance, Rising Voltage, Expanding Force, Psyblade,
  Misty Explosion, Hydro Steam); `chartFor()` (Freeze-Dry, Flying Press — also
  used by `landsAs` and the immunity check); in `damageFor` Foul Play, Body
  Press, Psyshock/Psystrike/Secret Sword, Sacred Sword/Chip Away/Darkest
  Lariat, Collision Course/Electro Drift, Facade ignoring burn; Terrain Pulse
  beside Weather Ball; False Swipe in `landDamage`; `moveFails()` (Dream
  Eater, Sucker Punch — reads `turn.chosen` — Synchronoise) and First
  Impression with Fake Out; `afterHit()` (Wake-Up Slap and Smelling Salts
  cure, Rapid Spin frees seed/bind, Clear Smog clears stages) with new
  volatile events `roused`/`spun`/`cleared`. Tests in `tests/situational.test.ts`.
  (The moves this once listed as still missing were all done on 2026-09-15.)
- **Weather on the field.** `WeatherLayer.tsx` draws rain, sun, sand, hail and
  snow (and a ground glow per terrain) from `battle.field`, as CSS animations
  in `globals.css` under "the weather". It sits first in `.field` at z-index 0
  and clips itself, so the slots paint over it and hover panels are not cut
  off. Particle placement comes from per-property irrational steps (a shared
  step lined particles up). Display only; reduced motion keeps the tint.
- **Strike effects.** `components/strikes.ts` spawns a short (≤0.4s) effect on
  the target at each blow, keyed on the move's type — flames (fire), droplets
  (water), bolt (electric), leaves, shards, rings (psychic/dragon), shrinking
  rings (ghost/dark), bubbles, falling rocks, slashes (flying/steel/bug),
  sparkles (fairy), impact star (normal/fighting) — plus the star on top for
  any contact move. Pieces are created at hit time inside the sprite's
  `.mover` (via the flash's parent), removed on finish, on cancel, and by a
  backup timer (a non-painting tab leaves animations pending forever). Hits in
  `beats.ts` now carry `moveId`. Shapes are `.strike-*` in `globals.css`.
- **Exp. Share** (`hold-expshare` in `carry.ts`, effect `share` in
  `abilities.ts`). A holder that did not fight gets half the whole
  `expYield` of each beaten creature, plus effort; fighters' shares are
  unchanged; fainted holders get nothing. Given once by `shared()` at the end
  of `applyInput` — the first field input with no other notice after anybody in
  party or box is level 40+ — guarded by `state.expShareGiven`. Not in shops,
  sells for 2000 (H2 requires a sell price). Removed from the "should not
  exist" table in `docs/items-deferred.md`. Tests ES1–ES4.
- **Trainer names and "caught by".** `trainer` input (opcode 48), once per
  save, 12 chars; the new-game form requires it and sends it as the first
  input; a save without one shows `TrainerPrompt` in `page.tsx`. The last name
  typed is remembered in localStorage (`pkmfever.trainerName`) and pre-fills
  the tournament name. `Individual.caughtBy` is set by `signed()` at the end
  of `applyInput` on every party/box creature without one; trades keep the
  sender's (or "Unknown"), NPC gifts carry the NPC's name. Neither the name
  nor `caughtBy` is in `stateHash`, so today's-seed hashes still compare
  across players (a nickname *is* in the hash — worth revisiting for the same
  reason). Shown on the stat sheet. Tests in `tests/trainer.test.ts`.
- `tests/nickname.test.ts` NUL bytes replaced with escapes.
- This file.

## Known gaps and notes

- Browser-pane screenshots time out often in this environment; verification
  has been done by reading the DOM and canvas pixels with scripts instead.
- The evolution scene's flicker cannot be watched in a hidden pane
  (`requestAnimationFrame` is throttled).
- Traded and gift creatures can be renamed (unlike the handhelds) — a choice
  the user was told about, not a confirmed preference.
- `README.md` "What is next" lists the remaining design gaps (status moves
  still filtered out of learnsets, deferred items and abilities).

## Eggs sit with the creatures, and incubators fill themselves

- Hub: carried eggs are rows in the Party list (`EggRow`: picture, "Egg", `eggMood`), with an
  **Incubate** button at the daycare when a slot is free. Incubating eggs are rows in the daycare
  column and cells in the box grid (after the creatures; they belong to no tab yet).
- Engine: `incubated()` in the `applyInput` funnel moves a waiting daycare egg into a free incubator
  whenever one is free — laid while walking, a slot freed by hatching, or an incubator applied to a
  pair with an egg waiting. `layEgg()` is the shared body of `collectEgg`. New input
  `incubateEgg { index }` (pack opcode 55) hands a carried egg over; refusal `incubateRefusal`.
  Notice `eggIncubated`. Save-breaking on engine 36 (unpushed). Tests BR24/BR24b.

## The Grey Line is a map now, not a list of fifty

- `TalkPanel`: a travel post's buttons are its reachable **towns** only (never more than four), and
  everywhere else is a dot on a `RegionMap` drawn at 280px underneath, with every reachable stop
  ringed in `--go` (bright green) and clickable. The line above it still counts reachable and closed
  posts, so nothing about what the engine allows is hidden.
- `RegionMap` gained `size`, `reachable` and `onPick`. The dex still passes neither. `.mapGo` in
  globals.css is the hover/focus state; `--go` is a new token that only ever means "you may go here".
- Engine untouched: the destination list is still `stations` + `travelRefusal`. Not save-breaking.

## The maps, big, in a window of their own

- `MiniMap` has an "Open a big map" button. `BigMapWindow` opens a named browser window
  (`pkm-fever-map`), clones the page's `<style>`/`<link rel=stylesheet>` into it, and portals the
  same `LocalMap` and `RegionMap` in at 620px — so it redraws with the game rather than holding a
  second copy of the state. Closing the window, or pressing the button again, puts it away.
- `LocalMap` gained a `width` prop; its cell ceiling now rises with the width asked for.
- A blocked popup (`window.open` returns null) closes the state again, so the button never lies.
  Note: popups are blocked outright in the in-app browser pane, so it was verified there by
  stubbing `window.open` with a same-origin iframe.

## Saves are named by when they were saved

- `fileStamp(savedAt)` in `lib/save.ts` renders a save's moment as `20260916-1432` (local time,
  sortable by name). `downloadSave` names files `pkm-fever-<seed>-<stamp>.json`, and the vault
  export is `pkm-fever-vault-<stamp>.json`. Two saves of one run no longer collide into "(1)".
- The file's own `savedAt` is unchanged and still what the menu and the verify page read. Nothing
  about the format changed, so old saves open and new ones open in the live version. Test PK9.

## Fly uses the Grey Line's map

- `BagPanel`, Fly selected: the towns keep their cards (still greyed with `flyRefusal` where it
  refuses), and every place you can land is ringed green on a 240px `RegionMap` above them —
  clickable, read from `flyRefusal` so the map and the buttons cannot disagree. UI only.
- Not checked in the browser: Fly is a gym reward and the testing shortcuts cannot grant items.

## Box marks, and a slower daycare (engine 37)

- Box cells show the shine/tint mark, the colour letter and the ability chevrons, shrunk to fit
  (`.boxCell .mark`, `.boxCell .abilityMark svg`) instead of `display: none`.
- `STEPS_PER_EGG` 300 → 600. Items that shorten it are unchanged, so each is worth relatively less.
- **ENGINE_VERSION 36 → 37.** 36 was already live on origin, so the egg rate and the earlier
  auto-incubate change would otherwise replay live 36 saves differently. 36 saves now refuse.

## Ivo's printer: dearer and slower (folded into engine 37)

- `PRINT_COOLDOWN` 600 → 1500; new `PRINT_PRICE` 3000, taken on every attempt (failed prints too),
  refused below it with "a print costs ¤3,000". Dialogue and the talk panel say both. Tests Q8/Q8b.
- Ivo stands in New Willow (`town-2`) on every seed: town names are fixed in towns.ts.

## The traders wander, and auction lots have a sheet (folded into engine 37)

- Ivo (`print-ivo`), the Auctioneer, Marv (`shred-marv`) and Hessa (`cut-hessa`) are placed with the
  new `{ at: "wander", maxRing: 2 }`: a seeded pick (`rngFor(seed, "npcWander", id)`) among every
  town and every route in rings 1–2, on a tile `walkableSpot` reaches on foot from the entry (a
  flood fill, so a town corner behind houses is never chosen). Tests N20 (always placed, in range,
  reachable) and N21 (not all in one place across seeds).
- Auction board: each lot is a button; clicking opens a `StatHover` of
  `atFullHealth(withMoves(lotCreature(seed, n)))` — exactly what a win delivers. Lot sprites carry
  their ability chevrons. Not seen in the browser (the lot is on a random route now, and 37 refuses
  the old autosave); type-checked only.

## Gus buys eggs, and an ability list as plain text (folded into engine 37)

- NPC `egg-buyer` ("Gus", kind `eggbuy`) at New Willow (20,14). `eggValue(egg)` =
  1000 + 1500·tier/TOP_TIER + 500 if coloured → 1000–3000. Input `sellEgg { index, confirm }` (pack
  opcode 56), refusal `sellEggRefusal`, notice `eggSold`, new state counter `eggsSold` (hashed).
  Once `eggsSold >= 2` the talk panel appends `EGG_BUYER_AFTER_TWO` — omelettes hinted, never named
  (EB5 checks). Tests in `tests/eggbuyer.test.ts`.
- `docs/abilities.txt`: all 181 abilities, name and in-game description, alphabetical. Generated
  from `ABILITIES`; regenerate it the same way if abilities change (nothing guards it).

## Routes have names, and levels instead of rings

- `src/engine/placenames.ts`: per-biome word lists (`grounds` × `of`, 63 names a biome) and
  `placeNames(seed, routes)` — routes in id order, each drawing an unused name from
  `rngFor(seed, "place-name", id)`, unique across the world. Applied at the end of `generateWorld`
  after `wireBorders`, so it moves nothing; labels are not in any hash and no engine rule reads them.
- Label is `"<Ground> of <Thing> [low-high]"`, e.g. "Maze of Static [9-13]". The bracket is
  `levelBracket(ring)` from the new `src/engine/levels.ts` (`levelForRing` moved there, re-exported
  from world.ts), and `wildAt` now rolls with the same `WILD_LEVEL_SPREAD`, so the sign is the truth
  (PN4 samples every route's grass).
- The "reach ring N" quest goal now reads "Stand somewhere marked [lo-hi] or further out".
- Not save-breaking on its own: names are display only.

## Handbook, switch animation, pickups off doors, boxing into the open tab

- **Pokémon Handbook** (`handbook`, key item, `reads: true`, `bagUse` → "read"): given by the
  Librarian (`gift-librarian`) in Hearth at (8,8). Opening it from the Bag shows
  `components/Handbook.tsx` — shine rungs (`TIER_NAMES`/`TIER_MULT`, now exported), each colour's
  stat shifts (`CHROMAS[].mult`), every ability and every item (searchable). Reading is not an input.
  (26,14) was tried first and blocked the scripted walks out of Hearth in five tests.
- **Switch animation** (`useLeaving` + `useSwitchIn` in `useBeat.ts`): the replaced creature walks
  off (skipped if it fainted), a ball arcs in from the trainer's side and bursts, the new one pops
  out. `useEntrance` now only plays on a battle's first creature (keyed on the tag).
- **Pickups** never sit on a tile that moves you (`passesThrough`: doors, exits, borders, gates, the
  entry) — doors were being chosen because a doorway is a dead end. Applied to floor pickups, inks,
  found eggs and the Master Ball; `propBlocks` now also checked for floor pickups. HB3, verified to
  fail without the fix.
- **store** takes an optional `tab`; the hub's Box button passes the tab open in `BoxPanel` (which
  is now optionally controlled). `storeRefusal` greys it when that tab is full. Old logs without a
  tab behave as before. BX1b.
- Librarian and the pickup move fold into engine 37.

## Gyms on the region map

- `RegionMap` finds each gym through its leader in `world.npcs` (hall, or the route when no hall was
  built) and keys it by the outer route. Hover text: "a gym" until you have been inside, then
  "Kiln Gym (Ash, fire) — not yet beaten", then "✓ Kiln Gym (Ash) — defeated"; a beaten gym's node
  also gets a green ✓ drawn beside it (non-interactive, so travel rings still take the click).
  Unvisited and visited hover lines checked in the browser; the beaten ✓ was not (the test fight
  was lost), UI only.

## The three who shape abilities (folded into engine 37)

- `src/engine/tutor.ts` (pure): `chromaCandyFor` (0 without a colour, else 1 + shine tier),
  `tutorOffer`/`tutorBoard` (8 offers, lot `n` leaves at `1000·(n+1)` steps like the auction; each
  an ability plus money ¤5,000–20,000 and three of pearls / Chroma Candy / Glitter / one stone /
  2–5 of one berry), `giftContents(seed, tick)` (80%: potions or berries; 20%: a stone, pearls,
  Chroma Candy, Glitter or a machine).
- Items `chromacandy` (currency, sells for 0) and `secretgift` (`opens: true`, used from the bag via
  `useItem`, notice `giftOpened`).
- NPCs: Colour Collector (`chromabuy`, Sanchford), Ability Tutor (`tutor`, Sanchford), Gift Swapper
  (`giftswap`, Southpass). Inputs `chromaTrade`, `tutorLeave {n,index,confirm}`, `tutorTake`,
  `giftSwap` (pack 57–60). State `tutoring` (hashed; counted in the vault roster). Held items
  come back when a creature is given away. Tutor refuses: a pupil already there, an ability it
  knows, a fourth ability, an offer gone from the board, a price you cannot pay; pupil ready after
  2,500 steps. Talk panel: `TutorBoard` (pick an ability, then who). Tests in `tests/shapers.test.ts`.

## Obedience (folded into engine 37)

- `obedienceLevel(badges)` = 20 + 10·badges; `disobeys(state, creature)` = traded && level ≥ it.
  `battleTurn` passes it as `BattleRules.obeysBelow` (duels and anything else leave it unset, so
  everybody obeys there). In `resolveTurn`, a side-0 `fight` from such a creature (not mid-Fly/
  Outrage, not Pursuit) goes to `disobeyed()`: roll `obey` over usable moves + 2, so each legal move
  1 share and loafing 2. Event `disobeyed { side, moveId|null }`, narrated "ignored orders!" /
  "is loafing around and won't listen."
- Stat screen: the TRADED tag turns red as "TRADED · WON'T OBEY", with the rule in its hover.
- Worth knowing: auction lots arrive `traded: true` at levels 10–30, so a level 20+ win will not
  obey a trainer with no badges. Tests in `tests/obedience.test.ts`.

## Gym scaling, and the team balls (gyms fold into engine 37)

- `MOVES_PER_LEVEL` 1000 → 2500, `LEVELS_PER_BADGE` 5 → 3 (cap of 30 from moves unchanged). Hint
  text, the badge notice and tests G3/HN follow the constants.
- The trainer-team ball row was invisible: `TeamBalls` used class `ball`, which is also the thrown
  catch ball (`position: absolute; transform: scale(0)` until thrown), so every team ball was scaled
  to nothing. Renamed to `teamBall`. Checked in a gym battle: three 9px balls, untransformed.

## IV scales

- Thirty held items `hold-scale-<up>-<down>` ("Scale: +Atk −Spe"), ¤3,000 each at the Mart, effect
  `{ t: "tilt", up, down, amount: SCALE_AMOUNT (5) }`. `ivTilt(pair)` sums what both parents carry;
  `inheritIvs` applies it after every roll (so eggs draw the same numbers and are only moved),
  clamped to 0–31. `expectedIvs` applies the same order, so the daycare table stays exact (SC4
  checks it against 6,000 eggs). docs/items.md lists all thirty. Not save-breaking: nothing that
  rolls from an item list includes held items wholesale.

## People on the region map

- New state `spokenTo` (sorted ids), filled by `acquainted()` at the end of the `applyInput` funnel
  whenever `talking` names somebody new. Not hashed, not read by any rule — saves replay the same.
  (`met` was already taken: it is the dealt-with critters.)
- `RegionMap` hover appends the names of people you have spoken to who run a service there
  (`SERVICES` in MiniMap.tsx: buyers, traders, printer, arenas, shredder, lapidary, smith, pawn,
  auction, workshop, egg buyer, Colour Collector, Tutor, Gift Swapper), keyed by the outer route
  for people indoors. Quest givers, gyms, the Cup, hints, nurses and Grey Line posts are left out.
  Checked in the browser: "Sanchford — a town" became "Sanchford — a town — Ability Tutor". EB6.

## Held-item gift box, and the arenas (arenas fold into engine 37)

- `Sprite` takes `heldItem`; `HeldMark` draws a small SVG gift box bottom-left with the item's
  name as hover text. Every caller that passes `abilities={x.abilities}` now also passes
  `heldItem={x.heldItem}`. Seen on a starter card ("Holding Lum Berry").
- `arenaRefusal`: the party must be exactly `teamSize` ("it is 3v3: bring exactly 3 (you have 5)"),
  as well as all standing. W32 updated.
- Arenas easier: `ARENA_MOVES_PER_LEVEL` 1000 → 2500, `ARENA_PER_BADGE` 5 → 3 (the gyms' pace),
  opponent IVs `ARENA_IV` 24 → 18. W30 updated.

## Hearth's terraces, and inviting people to live in them (folded into engine 37)

- `buildTerraces` (world.ts) replaces the daycare's corner building in Hearth: a front row on the
  east-west road (daycare 6 wide as the end house, then four 3-wide guest rooms) and a back row of
  six more, with a path along its doorsteps to the north road. Rooms `hub-0:guest0..9`, labelled
  "Terrace, No. N", role `guest`; every door has a board set into the wall beside it ("No. N",
  short because the doors are three tiles apart). Daycare interior id is now `hub-0:daycare`.
  The Librarian moved to (12,20) to clear the new rows.
- State `served` (people whose service you have used; filled by `servedBy` from `SERVICE_INPUTS`)
  and `lodgers` (room id → person id), both hashed. `LODGER_KINDS`: buyer, printer, shredder,
  lapidary, smith, pawn, auction, workshop, egg buyer, Colour Collector, Tutor, Gift Swapper.
- `peopleOn(world, state, route)` is now the question "who is standing here": the roster less
  lodgers, plus the lodger of a guest room at `lodgerSpot(room)`. `talk`, walking into people
  (`npcAt(..., state)`), the canvas and the map hover all ask it.
- Inputs `invite` / `sendHome` (pack 61/62), offered last in the talk panel for those kinds;
  refusals "do business with them first", "they already live in Hearth", "all 10 guest rooms are
  taken", "they have nowhere to be but here".
- Checked in the browser: sold Gus an egg → invited → gone from New Willow → walked into Terrace
  No. 1 and he was there, still buying eggs; map hover "Hearth — a town — Gus". Tests LG1–LG4.

## Quality-of-life batch (engine parts fold into 37)

- **Locks** (`lock {uid}`, state `locked`, `LOCKED_TEXT`): refused by release, the Appraiser,
  shredder, lapidary, pawnbroker, NPC trades, Colour Collector and Gift Swapper — not by the
  daycare, workshop or tutor, which give it back. Toggle on the stat screen; 🔒 on box cells.
- **Take back held items** (`takeHeldFromBox {tab}`), a button in the box tools.
- **Box tools** (UI): sort (box order, level, IV total, shine, colour, abilities, type, holding),
  filter (shine, colour, ability, holding, a type), shift/ctrl-click to pick several and drag them
  onto a tab together (refused whole if they do not fit).
- **Hatched box**: incubated eggs hatch into a tab named "Hatched" (`hatchedTab`), opened on first
  need. `moveToBox`/`store` into it and renaming it are refused (`HATCHED_TEXT`); `shelved` never
  files anything there.
- **Egg-o-meter** (`eggometer`, kind `hm`, Tools tab): handed over on the 15th hatch
  (`eggsHatched`, `given`); while carried `eggMood(egg, true)` shows exact steps everywhere.
- **Doomscroller** (`doomscroller`, Keys, `reads: "feed"`): handed over when `spokenTo` includes 6
  people of `LODGER_KINDS` (`acquainted`). Opens `components/Doomscroller.tsx`: a feed of every clock
  (printer, wheel, shredder, pawnbroker, tutor, workshop, auction bids and closed lots, daycare egg,
  carried and incubated eggs), ready ones first. `ItemSpec.reads` is now `"handbook" | "feed"`.
- **Bag**: search across every tab; machines say who in the party can learn them.
- **Daycare IV table**: a Scale column when a parent holds an IV scale; gain can be negative.
- **Handbook**: a Types tab with the 18×18 effectiveness chart.
- **Battle end**: an "auto-continue when nothing levelled, learned or evolved" checkbox, off by
  default, remembered per browser (`pkm-fever.autoContinue`).
- **Tutor board**: every price part green/red against your bag, "3 Pearl (you have 1)".
- **Autosave slots**: `pkm-fever.saves` keeps the last `AUTOSAVE_SLOTS` (3) runs, one slot per run
  id, newest first; the old single key still mirrors the newest (the vault reads it) and an old
  single save is folded in as a slot. `clearAutosave` no longer deletes anything. Main menu lists
  them with a Continue each.
- **Tap-to-walk** (`lib/pathing.ts`, `stepToward`): click or tap a tile on the field map, the small
  map or the big map window; the page sends one ordinary `move` per step toward it over seen ground
  only, around people, creatures and trainers, stopping on arrival, anything not walking, or a
  refused step. Keys cancel it.
- **Mobile**: `TouchPad` (hold to walk, pointer events) under the map on coarse pointers or ≤720px,
  field row stacks, map scales to width. Checked at 375×812: no horizontal scroll, pad under the
  map, holding ▲ walked.
- Tests: `tests/qol.test.ts` (QL1–QL8).

## Dr. Couch, Egg Insurance, Mart shelves, and a halved lens (folded into 37)

- **Dr. Couch** (`therapist`, kind `therapy`, Southpass): `therapyLeave {index, confirm}` for a
  traded or prize party member, ¤10,000 (`THERAPY_PRICE`), 1,000 steps (`THERAPY_STEPS`) on the
  couch (`state.therapy`, hashed, in the vault roster); `therapyTake` returns it with `traded`/`prize`
  cleared and `rehabilitated`/`redeemed` set. Rehabilitated: not traded any more (obeys), ×2 exp.
  Redeemed: ×3 exp and ×3 effort (battle.ts, after the Lucky Egg). Both flags hashed per creature;
  integrity still counts them as traded/prize for tournament warnings. Tags on the stat screen.
- **Egg Insurance** (`egginsurance`, breeding item, price 0) sold only by the `egg-insurance`
  salesman (kind `insure`, Hearth) for ¤50,000 via `buyInsurance`. Applied at the daycare, an
  incubated egg hatching with no shine and no colour pays out a Glitter or a Chroma Candy (seeded by
  the hatchling's uid); notice `hatched.payout`.
- **Mart gates** (`MART_GATES`, `martGateRefusal`, `highestLevel`): ≤¤1,000 always; ≤3,000 at
  level 15 or 1 badge; ≤8,000 at 30 or 3; ≤20,000 at 45 or 5; above at 60 or 7. `buyRefusal`
  enforces it, so the Mart greys locked stock with the requirement. I12/I15 now stand past the gates.
- **Chroma Lens** `LENS_CHANCE` 0.2 → 0.1; blurb, BR26/BR27 follow.
- Both new people are lodger kinds and service inputs, map-hover services, and Doomscroller posts.
  Tests: `tests/therapy.test.ts`.

## The social media cabin (folded into 37)

- Placement `{ at: "socialCabin", spot }`: one cabin interior picked by `rngFor(seed, "social-cabin")`
  holds both people. SO1.
- **Skye (@skye.irl)**, kind `influence`: `influenceLeave {index, confirm}` for a creature with
  `fameWorth` > 0 (shine rungs + 2 for a colour + 1 per ability), `influenceTake` adds the steps to
  `Individual.fameSteps`. `fameLevel`: Famous N once `fameSteps × worth ≥ 10,000 × N(N+1)/2`, i.e.
  10k, then 20k more, 30k more… (150k in all for Famous 5), up to 5. `state.influencing` (hashed,
  vault roster). Leaving the stream's creature with her ends the stream.
- **xX_Stream_Xx**, kind `stream`: `streamRegister` a Famous ≥ 1 party member for the ¤10,000 stake
  (`state.stream = { uid, pool }`, one at a time). `streamStep` takes 1 from the pool per step;
  `streamed` (in `battleTurn`) adds `STREAM_EARN[fame−1] × level` for every foe knocked out that
  turn and takes `STREAM_FAINT[fame−1]` if the famous one faints — only while it is on your team in
  that battle. Below 0 the stream ends (notice `streamBroke`, pool lost). `streamCollect` takes out
  everything above the stake; `streamUnregister` takes the whole pool and stops.
- Both are lodger kinds, map-hover services and Doomscroller posts; FAMOUS N tag on the stat screen.
- Fixed on the way: `tutorTake` had been clearing `state.therapy` (a stray line from the therapy
  patch). SO6.
- Tests: `tests/social.test.ts`.

## The pageant cabin (folded into 37)

- `src/engine/pageant.ts`: `pageantField(seed, round)` — 15 contestants rolled like 16-player
  tournament prizes, levels 1–75, 30% holding a pageant item; `round = floor(stepsTaken / 2500)`.
  `pageantScore` = level + 40·rung + colour (`CHROMA_SCORE`: Ivory 100, Onyx 90, Teal 80, Umbral 70,
  Static 60, Tide 50, Ember 40, Verdant 30) + 20·ability + IV total + the best matching pageant item.
- Ten pageant items (`PAGEANT_ITEMS` in carry.ts, effect `{ t: "pageant", types, bonus }`, 50–200,
  one or two types, sold at the Mart for 4,000 + 20·bonus, so behind its gates).
- Placement `{ at: "pageantCabin", spot }`: a seeded cabin, never the social media one.
- **Pageant Host** (kind `pageant`): `pageantEnter {index, confirm}`, one entry per round
  (`state.pageantEntered`); a score above the round's best wins `ribbon: true`. Talk panel shows the
  line-up best first, click for the sheet and how the score adds up.
- **Ribbon**: on arrival, `RIBBON_CHARM` (30%) to drop the other side's Attack a stage (event
  `ribbon`, narrated).
- **Paparazzo** (kind `photoshoot`): `photoshoot {index, confirm}` on a Ribbon winner (refused if
  locked) pays ¤100,000, clears the Ribbon and sets `burnedOut` — experience ÷ 10 (min 1).
  Dr. Couch now also takes a burned-out creature and sends it back "Recovered".
- The request named this person "BIG FAN" paying for a "private session" that leaves the creature
  "Traumatized"; that framing was not used. The mechanic is the same.
- Tests: `tests/pageant.test.ts`.

## Swap abilities (folded into 37)

- Fifteen `swap-*` abilities (`SWAP_PAIRS` in abilities.ts, effect `{ t: "swap", types: [a, b] }`):
  Green Fire (Grass⇄Fire), Boiling Tide (Fire⇄Water), Frozen Spark (Electric⇄Ice), Falling Stone
  (Rock⇄Flying), Iron Brawl (Fighting⇄Steel), Haunted Mind (Ghost⇄Psychic), Night Bloom
  (Dark⇄Fairy), Tainted Soil (Poison⇄Ground), Dragon Frost (Dragon⇄Ice), Hive Mind (Bug⇄Normal),
  Charged Surf (Electric⇄Water), Quicksilver (Steel⇄Psychic), Wild Wind (Grass⇄Flying), Spirit Fist
  (Ghost⇄Fighting), Sweet Venom (Poison⇄Fairy).
- `swappedType(abilities, type)` applied in `executeMove` last (after Electrify/Ion Deluge), for
  damaging moves only, and in `landsAs` so the move buttons promise the right effectiveness. The move
  button shows "grass → fire". The creature's own types, and so its STAB, are unchanged.
- They join the roll (`ABILITIES` is 196), so rolled abilities differ from here on. docs/abilities.md
  has a table; docs/abilities.txt regenerated. Tests: `tests/swaps.test.ts`.

## Social perks (folded into 37)

- Fourteen `social-*` abilities, effect `{ t: "perk", perk }`, read through `hasPerk(creature, perk)`:
  Celebrity (stream earnings ×5), Renowned (×2; the larger wins), Drama Queen (no pool loss when it
  faints on stream), Low Bandwidth (no per-step stream cost), Pretty (pageant IVs ×5), Photogenic
  (+150 on stage), Trendsetter (shine rungs 80 on stage), Colour Coordinated (colour ×2 on stage),
  Humblebrag (pageant item bonus ignores type), Stage Presence (Ribbon charm 60% and −2 Attack),
  Viral (fame steps count twice, `fameRate`), Thick Skin (no Burned Out from the photoshoot),
  Paparazzi Magnet (photoshoot pays ×3), Comeback Story (therapy free, `therapyPrice`, and a tenth of
  the steps). They join the roll (`ABILITIES` is 210). docs/abilities.md has a table;
  docs/abilities.txt regenerated. Tests: `tests/perks.test.ts`.

## Wild battles give your items back

Thief, Covet, Trick, Switcheroo and Bestow in a wild battle used to be permanent, so a wild Thief could take a Lucky Egg for good. `wildItemsBack` (battle.ts) now returns what the player lost when the battle ends and takes it back off the wild creature (and off a caught one); what the player stole from a wild creature is kept. Folded into ENGINE_VERSION 37. Test LM13b.

## Arena cooldown

Winning an AI bracket (taking its prize) closes that arena for `ARENA_COOLDOWN` = 3000 moves, per arena, stamped in `state.arenaWon`. Losing costs nothing. `arenaWait` / `arenaRefusal` give the reason the Enter button shows. Folded into ENGINE_VERSION 37. Test in W34.

## Starters tripled

Starter shine (21/1000 shiny, tint rungs [18,12,9,3]), chroma (105/1000), held item (`STARTER_HELD_PER_MILLE` 300) and abilities (`STARTER_ABILITY_ODDS`: one 30%, two 6%, three 1%); shine ladder shiny 1%, Nearly 1.5%, Turning 2%, Washed 2.5%, Faded 3% are all three times what they were. Every seed's starters may differ, so folded into ENGINE_VERSION 37.

## Shapers and the foreman wander

The Colour Collector, the Ability Tutor and the Workshop Foreman were fixed in town-3 (Sanchford). They are now `{ at: "wander", maxRing: 2 }` like the Auctioneer, Ivo, Marv and Hessa: a town or a ring 1-2 route picked per seed. Folded into ENGINE_VERSION 37.
The Pawnbroker, Gift Swapper and Dr. Couch (therapist), fixed in town-1 (Southpass), wander the same way.

## Every evolution

The 84 manifest evolutions that were neither a plain level nor a stone (trade, levelHold, levelFriendship, levelMove, levelExtra, other) now have rules in `src/engine/evolutions.ts`: trades = Linking Cord (used like a stone), trades with an item and levelHold = level-up holding it (item used up; Linking Cord also works while holding), friendship = level-up holding a Soothe Bell (kept; Eevee also needs a Psychic/Dark/Fairy move), levelMove = knowing the move, the rest = nearest equivalent (a move, an item, a level). 15 new evolution-only held items and 6 new stone-kind items (Linking Cord, Peat Block, Strawberry Sweet, Scroll of Darkness, Scroll of Waters, Gimmighoul Coin), all on Mart shelves. `evolveRefusal` refuses an offer whose held item or move went away. Folded into ENGINE_VERSION 37. tests/evolutions.test.ts guards coverage.

## Moxie family

Moxie worked (checked: +1 Atk on a KO, kept for the next foe); its log line now names the ability before the rise. Four siblings added as singles: Grim Neigh (SpA), Trophy Hide (Def), Victor's Calm (SpD), Bloodrush (Spe). ABILITIES 214, singles 95. Adding to the roll changes every rolled ability: folded into ENGINE_VERSION 37.

## Caves

`src/engine/caves.ts`: `digCaves(seed, routes)` runs in `generateWorld` after `wireBorders` and after the names. Three caves (`CAVE_COUNT`), three floors each (`CAVE_FLOORS`), 56x36, kind `"cave"`, biome `"cavern"` (not in BIOMES; `typesFor`/`nameOf` special-case it, palette in render/tiles.ts). A floor is a jagged corridor (`carveLine` waypoints) with 3-5 grass chambers, not a maze. Ring = entry ring + floor, which drives both the encounter table and the levels. Mouths are cut into the entry route and into the diagonal routes the bottom floor opens onto (`TILE.STAIRS`, plus a SIGN on a solid neighbour). Caves are dark without Flash, refuse Fly, and carry no trainers, pickups or critters. `world.caves` lists them. ENGINE_VERSION 38. tests/caves.test.ts.

## The fight club

NPC "Tyler" (`fight-club`, kind `fightclub`, wander maxRing 2). `clubEnter`/`clubFight` inputs (pack 75/76), `state.club = { round, slot }`. A bout pulls a random standing party member out at `slot`, stands it on side 1 against the rest (tag `club:`), and the battle-end path splices it back into its slot before deciding anything, so nobody is lost and the holder winning is not a whiteout. `CLUB_PURSE` 900 a bout, `CLUB_BONUS` 2500 when only one is left standing. Notices clubRound/clubDone. ENGINE_VERSION 38. tests/fightclub.test.ts.

## The auction bids back

A lot opens at `AUCTION_OPENING` 30% of its price and climbs: every `AUCTION_TICK` 200 steps the room raises by `AUCTION_RAISE` 10% with chance `keenness = AUCTION_KEEN (233) * price / ask` per mille (78% at the open, 23% at the price). Because the chance is inverse to the ask, the expected gain per tick is a flat `AUCTION_DRIFT` = 70/30 of a percent of price, so the 70 points from the opening to the price are walked across the 30 ticks of a lot's life: E = 100% at the hammer, median 94%, p90 125%, and about half of all lots hammer over the price. `askingPrice(seed, n, steps)` walks it forward; `bidWins` is gone — a bid wins iff the ask at the close is still what you put down. Re-bidding is allowed once outbid and costs only the difference. ENGINE_VERSION 38. tests AU4b/AU7/AU8.

## Ditto

Egg groups are now the only rule a Ditto is exempt from: gender applies to it like anything else (so male Ditto + male partner is refused), and two Dittos are a legal pair (they share the Ditto group). A Ditto in the FIRST slot gives a Ditto egg `DITTO_EGG_PERCENT` = 20% of the time; from the second slot, never. The roll is only drawn when there is a Ditto in slot one, so every other pairing deals the eggs it always did. ENGINE_VERSION 38. tests BR8/BR11/BR20.

## Lodger badges

GameCanvas draws a small plaque over the door of any guest room with a lodger (`state.lodgers[door.to]`), in that NPC kind's colour from NPC_COLOURS — so the ten identical terrace doors say who is behind each. Display only.
The same colours are used on the node map: `peopleOnMap` now keeps each person's kind, and RegionMap draws up to six beads in a ring around any place where you have met somebody who runs something (hover names them). NPC_COLOURS moved from GameCanvas.tsx to src/render/people.ts so both read one table; tests/cup.test.ts reads the new path.

## Fly shortcut

A Fly button beside Fish above the bag. The page holds `openBagItem = { item, at }` and BagPanel takes it as `opened`, opening that item's panel (the fly map) in an effect keyed on the object — so pressing it again reopens after closing. Disabled without `hm-fly`. Display only.

## Traders take any form

`matchesWant` compares dex numbers rather than species ids, so Mr. Vane takes any of the eleven Pikachus (Alola, Cosplay, the caps, the partner) but not a Raichu, and every other `wants` entry follows suit. ENGINE_VERSION 38 (a trade that used to be refused now goes through). tests SW2b/N10.
Arena hosts on the node map read "Odds (1v1)" — the format, not just the name, since their names say nothing about which of the six they are.

## Doomscroll

Three buttons on the feed — "A bit" 100, "A little more" 500, "Just one more" 1000 (`DOOMSCROLL_STEPS`) — run `walked()` that many times without moving: eggs walk, the daycare pairs, poison bites, lures burn, cooldowns run, the stream pool drains. No encounters, since nothing is walked into. Input `doomscroll` (pack 78), `doomscrollRefusal` needs the item, the field and nobody talking. ENGINE_VERSION 38. tests/doomscroll.test.ts.
The Pokédex card always draws the selected creature at 96px — as yours (shine, colour, marks) where you hold one, plain where you have only met it; it used to draw nothing at all for a species you had seen and not caught.

## The feed (news, part one)

`src/engine/news.ts`: lines picked with `rngFor(seed, "news", kind, at)` from per-kind template lists, blanks filled from the creature (`{name} {type} {level} {badges} {steps}`). `state.news` keeps `NEWS_KEPT` 40, written by the funnel step `reported(world, before, state)` — it reads the notice that just appeared (caught/hatched/evolved/badge/whiteout), a party member crossing one of `NEWS_LEVELS` (50..100), and otherwise an idle line after `NEWS_QUIET` 400 quiet steps. In the hash. UI: corner toast in page.tsx for `NEWS_TOAST_MS` 6s with a Mute button (`pkm-fever.newsMuted`, browser-side; the feed keeps writing), and a News tab in the Doomscroller beside Timers. ENGINE_VERSION 38. tests/news.test.ts. PART TWO (friend room codes over the Nostr relays in lib/relays.ts) NOT STARTED.

## Friends feed (news, part two)

`src/lib/friends.ts`: `joinFeed(code, who, handlers)` over `joinParty(code, "feed", ...)` — Trystero/Nostr, same transport as duels. Broadcasts `{t:"news", who, at, kind, text}` whenever `state.news` gains a line (page.tsx watches the newest and sends once); receives into page state + localStorage (`pkm-fever.friendsPosts`, 60 kept; code in `pkm-fever.friendsCode`). NOTHING received touches the engine or a save — it is a claim about somebody else's game, shown only in the Doomscroller's Friends tab (code box, Start a room, Leave, who is here). News kinds trainer/traded/prize added so beating a trainer, a trade and a won creature are worth sending. Verified across two browser tabs on one relay room.
The box sorts by egg group too (alphabetical by a species first group), which puts everything that can breed together together.

## Fishing costs steps

A cast runs `walked()` `FISH_STEPS` = 8 times before the battle starts, so a pond is no longer free training: eggs, the daycare, poison, lures, the auction board and every cooldown all advance. ENGINE_VERSION 38. Test I17.
F casts the rod from the field, ignored wherever `fishRefusal` would refuse it.

## Pokedex zones

RegionMap takes `onSelect`/`selected`, which makes every place clickable (no green ring) and rings the chosen one in warn. DexPanel uses it: clicking a node shows `Zone` under the map — the route table once earned (`DEX_REVEAL` 10 encounters), each species drawn as caught/seen/never-met, with "caught X of Y" and a seen count; before that it says how many more encounters it wants; towns and unvisited places say so. Clicking a species there selects it in the list. Display only.

## PP followed the slot, not the move

`setMoves` replaced `moves` and left `pp` alone, so rearranging or swapping in the Centre handed the old slot's uses to whatever moved in — a 5-PP Hyper Beam could read 40/5. It now goes through `alignPp(next, creature)`: a kept move keeps what it had left, a new one arrives full, everything capped by its own max. ENGINE_VERSION 38. Test P11.

## The hunter and the berry farm

**Bex** (`hunter`, kind `hunt`, wander maxRing 2): `src/engine/hunt.ts` derives a board of `HUNT_OFFERS` 5 from the seed and `huntRound` (`HUNT_ROTATION` 1500 steps), every one bred `HUNT_IV_MIN` 20+ in every stat with 1-2 abilities, each with a route it was last seen on. `huntTake` sets `state.hunt = { offer, since, walked }` (one at a time); the quarry walks a `roamPath` loop (cached by seed/route/since; `roamPath` is now exported from world.ts), steps away from you `QUARRY_CHANCE` 900/1000 of the time, is drawn on the map like a critter, and meeting it is walking onto its tile. `HUNT_STEPS` 800, run down inside `walked()` so fishing and sittings with the feed count against it. Inputs huntTake/huntDrop (pack 79/80).

**Old Pell** (`berry-farmer`, kind `farm`, meadow-1): `src/engine/farm.ts`. Three jobs - water/ground/grass, each wanting that type - and nothing grows until all three are filled. `FARM_BASE` 350 steps between harvests less the three levels added up, floor `FARM_FASTEST` 25; each harvest is `FARM_YIELD` 5 of one bed's berry, or any berry in the game when that bed is fallow. `FARM_BEDS` 5, and planting spends the berry. The basket accumulates and is only emptied by `farmCollect`. Inputs farmLeave/farmTake/farmPlant/farmCollect (pack 81-84). Both on ENGINE_VERSION 38; tests/hunt.test.ts, tests/farm.test.ts.
The box search also looks at ability names (placeholder now "Search name, type or ability..."), which is the one thing a full box cannot be read for at a glance.

## Day and night

`src/engine/daynight.ts`: `DAY_LENGTH` 10000 steps - day 4000, dusk `TWILIGHT` 1000, night 4000, dawn 1000. `timeOf(steps)` names the phase, `darkness(steps)` is 0-1000 and slides a thousandth per step across each twilight (nothing ever moves it more than 1 per step), `untilNext` for the HUD tooltip.

Encounters read it through `wildAt(..., stepsTaken)`: `isNightish` (darkness >= 500, so the night plus the darker half of each twilight) drops the encounter band by `NIGHT_BAND` 1 ring - commoner species - and pays for it with `NIGHT_ODDS` (the wild ability odds x3, in abilities.ts) and `NIGHT_CHROMA_PER_MILLE` 60 for a colour the census did not place. Fishing and the rest pass the step count too.

Ten `hour-*` abilities (ABILITIES 224, docs/abilities.md "The hours"): effect `{ t: "hour"; at: TimeOfDay[]; stat: "power" | StageStat; mille }`, applied in `damageOf` for power and in `effectiveStat` for stats. `BattleState.hour` is written once by `startBattle(..., stepsTaken)` - a battle keeps the sky it began under, so nothing shifts mid-fight; the field is optional so older battles read as daylight.

The map takes a blue wash scaled by `darkness` (routes and towns only, capped at 0.55 alpha so the ground stays readable), under the fog of war; the HUD shows the phase beside the hash. ENGINE_VERSION 38. tests/daynight.test.ts.

## Abilities you already have

`ownedAbilities(state)` (engine.ts) collects every ability id carried by anything you hold - party, box, daycare, workshop, farm hands, tutor pupil, couch, influencer. The Handbook's Abilities tab marks each entry with `AbilityMark` (exported there): a green tick for one of yours, a yellow angle for one nothing of yours has, plus a count in the blurb. The same mark is drawn beside each ability on a StatHover sheet when it is given `owned`, which the battle passes - so a wild creature's sheet says at a glance which of its abilities are new to you, the way the dex ball says whether the species is.

## Lost property

**Miss Vell** (`lost-property`, kind `lost`) stands in Hearth at (20, 22). `state.lost` is a ledger written by `mislaid(state, itemId, count)`, called wherever something leaves by a road that is not *using* it: sold at a Mart, carried off by a creature you traded away, planted in a farm bed. A potion drunk or a berry eaten is spent, not lost, and is never written down. `reclaim` (pack 85) hands one back for `reclaimPrice` = max(`RECLAIM_FLOOR` 250, the item's sell value); the line clears when the count runs out. In the hash. ENGINE_VERSION 38. tests/lost.test.ts.

## IVs roll off a table now

`IV_WEIGHTS` in stats.ts: 32 integer weights out of 1,000,000, shaped as a stretched exponential `exp(-(k/10.467)^1.72)`. Mean exactly 6, P(31) = 0.016%, nothing capped. `rollIv(rng)` / `rollIvs(rng)` take one draw per stat, so every creature costs the six draws it always did and nothing downstream shifts. Wild creatures (`rollWildIvs`, `rolledIvs` in world.ts) and starters (`offeredStarter`) both use it; starters were a flat 0-12, wild a flat 0-6, both averaging 6. `WILD_IV_MAX` stays as the number breeding measures itself against. The schoolteacher's lesson and the anti-scum ceiling test were rewritten for a world with no ceiling. ENGINE_VERSION 38. tests/ivroll.test.ts.

## The Mart, tidied

A search box beside the purse looks through every shelf at once (name, blurb and shelf label, word by word, the same rule the bag and box search by); the heading counts the hits, each shelf tab shows how many of them are on it and is flagged `hasHits`, and clicking a tab clears the search and opens that shelf. "Your bag" - the sell list, which was every item you own in one flat grid - is folded away behind a button and obeys the same search. MartPanel.tsx, plus the `.mart` rules it never had in globals.css.

## Tim's trading post

NPC **Tim** (`trader`, kind `post`) stands in Hearth at (26, 12); walking into him opens `TradePost.tsx` (the page renders it on `state.talking === "trader"`).

The board rides the friends room code on its own channel - `lib/post.ts`, `joinPost(code, who, handlers)` over `joinParty(code, "post", ...)`. Messages: `board` (a peer's whole list, re-sent on every join and change), `bid`, `pull`, `struck`, `declined`. Nothing about it is state: listings live in the lister's browser and go when the tab closes.

Two tabs: **Yours** (pin a party member up with an asking price and a line about what you want; see and answer bids on it) and **Theirs** (everybody else's listings, with the full stat sheet, and an offer builder - cash, one of yours, or both). Accepting opens a dialog spelling the whole deal out before anything happens.

The swap itself is the `postDeal` input (pack 86): `{ give, receive, paid, who }`, any part omittable, applied by each side to its own save. `postDealRefusal` checks what it can - you have the creature, it is not locked, you can cover the money, you keep something that can fight - and the arrival is rebuilt through `vaultArrival` keeping its level. A held item on the one you hand over goes to lost property. What it cannot check is whether the other side really applied theirs, the same limit the duel and trade rooms have.

Verified live between two browser tabs: listing crossed, bid crossed, dialog read "you give Treecko, you receive Chespin, you take 1,500", and both saves applied their half. That run exposed one bug (the bidder never recorded its own outgoing bid, so its creature stayed) - fixed with `sentBids`, which is NOT re-verified in the browser. ENGINE_VERSION 38. tests/post.test.ts.

## Difficulty

Five presets, chosen on the start screen (and in the vault screen, which has no start screen of its own) and never again: `setDifficulty` is an input, pack 87, legal only while the phase is still `starter`. It lives in the log like the trainer name, so a save replays at the difficulty it was played at and cannot be turned down halfway. `state.difficulty` is always a real id; anything unknown reads as Normal, which is why every log written before this replays untouched.

Everything a preset does is a number in `src/engine/difficulty.ts` that some other part of the engine already read - no new systems, and nothing that changes what a move does. Gym leaders: base level, levels per badge, extra bodies, IVs, **effort**, a held item and the odds they were born with abilities (the wild odds on Normal, nothing without one by Fever Dream). Route trainers: levels, extra bodies, IVs, **effort** and a held item. The world: wild levels, what a purse is worth, what a ball is worth and what a whiteout costs. A Centre is free on every preset and always will be - a fee at the counter is a run a broke player with a fainted party cannot continue, which is a softlock rather than a hard mode. A share of your money when you go down cannot strand you the same way, because it cannot take what you do not have.

The effort is `effortFor(base, budget)` - the Cup's spread with a budget dial on it: 252 into the species' best stat, 252 into its second, the remainder into its third, derived from base stats rather than authored. Brutal spends 252 on a gym's creatures, Fever Dream the full 510. A trained team is a wall you climb by building one of your own, which is a better question than the one levels ask.

Two knobs reach outside the engine. Wild levels go through `wildAt`/`fishAt` as a trailing `harder` argument added *after* the roll, so the grass holds the same creatures on every preset and only their levels move. Catch odds ride on `BattleState.catchMille`, set by `startBattle` at the wild-encounter call sites, and applied inside `ballMultiplier` - after the Master Ball has already returned null, because "always" is not a number worth scaling.

Not built, and deliberately: the optional rules from the original proposal (level cap by badges, Set mode, one catch a route, faint is final) and any change to the experience curve. The rival, the arena and the Cup field what they always did. tests/difficulty.test.ts.

## Loadouts

A tab at the end of the box's tab row - **⚔ Loadouts** - holding arrangements rather than creatures. `Save party` writes down who is in the party, in what order, with their moves in which order and what each one is holding; `Load` puts that arrangement back; the `✕` forgets it. Eight at most, named or numbered (`Team 3`).

A loadout stores **references and nothing else**: uids, move ids, item ids. `Loadout` in engine.ts says why - a stored creature would be a second source of truth about that creature, and every bug in this engine worth remembering has been two copies of one fact. So what comes back is whatever those uids name *now*: one that has levelled or evolved comes back as it is, and one released, traded or shipped off is skipped and counted (`missing` on the notice), never conjured.

Loading is deliberately forgiving, because a button that silently stops working is worse than one that does four of six things: anything gone is skipped, anything that will not fit (eggs hold party slots) is left where it is, and whoever was in the party but is not in the loadout goes to the box - `shelved` finds them a tab as usual. It refuses only when nothing in the loadout is still with you.

Two details worth knowing. **Moves** are restored as a permutation of what the creature knows *now* - saved order first, anything learned since on the end - so nothing is taught or forgotten here, which is why this is clear of the rule that moves are rearranged in town. The uses travel with the move through `alignPp`. **Items** go back to the bag before the wanted one comes out (the order `setHeld` uses, so asking for the Leftovers it is already holding cannot mint a second pair), and an item that has since been sold or handed to somebody else leaves the creature carrying whatever it has: a loadout is a note, not a claim on the bag.

`saveLoadout` / `loadLoadout` / `dropLoadout`, pack 88-90, refusals `saveLoadoutRefusal` and `loadLoadoutRefusal`. tests/loadouts.test.ts.

## The vault's party

`VAULT_TAKE` is `PARTY_LIMIT` - a Vault Adventure sets out with as many as a party holds, and the engine no longer has a limit of its own. It was three, on the argument that a run opening with six has nothing left to fill; that is the player's argument to make about their own run. Everything else about a vault arrival is unchanged: level five, no effort, moves for level five, the vault mark.

## The feed and the grass

Every wild win used to write a feed post, and write it under `trainer` - so crossing one route filed thirty posts, each saying "a trainer has been beaten", and each one shouted at your friends through the feed room. Meanwhile an actual route trainer wrote nothing, because beating a person emits `beatTrainer` (they pay a purse) and only the grass ever reached the plain `won` branch.

Now `reported` looks at the tag. `WILD_TAG`/`TREE_TAG` bump `state.wildsFought` and say something every `NEWS_WILD_EVERY` (30) - a new `wild` kind with its own lines, which quote the running count via the `{count}` blank. `beatTrainer` gets the `trainer` line, which is what those lines were always about: a route trainer, the rival, one of the Cup. Anything else wearing a plain `won` - a roamer, a gym beaten a second time, a round of the fight club - says nothing at all, because it has no line of its own and silence beats filing it under somebody else's.

`wildsFought` is a tally on the save, not an event. tests/news.test.ts NW5.

## Subscribing, from the start

The room code was only reachable through the Doomscroller's Friends tab, which is an item you find hours in - a poor gate for the one feature that is about playing alongside somebody. The row now lives in `src/components/FriendsRoom.tsx` (`FriendsRoom` + `roomStatus` + the `FriendsFeed` type, re-exported from Doomscroller.tsx for its old importers) and is used in two places: that tab, and a **Subscribe to a friend** button under the node map in `MiniMap`. Subscribed, the button reads `Friends - CODE` with the number of others on it.

The page builds the room object once (`friendsRoom`, memoised) and hands the same one to both, so they cannot drift and typing in one does not re-render the other's list.

**Several rooms at once**, up to `FRIENDS_ROOMS_MAX` (5): friends are not one group. Each code is its own feed swarm *and* its own board swarm, with its own status and head count, tracked in `Map<code, Room>` refs that the effects **diff** rather than tear down - adding a fourth room must not drop the three that took ten seconds to form. A join in flight holds a `PENDING_FEED`/`PENDING_POST` placeholder in the map so a second render cannot open the same code twice, and a room that lands after its code was dropped leaves immediately.

Posts and listings carry the `code` they arrived on. That is what makes an answer go back the way it came: `onBid` sends through `postRooms.get(listing.code)`, `strike`/`decline` through `postRooms.get(bid.code)`. Boards are keyed `code:peer`, so leaving a room drops exactly its listings. What you pin up is shouted to every room you are in, and a room joined later is caught up on join.

The codes persist comma-separated under the same `pkm-fever.friendsCode` key, so a browser that remembered one room before this reads back as a list of one (`readFriendsCodes`/`writeFriendsCodes`/`cleanCodes` in lib/friends.ts).

## Milestones that reach your friends

Three bugs, one symptom - a party member crossing level 50 never showed up on anybody else's feed.

1. **`reported` returned on the first thing it found.** One input can be two pieces of news: you beat something in the grass and the experience for it takes somebody past fifty on the same input. The win returned, and the fifty - the rarer and by far the more interesting of the two - was never written at all, on your own feed or on your friends'. It now builds a list of lines and appends all of them, with the level check first because that is the one that was being lost. The wild tally is kept whether or not the line is written.

2. **The page sent "the latest line, once per step count."** A battle does not move your step count, so a second line in the same fight looked like one already said. It now remembers the line itself and sends everything after it. A `said` pointer that does not match the feed (first pass, a loaded save, a room joined just now) sets the mark and sends nothing, so a reload no longer re-announces the last line to everybody listening.

3. **Arriving posts were invisible unless you owned a Doomscroller.** A friend's line now pops up in the same toast strip as your own, stacked above it, under the same mute. The "is this the first pass" test is its own flag rather than "was there a post before this one" - the same thing only when there *was* one, so a browser subscribing for the first time swallowed the first line a friend ever sent.

Verified across two tabs on one code: level 60 for Bulbasaur toasted locally and arrived as a toast on the other tab, and a reload of both sent nothing. tests/news.test.ts NW6.

## The trade that never completed

Both screens stuck on "Waiting for them...", and the transport was innocent - the offers crossed fine, which is why each side could see the other's creature.

`pairKey` in trade.ts identifies the pair being agreed to, so an acceptance cannot be reused for a different one. Both sides have to compute the same string, and each holds the two creatures the other way round, so it ordered them **by uid**. A uid is a save's own counter: two players who each picked a starter are both holding uid 1. On that tie each side put its own creature first, the two keys never matched, neither acceptance settled, and the trade sat there until somebody gave up.

The two stamps are sorted now, which is side-independent whatever the uids are. Every trade test had passed because the first one written gave the two sides uids 1 and 2, and every test since inherited it - tests/pvp.test.ts P3b is the one that holds a uid 1 on both sides (and a pair of identical creatures, where the two stamps are equal).

## Event forms can finish

A handful of species in the manifest are one species wearing something: a spiky-eared Pichu, ten Pikachus in hats, the partner Eevee, AZ's Floette. The games make these one-offs that cannot evolve at all, and `evolvesTo: []` recorded that faithfully - which in a game about raising things is a creature you can catch and then never finish.

`FORM_BASE` in dex.ts fills each one in from its ordinary form, derived rather than listed: same dex number, id is the base's id with something on the end, longest such base that evolves. Thirteen of them today, no species named, so a rebuilt roster brings its own. The entries are filled **in place** - the one mutation of the loaded manifest in the engine, because `evolvesTo` is read from a dozen places through `speciesById` and a second corrected copy would be a second truth. `EVOLUTION_RULES` appends the same rules again keyed on the form, so a spiky-eared Pichu wants the same Soothe Bell an ordinary one does.

The other direction is left alone on purpose: Kantonian Farfetch'd, Mr. Mime, Qwilfish, Corsola, Linoone and Basculin have no evolution while their regional cousins do. That is the games being interesting rather than an omission, and the rule never fires on them because there the *base* is the one with nothing.

`evolvesTo` is read by the auction's exotics and legends, the starter pool and the prize bench, so filling one in is a change to what a seed deals. Measured before and after: none of those pools moves, because every form here is either in the Undiscovered egg group or grows into something the pools already weighed. **EV10 is the test that says so out loud** - the day a new form does move a pool is the day a save stops replaying, and it should fail loudly rather than quietly reshuffle somebody's auction. No version bump.

## Who a line is from

Every line arriving at a friend's feed said "Somebody", whatever the sender was called.

`joinFeed`/`joinPost` took the trainer name as a string and closed over it. A code remembered in this browser is rejoined **as the page loads** - before a save has been continued and before a trainer has a name - so the name read at that moment was null, the fallback stuck, and it was "Somebody" for the rest of the sitting. Both now take `who: () => string` and call it when a message is sent; the page passes a callback over `stateRef`, which is the one thing in the page that is always current.

The board had it too, on `board`, `bid` and `struck` - the same join-time name, which is why a listing could show up under "Somebody" while the bid on it showed the right name (the page fills that one in at click time from live state).

## A catch that names the right creature

The feed announced one of your own whenever you caught something with anything in the box.

Every arrival line in `reported` found its subject as "the last of the party and the box laid end to end" - which is the caught one only when the box is empty, or when the party was full so it went to the end of the box. Catch something with room in your party and a box that is not empty, and the line named the last creature *in the box*: one of yours, caught weeks ago.

It now takes the uids that were there before the input and names what is there now and was not. A uid is unique within a save and an arrival always gets a fresh one, so it is exact rather than nearly right. The same fix covers hatching, trades (and swindles) and prizes, which all had it. tests/news.test.ts NW7.

## A face on the feed

A feed line about a creature now carries enough to draw it: `NewsItem.face` is `{ speciesId, variantId, heldItem }` and nothing else. Not a copy of the creature - the feed is a record of a moment, and a copy would go stale while the creature itself carried on levelling. Optional in both senses: half the lines are about nobody (a badge, a beating, the grass in general) and draw without one, and a line written before this existed simply has none.

`NewsFace` in Doomscroller.tsx draws it at 48px with no marks, and is used in four places: the feed toast, the friend toast, the Doomscroller's News tab and its Friends tab.

It crosses the wire too, so a friend sees what your line is about. Incoming faces go through `knownFace` first: a species id out of somebody else's browser is exactly the sort of thing that becomes a sprite URL, so an id this build does not have is dropped rather than handed to the loader, and the appearance goes through `variant()` like every other arrival. tests/news.test.ts NW8.

## Rooms that leave themselves

The feed and board effects carried a `live` flag that every re-run flipped, and a join still in flight when that happened resolved straight into `room.leave()`. React's development mode runs every effect twice on mount, so a tab that loaded with a code already remembered did this most times: join, flip, and tear down. Whether it cost you the working room or only a duplicate depends on what the transport hands back for a second join of one code, which is not a thing to be depending on.

The map of rooms is the only thing that decides whether a room lives now, and neither effect has a cleanup at all. A join in flight holds `PENDING_FEED`/`PENDING_POST`; when it lands it is stored only if that placeholder is still there, and otherwise leaves. A room is left in exactly one place - the loop at the top, when its code is gone from the list - and a tab closing takes the rest with it, which is what closing a tab does.

The `live &&` guards are gone from the handlers too, which fixes a smaller thing: after any re-run of the effect - adding a second room, for instance - every room joined before it had its head count and status frozen, because those closures were reading a flag that was now false.

Verified both ways between two tabs after a reload, which is the case that used to break: each side saw the other's line.

## Unmuting

The button that muted the feed lived on the toast, which is the thing being muted - so pressing it removed the only way to press it again. The way back was editing `pkm-fever.newsMuted` out of localStorage, which is not a way back.

One `muteNews` in page.tsx now owns the state and the key, and three buttons call it: **Mute** on the toast, **Feed: on / muted** in the run's footer beside Sound, and a toggle on the Doomscroller's News tab beside the line that explains muting. Note that muting covers friends' lines as well as your own - one switch for "nothing pops up in the corner" - and nothing stops being written either way.

## Evolving, in the handbook

A sixth tab, **Evolving**: the four translations this game makes (a trade is a Linking Cord, friendship is a Soothe Bell carried at a level-up, a move known is exactly that, and everything else gets the nearest honest thing), then every evolution in the game in one searchable table - from, into, and what it takes.

Derived from the same two places the engine evolves things out of: `describeSpecialEvolution` for anything with a rule, the manifest's own stone or level for the rest. The handbook cannot promise a door the game does not open, and EV11 is the test that keeps it that way - every step in the manifest has to be sayable in a sentence.

Writing that test turned up **Kleavor**, which was unreachable. The manifest records `scyther -> kleavor` as an item evolution and then names no item (the Black Augurite is not in the roster the dex was built from), so nothing could ever match it. EV1 had been skipping every `useItem` step without checking the item existed; it checks now, and Scyther has a **Black Augurite** to evolve with, alongside the Peat Block and the two scrolls that stand in for the same kind of gap.

No save impact: the new stone is not in `FOUND_STONES` (that wants a manifest door naming it, which is exactly what this one lacks), it is not a machine, and nothing else draws from the item list with a seed.

One thing fixed in passing, because the tab is searchable and it is the box you type in: `.boxSearch` carries `flex: 1 1 160px`, which inside the handbook's *column* header made 160px its **height** - a search box four lines tall, on the Abilities and Items tabs too.

## The only one you have

Offering a cash-only bid for somebody's last creature duplicated it. Accepting is two things - the swap, which the engine applies, and the `struck` message, which cannot be taken back - and the page did them in that order but never checked the first had worked. `dispatch` swallows an `IllegalInput`, which is right for walking into a tree and wrong here: the engine refused to take the last thing that could fight, kept it, and the message went out regardless, so the other side applied its half and helped itself to a copy.

`postDealRefusal` is now asked *before* striking, in two places. The page bails rather than sending the word, and `TradePost` asks it per bid so "Look at it" and "Deal" are greyed with the reason - the house rule that a dead control explains itself. It also closes a smaller hole: a second bid on a listing that has already been sold now says "that listing is gone" instead of striking again.

The refusal lost its unused `world` parameter so the panel can call it without one. tests/post.test.ts PT5 holds both halves: the engine still refuses, and the refusal is something a caller can ask for rather than something it finds out by being thrown at.

What this does **not** fix is the mirror case - a bidder whose money has gone by the time their offer is accepted - because by then the lister has already applied their half. That is the same limit the duel and trade rooms have and it is documented where `postDeal` lives.

## How many are at the board

The board's head count was the number of peers whose *board* we had received, not the number of peers present - and somebody with nothing up sends no board. So two browsers that had paired perfectly well both read "0 others at the board" until one of them listed something, which looks exactly like a room that never connected.

`joinPost` reports `onCount` now, off the transport's own peer list, in the same three places `joinFeed` does: on join, on leave, and on the `hello` a new arrival sends. The page keeps it per code and the panel sums it.

Worth remembering when this is reported again: the feed, the board and the duel/trade rooms are the same transport, the same relays, the same TURN config and the same `kind-CODE` naming, so there is no mechanism by which the internet can treat one differently from another. What *can* differ is the build each side is running - an older page never joins `post-CODE` at all, and a page older than the `pairKey` fix can never complete a trade between two players who each hold a uid 1. One stale tab on the other end explains both, and explains why the feed still works.

## Weather and terrain, in the handbook

A seventh tab. Weather, terrain, the two sports and the rooms, each with what it multiplies, what else it does, and what Weather Ball becomes under it.

The facts live in `field.ts` as `WEATHERS`, `TERRAINS`, `SPORTS` and `ROOMS` rather than as prose in the component - but a table beside a formula is a second copy of a truth, and the multipliers themselves are still literals inside `damage()`. So **W14 measures rather than compares**: for every `power` row it runs a real turn twice, once under the field and once under nothing, and checks the ratio. Porygon-Z into Chansey, because the swing has to be big enough that flooring a few points cannot be mistaken for the field, and Normal into Normal so nothing gets a same-type bonus or a resistance. W15 does the same for the terrains from the air, where a terrain should do nothing at all.

That is the guard worth keeping: the day somebody retunes sun from 1.5 to 1.4 in battle.ts, the handbook does not quietly keep promising 1.5.
