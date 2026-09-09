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
  during world generation, so every world holds exactly one true shiny, one
  shiny wearing a colour, and one of each of the eight chromas — findable and
  finite. Breeding is the second path, and the slow one.
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
Hearth into the grass. Arrow keys or WASD to move; in a battle,
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
tests/         166 tests, including the replay property everything rests on
```

Working: world generation and the census, the overworld — a town you walk
around and buildings you walk into, routes with meandering paths, woodland,
ponds and tall grass, and a camera that follows you — wild encounters, a
full single battle system — damage, the type chart, criticals, accuracy, stat
stages, five status conditions, drain, recoil and healing — plus catching,
experience, levelling, move learning, evolution, breeding, the box, save/load,
and **PvP over WebRTC** — battles at any size from 1v1 to 6v6, and trading.

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

### PvP

Battling and trading with other people happen **in town**, not from a menu, for
the same reason the daycare does: walking back is what makes walking out mean
anything.

Pick a format from 1v1 to 6v6, share a room code, and the two browsers talk to each other
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

Both players must bring the same number, and a mismatch is stated rather than
papered over — trimming the longer team would throw away creatures its owner
picked on purpose.

### Trading

The opposite secrecy to a duel. A duel hides each move until both are
committed, because seeing the other choice first wins the turn; a trade is the
reverse, since seeing what is on the table before you agree *is* the
transaction. Offers travel in the open and either side can withdraw until both
have said yes. An acceptance names the pair it is agreeing to, so nobody can
take your yes and quietly swap what they were offering.

Trading is also the one place the design's central claim gives way. A save is a
seed and a list of inputs, and replaying it is what proves a team was earned —
but a traded creature came out of somebody else's world, from a seed this save
has never seen, so the trade input carries it whole. The log still replays; it
just no longer proves that one. Arrivals are marked `traded` so a format can
decide whether it cares.

### Looking at a creature

Every party and box row opens a sheet with the whole picture: base stat, IV,
nature and EV in separate columns, then the total. That separation is the
point — three systems feed each number, and until you can see them side by
side there is no way to tell a well-bred creature from a lucky one, or to see
what a nature is actually worth.

Moves are chosen there too: any four of everything the creature has naturally
learned by its current level, rearranged **in town**. Being able to rebuild a
moveset in front of a wild creature would make every type matchup a formality.

A mark rides on the sprite wherever it appears — a star for the true shiny, a
diamond for a chroma, a numbered spark for each rung of the tint ladder. A
two-fifths tint of something already green is a colour you would have to have
memorised the original to notice.

### The world

A town at the centre, four biomes running outward from it, and further out
means higher levels and rarer things. Hearth is 40x28 with a crossroads, four
buildings, a fenced garden and four ways out; the routes beyond it are 44x34,
which is well past what fits on a screen, so the camera follows you and stops
at the edges. That is the point of the size: a place you cross rather than
take in at a glance.

Nothing on a route is placed by hand. A path meanders from the western way in
to the eastern way out, woodland clumps thicken with the ring, tall grass
falls in patches, a pond gets a sand rim, and a cabin sometimes sits beside the
path — then the two ways through are cut last, so generation can never seal a
route off. Which tiles you can walk on and which hide encounters are
properties of the tile, not of a coordinate, which is what let the hub stop
being a special case and become a town.

Every building carries a board beside its door saying what it is for, drawn
with its text over the map — four identical red roofs is a town you cannot
read. The sign goes beside the doorstep and never on it, which is a rule worth
writing down: a sign that blocked its own door would be a very good joke and a
very bad building.

The buildings are real. Stepping on a door tile puts you in the room behind
it, and the daycare and the trainers' centre are two of those rooms rather
than panels that follow you around. A room knows where its own front step is,
and the door outside asks it — wiring the two by hand put the player at a town
coordinate inside a 13x10 room, off the map and unable to move in any
direction, while every test passed, because the tests placed the player by
asking the room. `W17` asks the doors instead.

### The map

Two maps, because there are two questions. A scaled-down view of the map you
are standing on, with doors, unbeaten trainers and you marked on it, answers
"where am I here". Under it, a corridor diagram — a town with four arms, rings
along each — answers "which arm, how far out", which is the only thing
difficulty depends on and the thing a minified tile view hides. Unvisited
rings are drawn but empty: the shape of the world is not a secret, only what
is in it. Standing indoors lights up the town you are indoors in, because a
door is not a journey.

### Testing shortcuts

<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>Z</kbd> opens a cheat
menu: give any species at any level and variant, set levels and variants on the
party, heal, add balls, grant the breeding items, warp to any route.

Every one of them is an ordinary input rather than something that reaches in
and edits state. A cheat therefore lands in the save log, replays with it, and
sets `cheated` — so a save that used one says so, and the verification a
tournament runs at check-in catches it for free. A cheat menu that bypassed the
log would produce saves indistinguishable from honest ones, which is the
opposite of what this design is for.

### Effort

The other half of a creature's stats, and the half you choose. IVs are
inherited and bred; effort is earned by picking what to fight. Four points are
one stat point at level 100, capped at 252 in a stat and 510 overall — the
vanilla exchange rate, which `computeStat` was already applying to an effort
value nothing had ever awarded.

What a species is worth is **derived from its base stats** rather than carried
in the manifest. Showdown's dex has no effort yield to copy, and a table of
1,134 hand-authored numbers would be a lie dressed as data. A species pays in
the thing it is best at: 1, 2 or 3 points by base stat total, to its highest
stat, shared with a second stat within five points of it.

Shared with a second and no more. The amount is paid to *each* sharing stat,
so without a cap a flat species pays more in total than a specialist does —
Swinub has three stats level at 50 and was handing out three points where a
Machamp hands out three in one place. That is worse than it sounds: 510 is a
budget meant to be spent deliberately, and a creature that quietly fills it
with a spread nobody asked for is a trap rather than a choice.

Both caps are enforced where the effort is granted rather than where it is
shown. A creature carrying more than it should would compute one set of
numbers and replay as another.

### Looking at things

Hovering a creature — either side of a battle, or a starter card — gives
everything true about it: current stats beside base, IV, effort and the
nature's term, what beating it is worth, and what it knows. One component for
both, because "what am I looking at" is the same question in both places.

Nothing across the battlefield is hidden. A duel commits to a move before
revealing it, so reading the opponent cannot be used to cheat, and a wild
creature's numbers were fixed when the world was made. There is nothing to
protect by making a player guess.

### Party order

Slot one is who walks into the next fight, so the order is a decision rather
than tidying, and it goes through the input log like every other one. Arrows
rather than drag, because a drag needs a pointer and this has to work from a
keyboard too. Refused mid-battle: reordering with something already out would
be a free switch, and the battle system charges a turn for those.

### Breeding

The daycare is a building in Hearth that you walk into, rather than a menu you
carry — a deposit anywhere else is refused, because walking back is what makes
walking out mean anything. Leave two compatible creatures there, walk 120 steps, and
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

Gender gates a pairing before egg groups do: 49% male, 49% female, 2% Trans,
flat across every species. A Trans creature pairs with either gender, and with
another Trans — "works with both" has no reason to stop short of itself. Ditto
ignores gender entirely, as it ignores species.

The games this resembles give each species its own ratio, with some genderless
and some locked to one gender. That is a manifest field and a build-script
change rather than an engine one, and a flat split is a rule that needs
neither.

Twelve items make it faster. Three shape the stats and drop from any route at
ring 2, 4 and 6, so nobody can miss them; the other nine shape appearance and
are keyed to a *biome* as well as a ring, so each asks you to have been
somewhere specific rather than merely far. All of them are equipment rather
than stock: found once, then applied to a pairing for as long as you want.

### Inheriting an appearance

Shine and colour are two independent axes, so a shiny Tide is a real thing —
and breeding is the only way to aim at one.

**Shine** is a ladder of six rungs, and a child starts at the **average of its
parents**. Two true shinies always make a true shiny. A shiny and an ordinary
make something halfway; five rungs cannot be halved onto a rung, so it falls
either side with even odds rather than rounding one way every time, which
would make the matrix asymmetric and quietly punish one parent order.

On top of that sits **the climb**, shaped after Factorio's quality mechanic:
**1%** of children rise a rung they were not given, and a tenth of any climb
climbs again. From an ordinary pair that is 0.9% Faded, 0.09% Washed, 0.009%
Turning, and on down to a true shiny at odds nobody would plan around. It is a
floor under every pairing rather than a strategy — no lineage is ever
permanently locked out of the ladder. The **Prism** multiplies it by five.

**Colour** is carried, halved or contested. Two of a colour always breed that
colour. One of a colour is a coin flip. Two *different* colours give 40% to
each parent and leave a fifth spread over every colour, so a line can arrive
somewhere neither parent came from without being bred for it. A **lens** —
there is one per colour — then gets one chance in five to overrule the lot,
and is the only way to aim rather than wait.

The daycare shows the matrix for whatever is deposited. It is computed from
the same function the engine rolls against rather than tabulated beside it: a
published matrix that can drift from the code is worse than no matrix.

### Sprites

Loaded at runtime from [PokeAPI's sprite repository][sprites], which is served
with permissive CORS headers — that matters, because the variant pipeline
reads pixels back off the canvas and a host that omits those headers would
taint it and take every variant with it. Showdown's archive is the better art
and cannot be used for exactly that reason.

Two images per species, normal and shiny, and all 54 appearances are derived
from that pair. Shine is a position between the two; colour is a transform of
whatever that lands on, applied second — which is what makes a shiny Tide the
Tide transform on the shiny palette, exactly what the name says it is. Six of
the colours are hue rotations in OKLCh, holding lightness so contrast
survives; Teal *sets* its hue instead of turning it, because teal has to be
teal on every species rather than teal on some and olive on others; and Onyx
and Ivory move lightness in opposite directions while draining colour, because
no rotation reaches black or white — neither of them is a hue. Until they arrive — or with no network at all — a
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
- **Fifty-four appearances, on two axes that do not interfere.** Six rungs of
  shine — four tints and the true shiny at ×1.085 on every stat — times eight
  colours or none. Six colours are sidegrades (+10% to two stats, −3% to one);
  Onyx and Ivory spike harder and pay for it twice (+18% to one, −5% to two),
  because they are a different kind of thing visually and should be one
  mechanically too. The two axes fold into a single multiplier before the stat
  pipeline runs, so a stat is never floored twice and a shiny Tide is exactly a
  Tide shiny.

  The ×1.085 cap on shine is deliberate: a flat multiplier on every stat is far
  stronger than it feels, and at ×1.15 the true shiny would be worth more than
  the entire IV range, which would make the game a lottery instead of a
  breeding puzzle.

`tests/stats.test.ts` pins all of this against hand-computed numbers, because
if one of them changes, the game changed and every save replays differently.

### The census

Rare forms are not rolled at an encounter. World generation places exactly 58
special creatures at specific encounter slots — 40 tints anywhere, one of each
of the 8 colours and one tinted example of each out in the far third, the true
shiny out there too, and one **crown**: a shiny wearing a colour, on the
outermost ring, the colour chosen by the seed so no two worlds hunt the same
one. Nobody finishes a long save having seen nothing because the dice hated
them, and everyone on a seed has the same census in the same places.

Starters roll their own appearance at **twenty times the wild rate** on each
axis independently: 3.5% for a colour, 0.7% for a true shiny, and the tint
ladder left at the wild 1.4%. Which puts a shiny colour starter at about one
seed in four thousand — a real jackpot rather than something the opening
screen hands out.

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
