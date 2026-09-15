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
