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

## Uncommitted (2026-09-15) — ENGINE_VERSION 36

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
  **Still missing** (need state the engine does not keep): Fury Cutter and
  Echoed Voice (consecutive-use counters), Stomping Tantrum/Temper Flare (last
  move failed), Lash Out (stats lowered this turn), Rage Fist (times hit),
  and item removal/theft — Knock Off's removal, Thief, Covet, Incinerate —
  which would need items restored after battle.
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
