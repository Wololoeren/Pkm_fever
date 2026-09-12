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
tests/         661 tests, including the replay property everything rests on
docs/          the four reference pages: status, abilities, items, and what is deferred
```

Working: world generation and the census, the overworld — a town you walk
around and buildings you walk into, routes with meandering paths, woodland,
ponds and tall grass, and a camera that follows you — wild encounters, a
full single battle system — damage, the type chart, criticals, accuracy, stat
stages, five status conditions, drain, recoil and healing — plus catching,
experience, levelling, move learning, evolution, breeding, the box, save/load,
field notes on everything you have met, ninety-nine things the people on the
routes will tell you, and **PvP over WebRTC** — battles at any size from 1v1 to 6v6, and trading.

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

**Fifty places and four towns** on an irregular lattice, and further out means
higher levels and rarer things. Hearth is 40x28; the routes beyond it are
**88x68**, four times the area they were and far past what fits on a screen, so
the camera follows you and stops at the edges.

It was a star: a hub with arms running outward, difficulty read straight off an
arm's ring index. That is easy to reason about and it is not a *place* — you
never choose a direction, only an arm, and having chosen it there is exactly one
way on. So the world is a graph. The cells are grown from the seed one at a
time, each beside a cell that already exists, which is what makes the outline
lumpy rather than a disc and makes "avoid symmetry" a property of how the shape
was chosen rather than something arranged afterwards. Then extra joins are
opened between cells already beside each other until only **a few blind ends**
are left — that pass is what turns a tree into somewhere you can walk *round*.

The fifty are dealt out of **twenty kinds** by tier: four of each of the five
most ordinary places, three of the next five, two, then one. You should meet a
meadow four times over and a Crystal Vault once ever.

The towns are cells of that lattice too — Hearth at the origin and three more
founded out in the world, each with a Poké Center, a Mart and somebody's front
room. Hearth keeps the daycare, because breeding being in one place is what
makes going back there mean something.

Where they stand is two rules together, because either alone gets it wrong.
Each is taken from **its own third of the distance from home**, so there is one
on the way out, one further and one near the rim; choosing purely by how far
apart they are put all three on the rim and left six hops of the middle with
nowhere to heal. And within its third each is the candidate **furthest from
every town already chosen**, and never closer than three hops to one, which is
what stops two of them ending up neighbours. No dead ends either: a town you
can only enter and leave by the one road is somewhere you visit once by
mistake.

Three numbers a route carries, which used to be one number doing three jobs:

- **depth** — hops from town along the shortest way there. What the region map
  draws, and the only honest answer to "how far out is this".
- **ring** — how hard it is: depth stretched onto eight bands, so the first hop
  is always the first band and the furthest place in any world is always the
  last one. Worlds come out seven to ten hops across, and reading the level
  curve straight off hops would make the same curve reach further on some seeds
  than others.
- **nth** — which copy of its biome it is, counted outward. This is the half of
  a route's identity that anything hand-placed addresses: `{ biome: "marsh",
  nth: 1 }` is *the nearest marsh*, an address that resolves in every world,
  which a ring stopped being the moment rings stopped being names. Every gym,
  all twenty-one people out on the map, the Cup's house and all fourteen
  one-off breeding items are written down that way.

Routes are **carved, not drawn**. The map starts solid and a maze over a coarse
grid of rooms decides what opens: a depth-first spanning tree, which is what
gives long winding corridors and real dead ends rather than the stubby ones a
random-edge maze produces, plus a handful of extra joins so that a wrong turn
is a detour instead of something you must retrace in full. Every room is on the
tree, so connectivity is structural rather than hoped for.

A room is carved **inset** from its cell, and that inset *is* the wall between
it and its neighbours — so an inset of nought carves the whole cell and two
rooms simply merge. Five biomes were written that way and their routes came out
as one open field eighty cells across; on top of that every gate was joined to
the middle of the map with a corridor five wide, straight through whatever the
maze had drawn. Between them you could walk in one side of any route and out of
the other as though a path had been cleared. The inset now has a floor of one
and a doorway a ceiling of five, and nothing is cut to the middle at all: how
far you actually walk between two gaps in the wall, against how far apart they
are, went from 1.0 to about 1.8. `W25` holds it there.

Each biome is a different place to *walk* through, not just a different
palette. Meadow is wide and looped and forgiving, because it is the one you
meet first. Pinewood is the maze proper: narrow, few loops, mostly dead ends.
Ashflats is broken rather than dense, open rooms with rock between them and
little cover. Marsh lets water do the walling, so the way through is the dry
ground between pools; two of the twenty wall with water entirely. Corridors
narrow as the bands go out, so the outer world closes in without needing
profiles of its own.

The last word on a route is a walk from its front door: anything that walk
cannot reach is filled back in. Everything scattered after the maze runs can
sever a branch the maze guaranteed, and something did: a cabin dropped into one
of the small pinewood rooms filled it end to end and sealed off two thousand
tiles, carved, decorated and unreachable. `W24` is what noticed.

A route has **a gap in its wall on every side that has a neighbour**, up to one
a side, and each gap knows its bearing. There used to be exactly two, in at the
west and out at the east, and the whole map was **turned** afterwards to face
the way its arm ran — which is a transform and a whole class of bug with it, a
cabin's doorstep written down before the turn and read after it. Gates are cut
on the real walls now, so there is nothing left to turn and every route is the
same 88x68 whichever way you leave it.

The gaps are joined to the *middle* of the map rather than to each other, so a
place with three neighbours is a junction instead of three corridors that
happen to share a map. Every check that anything on a route might close — a
pond, a cabin, a gym hall, a boulder — is a walk from that middle to every
gate, and whatever fails it is put straight back. It used to be a walk between
one pair of rooms, which was a complete question when there were only ever two
ways out and would have let a pool seal the third of three.

Where a border leads is a **lookup, not a derivation**. Both ends of every
crossing are written from the same pair of gates when the world is built, so
stepping out and stepping back is a round trip as a property of the map. It
used to be two separate pieces of arithmetic, and they disagreed: every walk
back from ring one arrived at the same gap in town whichever arm you had left
by. A gate is paired with the gate on the wall *facing* it, which is why a
bearing is stored rather than inferred — a crossing between walls that do not
face each other is a teleport.

The buildings are real. Stepping on a door tile puts you in the room behind it,
and the daycare, the Poke Center and the Mart are rooms rather than panels that
follow you around. Every building outside carries a board beside its door
saying what it is for, drawn with its text over the map, because four identical
red roofs is a town you cannot read. The sign goes beside the doorstep and
never on it, which is a rule worth writing down: a sign that blocked its own
door would be a very good joke and a very bad building.

### The map

Two maps, because there are two questions. A scaled-down view of the map you
are standing on, with doors, unbeaten trainers and you marked on it, answers
"where am I here", and on a carved maze it is worth looking at. Under it, **the
graph**: a dot for each of the fifty places at the cell it actually occupies,
and a line wherever you can walk from one to the other.

It was a fan of twenty arms, which was the honest picture of a world whose only
questions were which arm and how far out. There are no arms now — there are
loops, junctions and a few blind ends — and the useful question became "what
have I not walked yet". So the dots sit where the places are and the lines are
the crossings that exist, which makes it a drawing of the world rather than a
diagram of it.

Over the pair, the name of where you are. The header at the top of the page
says it too, but the header is a long way from the picture and the picture is
what you are reading when you want to know.

Neither map carries any other word. Fifty names in a 176px square would be ink
rather than answer: the places are told apart by the colour of the ones you
have walked, towns are marked out from routes, the crossings you have taken are
drawn brighter than the ones you have not, and hovering a dot names it. Unwalked
places are drawn but empty — the *shape* of the world is not a secret, only
what is in it. Standing indoors lights up the town you are indoors in, because
a door is not a journey.

### The rival

Every trainer in this world stands still and waits. That is what makes them
scenery you choose to walk into, and it is the right call a hundred and fifty
times over — but it meant nothing here had ever come *after* anybody.

He turns up three steps behind you, walks the ground you have just walked for
twenty moves, and then catches up. You can see him the whole time, there is a
number over his head counting down, and there is nothing to do about it except
be ready or run for a town. He does not follow you into one.

**His team is built out of yours.** As many as you have, three levels above your
average, and each one picked for a type that beats one of yours — so a party
that has grown lopsided is a party he has noticed. There is no preparing for him
in general; you prepare by not having an obvious weakness, which is the one
thing the rest of the game never asks. And he is *decorated*: chromas and high
shine at rates nothing else comes close to, because the colours you have spent
forty hours hunting are what he turns up wearing.

He comes once at the start and then every 2,500 moves, measured from the last
time rather than as a modulo on the clock, so a long encounter does not eat into
the next one. There is no ball and no running: it is a trainer battle, and you
do not get to walk away from this one.

Almost none of him is stored. `rivalSince` is one number, and where he is
standing *is* the player's own position three moves ago, read off a trail the
state keeps anyway — so there is no second copy of him to disagree with the
first, and a save that replays walks him over the same ground.

He also found a bug that had been sitting there the whole time. The move
manifest carries six status conditions and this engine has five: Toxic is `tox`,
poison that worsens each turn, and there is no worsening here. The field is
typed `StatusId` and the manifest is cast to that shape on the way in, so a
value outside the union is invisible to the compiler — and `STATUS_IMMUNE["tox"]`
is `undefined`, and `.includes` on it throws, and the throw reaches the player as
"illegal input" on a move that is perfectly legal. Nothing had ever used Toxic,
because the people on the routes draw their moves from the route's own table.
He draws his from the whole dex and found it inside a hundred battles. Toxic
lands as ordinary poison now, and the deadlock probe is what caught it.

### The survey

Somebody to talk to on every one of the fifty routes, and four to seven people
who will fight you.

It was one to three trainers and nobody at all on most routes, which was written
when a route was 44x34. A route is 88x68 now, with a real maze through it and
about eighty steps from one side to the other — so one or two people on it read
as a corridor with encounters in it rather than as somewhere anybody lives.
There are about two hundred and seventy of them across a world now, where there
were a hundred.

The fifty who talk are a long-range expedition that fanned out across the world:
officers by department, a diplomat or two, and the merchants who followed the
fleet because merchants always do. Every one of them either **trades** or hands
out a **job**, because a hint-giver on every route would be fifty people saying
words, and the point of walking down a route is that there is something at the
end of it worth doing.

The merchants number their rules of acquisition, which is the conceit worth
spending forty-odd entries on: it gives each of them a distinct opening line
that is also a piece of a coherent philosophy, and the philosophy gets worse the
further out you go. The seven jobs are the shapes that programme did over and
over — a miracle asked of engineering with no time to do it in, a soft creature
that multiplies, an order to observe and not interfere, and a test nobody is
meant to win.

One to a route rather than a scattering, and `S1` checks the fifty addresses
cover the fifty routes exactly once, because "there is somebody on every route"
stops being a reason to walk down one the moment it is only true of most of
them. `S6` walks up to all forty-four traders with the wrong creature, is
refused, comes back with the right one and checks the swap lands.

### What the people on the routes know

This game explains almost nothing, on purpose. The stat sheet puts base, IV,
nature and effort in four columns and trusts you to read them; the shine ladder
has six rungs and no tutorial; burn lands last in the damage formula, and the
only place that was written down is a reference document.

The opposite failure was real too, and this had it: the knowledge existed and
there was nowhere to **meet** it. A player either read `docs/status.md` or
never found out that a third of the sleeps they land cost the opponent nothing
at all.

So the route trainers know things. Two hundred and seventy of them, four to
seven on every route, each opening with **one thing it has learned** — usually
the hard way, and with opinions about it. There are **ninety-nine** of them in
`src/engine/hints.ts`, and the shape matters more than the contents:

- **Spread across people you have to walk to.** A hint handed over by a panel
  is a manual with extra steps. A hint that comes out of somebody you found
  round the third corner of a pinewood is a reason to have gone round the
  corner. It is the survey's idea one layer down, applied to the people who
  were previously furniture with a team.

- **Dealt from a shuffled deck, not rolled.** Every one of the ninety-nine is
  seen before any is seen twice. Rolling per trainer would hand out about sixty
  distinct hints across the hundred people a player meets early on and give
  some of them three times — precisely the failure "there are lots of hints" is
  meant to avoid. A world uses all ninety-nine; `HN9` checks it.

- **A trainer says the same thing forever.** Dealt at world generation from the
  seed, like everything else. Somebody who tells you a different fact on
  Tuesday is not a character, they are a slot machine — the rule the idle
  creatures' lines already follow.

- **On the world, not the state.** A fact about who is standing there rather
  than something a playthrough accumulates. No save bytes, and **no
  `ENGINE_VERSION` bump**: nobody moved, nothing new is solid, and a recorded
  walk steps exactly where it stepped before.

A line earns its place by carrying **a number or a rule you can act on**, being
**true**, and being **said by somebody**. Several are deliberately the ones that
contradict what another game in this shape would have taught you: freeze has no
thaw here, Toxic does not escalate, natures add rather than multiply, and wild
creatures cap at a fifth of the IV range. The joke is the relationship the
speaker has with the fact, never a joke instead of the fact.

The numbers are guarded the way `docs/status.md` is. `HN12` names a constant,
the phrase written against it, and the value that phrase was written for —
change `STEPS_PER_EGG` and it fails saying the line about walking a hundred and
twenty steps is now a lie, and to rewrite the line rather than the number. A
hint that is merely plausible is worse than no hint, because it will be
believed.

The written cast keep their own words: gym leaders, Cup contenders and the
rival have lines already, and a town trainer's punchline is their team. A fact
about the crit ladder coming out of the cryptid hunter would be a fact standing
where a joke was.

### The three outer towns

Hearth is Hearth: it is where you wake up and it does not need a joke. The other
three each borrow the shape of a television programme, and everything in them
leans the same way — the people, what they say, the jobs they hand out, the
shelf in the Mart and the creatures pottering about.

**Southpass** is a small mountain town where appalling things happen weekly and
nobody remarks on them, chiefly because the people who would remark are eight.
**New Willow** is a future that turned out to be a job, with a professor
upstairs who keeps inventing ways for everybody to die. **Sanchford** is one
garage, one hole in reality, and a great deal of trouble. They arrive in that
order because the plan founds them by distance, which is more or less the order
in which those three things get harder to explain.

Sixteen, fifteen and fifteen references, spread across people, quests, battles,
items and creatures — because a homage you can only *read* is set dressing, and
one you have to do something about is a quest. The gnomes' business plan is a
job with a hole where phase two should be. The cryptid that is three animals is
fetched as three animals. A council of one man is fielded as five Dittos, which
is the joke told in this game's own vocabulary rather than in the programme's.

They are homages rather than transcriptions: the situations are recognisable and
the words are this game's own. That is the better joke anyway — a line lifted
whole is somebody else's, and a line that lands because you know what it is
*doing* is a joke you and the game are making together.

`tests/towns.test.ts` is the manifest. Listing every nod by id is the only way
"at least ten apiece" is a fact rather than an impression, and it is what stops
a town quietly losing half its cast to a refactor that looked like it was about
something else.

### The Grey Line

Twenty-four people in grey coats, one at every sort of place there is: the
nearest copy of each of the twenty biomes, and each of the four towns. Talk to
one, name another, and you are there.

**One authored person, expanded by the world.** The same mechanism the nurse
uses: `{ at: "station" }` is written once in the roster and `placeNpcs` turns
it into twenty-four posts. Twenty-four near-identical entries would be one
person written out twenty-four times, and a service with a uniform is exactly
the case where that is the right answer rather than a shortcut — there is one
Grey Line, not twenty-four people who coincidentally do the same job.

**The *nearest* copy of each biome, which does the spreading for free.** A
biome's tier decides both how many copies of it exist and roughly how far out
it sits: four meadows near home, one Crystal Vault a long way past them. So
"the first of each" is already a set of stops running from the doorstep to the
edge of the map. Picking a copy at random would have bunched them.

**They stand at the route's entry, which is the opposite of everybody else.**
The rest of the cast wishes for a spot well inside a route, deliberately: an
Angler you meet before you have seen the water is an Angler wasted. A travel
post is the one person you want at the gate — a stop you have to hunt for is a
stop you walk past, and the entry is the tile you arrive on, so stepping off
one coach leaves the next in reach. Measured: sixty-eight posts in a hundred
and twenty land one step from the door and the other fifty-two land two, which
is the diagonals, because `nearestSpot` bars the entry tile itself to
everybody.

**No new state pays for any of it.** A post is open exactly when its route is
in `visited`, which the save already records, so the network is derived from
where you have walked rather than from a second list of what you have
unlocked. Two lists is the shortest road to a coach that will not take you
somewhere you are standing in. It also makes the return leg free: you cannot
get anywhere without having walked there, and having walked there is what keeps
the way back open.

It is a separate input from `fly` because the two answer different questions.
Fly asks whether you have the wing; this asks whether you are stood in front of
a Greycoat and whether there is one at the other end. Sharing the input would
mean sharing the predicate, and a coach that needed an HM would be a coach
nobody rides. What they do share is `landAt`, so there is still one place that
decides where you end up standing.

The destination list is **filtered rather than greyed**, and that is the one
place the house rule bends. The rule exists so a dead control explains itself;
with twenty-four posts, obeying it literally would put a wall of twenty-three
disabled rows in front of the first Greycoat you meet, and would hand over the
name of every place in the world before you had walked to any of them. The
count underneath keeps it honest — "1 of their posts you have already walked
to. 22 more they keep, somewhere you have not been." The decision is still the
engine's either way: a stop is listed exactly when `travelRefusal` has nothing
to say about it.

Grey is the point, and it is grey in the fiction before it is grey in the
palette. Every other colour on the map means something *happens* at that tile
— a gift, a job, a gym. The Grey Line is how you get to a different tile, so
it is the one sort of person on the map who is infrastructure rather than an
event.

Adding them bumped `ENGINE_VERSION` to 22, and that is not a formality. People
are solid: twenty-four new ones move the tiles every other person was placed on
and block ground that used to be open, so a recorded walk can step into a
conversation where it used to take a step. Without the bump an old save falls
through the corrupt-log path and quietly starts a new game, which is the one
thing that comment promises never happens. **Adding anybody to the roster is a
bump.**

### What they are doing

A creature standing about used to say the same eleven words — "looks up at you,
and goes back to whatever it was doing" — which is a fine line once and a
hundred identical creatures by the time you have crossed the world. A creature
you can see and walk up to and get nothing particular from teaches you that
walking over is not worth the steps.

The twelve on the roster are written by hand, because each stands somewhere
specific and that is half of it: the Psyduck is staring down the well, and the
well is staring back. The other hundred cannot be — they are drawn from whatever
lives on the route — so they draw from a pool keyed on **what they are**. A Fire
one is warming a rock the rock did not ask to have warmed; a Ghost one is there,
then not, then there again slightly to the left. That is funnier than anything
generic and it also tells you what you are looking at.

Both types when it has two, so a Grass/Poison creature has six lines to choose
from and reads differently from a plain Grass one. Which line it gets is drawn
from its id at world generation, so it is the same for everybody on a seed and
the same every time you walk past — a creature that says something different on
Tuesday is not a character, it is a slot machine. And never a line already used
on that route, since that is the only place a repeat is noticed. Measured, a
world comes out at a hundred and ten distinct lines across a hundred and eleven
creatures.

The words live on the world and the notice carries only the creature's id,
because display language does not belong in game state.

### Waking up

Everything faints and you wake at **the last Poké Center you walked into**,
healed, having lost the time and nothing else.

It used to be Hearth, always, which was the only answer while Hearth was the
only town. With four of them, fainting nine hops out and waking at the origin is
not a cost, it is a punishment: the walk back is most of an hour and none of it
is play.

Walking in is what counts, not healing — a Center you have stood in is a Center
you know the way to. Before you have been in one it is still Hearth, which is
most of the first walk, since you start in the square rather than in the
building. Which one it was is state and is in the hash, because it changes what
a later input does: the same log with a different Center in it puts you
somewhere else.

### Fog

The small map of the route you are on is a **memory, not a satellite**. It drew
the whole route before, so arriving somewhere new meant already knowing the way
through it.

What you have looked at is folded in the engine, not kept beside it: it has to
survive a save, a save is a log of inputs, and so anything that survives one has
to be a fold over them — the same reason the roamers' positions are state. It
is folded once, centrally, so that every way of arriving somewhere reveals what
you can see from it, including the ones nobody remembers to think about: a door,
a border, Fly, an Escape Rope, waking up in a Center after everything fainted.

A route is 88x68 and there are fifty of them, so it is a bitset in hexadecimal
over blocks of four tiles rather than a list of coordinates: ninety-four
characters a route against the eighteen thousand numbers the readable version
would have cost. Blocks also make it look like a map — fog that retreats a tile
at a time reads as a torch, and this is not a torch.

One look is about a twelfth of a route, so mapping a place takes a dozen good
vantage points and a walk between them. In the dark it is the few tiles around
you, which makes Flash worth having twice over: it lights the route, and it is
the difference between mapping a place in one walk and mapping it in ten.

And the dark **conceals**. It is painted over everything now rather than
straight after the floor, which is where it used to go — so the ground was
hidden and then the trainers, the people, the creatures, the signs and the items
on the floor were all drawn on top of it, every one of them clearly lit and
floating on a black square. The dark hid the one thing on a route that was never
a surprise and revealed everything that was.

### Field notes

The fog remembers the **ground** you have walked past. Nothing remembered the
**creatures** you walked past on it, so "have I combed this route" had no
answer anywhere in the game — an odd hole in a world with fifty-eight decorated
creatures hidden in it and a pitch that shiny hunting is exploration.

`whereMet` is a species id against the route you first met one on. A route
rather than a boolean, because *where* is the useful half: a list of names you
have seen is a collection, and a list of names against the places they were is
a record of where you have actually looked. The thin entries are the point — a
route you crossed once and never combed sits there with two names against it.

**Folded in one place**, outermost in `applyInput`'s funnel. There are nine
roads to a battle in the engine and several roads to owning a creature without
one, and a fold written at each is nine chances to forget the tenth. Outermost
specifically because `followed` *starts* a battle from inside the funnel: the
rival is the one opponent you cannot walk away from, and anything folded
further in would miss him.

Both sides of the battlefield, and the party and the box. Both sides because
something somebody else sent out is something you have met; the party and the
box because a gift, an egg and a trade are all roads to owning a creature you
never fought, and releasing it later should not unwrite having had it.

In the hash, for the same reason the fog is — it is state, and a claim that two
logs produce the same state should not have an exception in it. Not redundant
with the party either: two logs can end holding the same six creatures having
found them in different places, and `N8` is that case. It is **not** an
`ENGINE_VERSION` bump, because no input does anything different; an old log
replays to exactly the game it always did, now also carrying a record of what
it met on the way.

The panel carries **no denominator**. The encounter table is right there and
"7 of the 23 that live here" would be nearly free — and would turn a record of
where you have been into a checklist of where to go, handing over the shape of
every route's population before you had walked any of it. What lives on a route
is for the route to tell you. The same reason the Grey Line's destinations are
filtered rather than greyed.

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

### Money, the bag and the Mart

Everything you hold lives in one bag of counts — balls, medicine, rods and the
breeding equipment together. Balls used to be a loose number on the state and
breeding gear a list of ids, which meant "how many of this do I have" had two
different answers depending on what you were asking about.

Trainers pay **money** rather than balls. A handful of one consumable is not a
reward, it is a refill; a purse is a choice. It scales with the team you beat
and how far out you beat it, and the **Mart** in Hearth is where it turns into
anything: three grades of ball, potions and revives, a Rare Candy priced so
that fighting stays the cheaper road to a level, and three fishing rods. The
Mart also buys — treasure exists to be sold — and a buy-then-sell round trip
always loses money, because a shop that breaks even is an infinite loop with a
counter in front of it.

Breeding equipment is found, never stocked, and the Mart will not buy it: a
player who sells their world's only Prism has not made a trade, they have lost
something the world contains once.

Items are used **out in the field**, not mid-battle. A potion in a duel would
have to be committed and revealed like a move for the protocol to stay fair,
and a heal the other side cannot answer is the shortest road to a battle that
never ends.

### Fishing

A rod turns any water's edge into a second kind of encounter. The table is the
grass table turned sideways — water types rather than the biome's, and a rod's
**reach** standing in for distance, so a Super Rod in the shallows finds about
what walking to the far edge of the map would. Depth is a second axis of
progress that does not require walking further out, which is what you are
buying.

Each pond keeps its own counter, so casting never consumes a patch of grass and
walking the grass never consumes the pond; and the same cast from the same spot
always hooks the same creature. What fishing does *not* pay is variants — the
census is placed in grass slots, and a pond that could also hold the world's
one shiny would make the count a lie.

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
bands 2, 5 and 8, so nobody can miss them; the other fourteen shape appearance
and are keyed to a *particular place* rather than a distance, so each asks you
to have been somewhere specific rather than merely far. All of them are equipment rather
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

### Icons

A creature standing on the map is drawn from the **box icons**, which is a
different set of art for a different job.

It used to be drawn from the battle sprite, and that is a 96-pixel drawing
going into a 26-pixel tile: a quarter-size nearest-neighbour downscale, which
throws away three pixels in every four. Eyes, ears and outlines land on the
dropped rows at random, so a creature in the grass looked mangled rather than
small. The icons are drawn at map scale to begin with — 68x56 sheets whose
creature occupies 14 to 58 pixels — so nothing has to be discarded to fit.

Two rules about the fitting, and both are that same lesson. **Never enlarge**,
because a 1.33x upscale makes some source pixels one screen pixel and others
two; a Caterpie being smaller than a Steelix on the map is the one thing a
fixed box throws away and it is worth keeping. And **average rather than
sample** for anything that does have to shrink, since sampling is precisely
what broke the old draw. Whatever comes back is already the size it will be
painted, so the canvas scales nothing at draw time.

The set stops at Calyrex. Everything from Sprigatito onward — 154 of the 1,099
sprite numbers in the dex — falls back to the battle sprite shrunk by those
same rules, which is softer than an icon and a great deal better than what it
replaced.

There is no shiny icon in existence, so the tint ladder cannot be an
interpolation between two icons the way it is between two sprites. The variant
is **learned from the front pair and applied to the icon**: for each colour in
the normal sprite, how far it moves in OKLab to become shiny, transferred to
the nearest colour in the icon's own palette. The two palettes share about two
colours exactly and all of their colour *families*, which match within 0.01 to
0.08 against shifts of 0.04 to 0.16 — several times finer than the thing being
measured. The delta is transferred rather than the destination, so a colour the
shiny does not change stays put; without that, every pure-black icon outline
would quietly lift a shade. A shiny Gyarados on the map is red and a shiny
Dragonite is green, which is the check that matters.

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

An input the engine refuses throws `IllegalInput`, and the UI drops it — you
walked into a tree. Anything else that throws is a **crash wearing a refusal's
clothes**, and it is logged rather than swallowed, because that `catch` is
exactly wide enough to hide one: the Toxic bug spent months reaching the player
as "that move is not legal" because `STATUS_IMMUNE["tox"]` was undefined and
`.includes` threw from a move that was perfectly legal. It took a hundred
battles of a probe to find something one line there would have named on the
first occurrence. The session is kept either way — a crash costs that input,
not the playthrough.

### What a save actually weighs

A save is a seed and a list of inputs, and the list is almost entirely walking.
Measured on a generated playthrough: twenty thousand inputs came out 14,603
moves, and `{ "t": "move", "dir": "e" }` is 22 bytes of JSON carrying one
letter of information. A long save reaches ninety thousand inputs and
localStorage is five megabytes.

So the log is packed on the way out and unpacked on the way in, and there are
only two rules. **A string is a run of moves** — `"eenneww"` — so fifty steps
cost fifty-two bytes rather than eleven hundred. **An array is everything
else**, `[op, payload]`, with the payload keeping its field names so nothing
depends on the order keys happen to be written in. The two shapes cannot be
confused for one another, which makes the decoder a `typeof` rather than a
guess. A mixed battle-heavy log goes from 22.7 bytes an input to **4.30**.

The opcode table is a `Record` over the input union, so **adding an input to
the engine without giving it an opcode is a compile error**. That is the whole
point: the failure mode of a codec is silently dropping the one input nobody
thought about, and a dropped input is a save that replays into a different
game. The numbers are written out rather than derived from position because
they are a file format — append, never renumber.

It is deliberately not an `ENGINE_VERSION` bump. A log is spelled differently,
not meant differently, and `parseSave` still reads the old spelling.

The autosave is written on a **trailing half-second debounce** rather than on
every input. It used to be written from inside the reducer's own state updater
— a side effect in a function React may call twice — and it serialised the
whole log every step, which is nothing at a hundred inputs and a dropped frame
every step by the time a save is worth having. `flushAutosave` pays whatever is
owed on `pagehide`, which is the one moment a debounce would otherwise cost
real progress.

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

### Every status effect, and its arithmetic

[`docs/status.md`](./docs/status.md) is the page: the five conditions, the nine
volatiles, both stat ladders and the six screens, each with the exact integer
arithmetic and where in the damage formula it lands.

It is guarded differently from the other two reference pages, because it fails
differently. `abilities.md` and `items.md` are lists, and the way a list goes
wrong is by losing a row — so those are checked by asking whether they name
everything. This one is a page of arithmetic, and the way it goes wrong is by
saying an eighth where the engine says a quarter, months after somebody changed
a constant and had no reason to think a document was reading it. So
`tests/statusdoc.test.ts` reads the numbers out of `battle.ts` and asserts the
document is written in terms of them: change `SEED_SHARE` to 6 and the expected
phrase becomes "maxHp / 6", which the page does not contain, and the test fails
naming the constant.

### Status moves, and the 179 that did nothing

The move manifest carries five effect fields — `status`, `boosts`, `secondary`,
`drain`, `heal` — and Showdown keeps everything else in script:
`volatileStatus`, `sideCondition`, `weather`, `terrain`, `onHit`. So of the
manifest's 264 status moves, **179 arrived with nothing this engine could act
on**, and were dealt out anyway.

That is not a corner. Taking each species' last four learnable moves, which is
exactly what `movesAtLevel` deals to a wild encounter, a trainer's team and a
freshly given starter, **635 of 1134 species carried at least one slot that did
nothing at all** — and Togekiss's four were *all* dead: Wish, Yawn, Encore,
Bestow. A creature whose entire moveset was scenery, which could do nothing but
Struggle. Leech Seed was simply the one somebody noticed.

The hole is closed from both ends.

**50 moves are now honoured**, through `src/engine/statusmoves.ts` — the same
shape `moves.ts` already used for the 39 attacks whose damage Showdown computes
in a callback. Effects are data interpreted by one loop in `battle.ts`, not a
switch per move. That needed three pieces of machinery the battle did not have:
volatile conditions belonging to an *appearance* (seeded, confused, drowsy,
dreaming, counting, trapped, braced), the two probability ladders that are not
stats (accuracy and evasion, on thirds rather than halves), and side conditions
that outlive whoever is standing (the screens, Safeguard, Mist, Lucky Chant,
Tailwind).

**The other 129 are no longer dealt.** `learnset()` filters them, which is the
one gate every road to a moveset comes through — `movesAtLevel`, `learnableAt`,
the level-up walk, the Cup, the Inspect panel. `MACHINE_MOVES` is filtered the
same way, because `items.ts` builds one purchasable machine per entry and the
Mart was selling 45 four-thousand-a-go lessons in wasting a turn.

What is deliberately not implemented, and why, is written out at the top of
`statusmoves.ts`: weather and terrain want a field condition of their own;
entry hazards want an on-arrival hook; **move restriction** (Taunt, Disable,
Encore, Torment) changes *which moves are legal*, which is the one class of
effect that can make a battle unwinnable and wants its own pass with the
deadlock probe watching; move calling wants a re-entrancy guard; and the
doubles moves are meaningless in a game that is 1v1 throughout.

Splash is kept. Doing nothing is what Splash is for, and `statusmoves.ts` says
so out loud rather than leaving it to an exception list — an exception list is
where the next Leech Seed hides.

Two bugs fell out of building it, both invisible until something needed them:

- **`cloneSide` named its four fields by hand**, so every field added to
  `Combatant` was silently dropped at the turn boundary. A creature was seeded,
  the turn ended, and the seed was gone before anything could drain it — the
  same symptom Leech Seed had originally, from a completely different cause one
  turn further on. It spreads now, so a new field is carried whether or not
  anybody remembers the function.
- **Nothing stopped a turn once a move had ended the battle.** No move could do
  that before; Roar drives a wild creature off and Teleport walks out of the
  grass. Left unguarded the residuals ticked for a battle nobody was in and
  `settle` awarded experience for a creature that had walked away.

And one wording fix worth naming, because it is the same mistake twice: landing
a condition and the condition *biting* were the same sentence, so the turn a
seed took hold read "Amaura was seeded! Amaura was seeded! Amaura took 5" — the
game appearing to stutter rather than a seed taking hold and then drawing.

### Moves out in the world

The HMs here are **items**, and that was a deliberate call: `OBSTACLES` in
terrain.ts names the tool each impassable tile wants, and Cut, Surf, Strength,
Rock Smash, Waterfall, Whirlpool, Dive, Rock Climb, Flash and Fly are keys in
the bag rather than moves you teach. "A key shaped like a verb."

What that left out is the other half of the idea: the field moves that are not
keys at all. They do not open a tile, they *do* something. `statusmoves.ts` had
already established that a move can carry an effect the manifest cannot say;
`fieldmoves.ts` is the same idea for the world rather than the battle.

Seven moves, and every one of them is machinery the game already had, reached
by a different road:

| Move | What it does | Built on |
| --- | --- | --- |
| **Headbutt** | Shakes a creature out of a tree beside you | the `TREE` tile, and the route's census |
| **Sweet Scent** | Draws whatever is in the grass you are standing in | the same census, the same order |
| **Dig** | Up and out, back to town | `landAt(HUB_ID)` — the Escape Rope's own road |
| **Teleport** | Back to the Poké Center you last stood in | `state.centre`, which the blackout already uses |
| **Defog** | Fills in this route's map | the fog-of-war bitset |
| **Milk Drink** / **Soft-Boiled** | Gives some of the user's own health away | the party |

Headbutt is the one that matters most: **122 species learn it**, which is what
makes a tree worth putting something in. A tree draws on the route's *own*
census in the route's own order — it is another door onto the same population,
not a second population, because the census is what a route *is* and a move
that rolled fresh would be a way to fish for the one true shiny. It gets its
own battle tag, so a creature met in the grass and one that fell out of a tree
never share a roll.

Two couplings worth naming. A move with a use out here **is not inert**, so
`actsOnSomething` asks `hasFieldUse` — without that, Sweet Scent and Defog do
nothing in a battle, get filtered out of every learnset by the status-move
audit, and the feature is unreachable for the two moves that most need it. And
a creature shaken out of a tree **is catchable**: `isWildBattle` counts the
tree tag, or Headbutt would be a way to find creatures you cannot keep.

Rototiller wants soft soil and Secret Power wants a base, and this world has
neither. Flash stays an item, because `OBSTACLES` asks the bag rather than the
party and two answers to "can I see in here" is a pair that drifts.

### Attack animations

The battle emits structured events and nothing else — no positions, no timings,
no words. `narrate.ts` turns them into sentences; `beats.ts` turns the same list
into motion. Both are display, and neither is allowed near the state hash: an
animation a save depended on would be a save that broke when somebody retimed a
shake.

The part worth getting right is the **ordering**. Both sides move in one turn,
and animating them at once reads as two things happening to one creature rather
than as one of them swinging and the other answering. The events are already in
resolution order, so counting the `use` events gives each side its place for
free — a lunge at 0ms, the answer at 340.

A swing lunges toward whatever is opposite; a blow lands as a three-step shake
plus a wash of the attacking move's own type colour, white and harder on a
critical; a miss slips aside with no flash; a status glows; a faint drops and
stays down. Played through `element.animate()` rather than CSS classes, because
a CSS animation does not restart when the same class is reapplied and a battle
is the same five animations over and over — the alternatives are a `key` that
remounts the sprite's canvas and blanks it for a frame, or an `offsetWidth`
reflow trick that needs a comment every time anybody reads it.

`prefers-reduced-motion` is honoured, and the sprite is wrapped rather than
animated in place so the nameplate and health bar hold still while it shakes.

The impact flash is invisible at rest because it has **no colour**, not because
it is at `opacity: 0`. That is not a detail: a rule that hides itself in CSS and
is never shown again in CSS is exactly what the Y1 guard exists to catch, and it
catches it for good reason. Reaching for an exception was the wrong instinct —
carrying the colour in the keyframes instead means the element's resting state
is honestly "no colour", and the guard needs no hole.

### Switching in a battle

The party is already up the left of the stage. A second list under the field was
the same six creatures on screen twice — once to read, once to press — so the
panel that is already there is now the thing you click: it takes a callback,
says "Send out who?", and withholds reordering and the stat sheet while it is
choosing, because a click meant to send a creature out should not sometimes open
a stat screen instead.

### Reading a battle at a glance

Three things on the battle screen answer questions a player has every single
turn, and all three were answerable only by reading the log or hovering.

**How a move lands.** A green ▲ for double, ▲▲ for quadruple, a red ▼ for
half, ▼▼ for a quarter, and a red ✕ for nothing at all — and deliberately
*nothing* for a neutral hit, because four buttons each wearing a badge that
says "normal" is four badges nobody reads, and then the one that matters is
just another badge. Silence is what makes the arrow loud. The tooltip already
said this in words; choosing between four moves is a decision made four times
a turn, and hovering all four to make it is not a decision, it is a survey.

The number comes from `landsAs` in the engine, exported for exactly this, and
that matters more than it looks. **The type chart alone cannot answer the
question.** Two things sit either side of it: Scrappy takes the Ghost out of
the defender before the chart is consulted, and the absorb-and-immune
abilities stop a move the chart has nothing to say about — a Levitate is not
a Flying type. A button asking `effectiveness` directly would cross out a
Scrappy's Tackle against a Gengar and promise full damage from an Earthquake
into a Levitate. One predicate, two callers, again: the arrow and the tooltip
under it read the same number, and the engine is where that number lives.
Extracting it also collapsed the Scrappy rule, which had been written out
twice — once for the immunity check and once for the damage multiplier, the
pair that has to agree or a move announces it cannot touch something and then
touches it.

**What is happening to a creature.** A burn had shown a "BRN" under the name
since the first battle screen and nothing else ever did, so a creature two
Defense stages down, seeded, drowsy and standing behind a Reflect looked
exactly like one in perfect health. All of it was in the log, once, on the turn
it happened, and then it scrolled away. `lib/tags.ts` derives a badge per
condition — `DEF ↓`, `SPE ↑2`, `ACC ↓`, `SEEDED`, `CONFUSED`, `DROWSY`,
`PERISH 3`, `REFLECT 4` — red for anything that moved against the creature
wearing it and green for anything that moved for it, so the colour says
direction rather than whose side it helps: the foe's Attack going up is green
on the foe's plate and still bad news for you. The five statuses keep the `st-`
colours they have always had, because they are conditions rather than
directions.

It reads the `Combatant` rather than the `Individual`, which is where the game
keeps them — and where a condition is kept is a statement about how long it
lasts. Stages and volatiles belong to the appearance and go the moment it
switches out; screens belong to the side and survive it; only `status` belongs
to the creature and follows it into the box. Three lifetimes, one row, and most
of the row emptying out on a switch is the explanation.

The screens and the two stat tables are exhaustive `Record`s, so a sixth stat
ladder cannot be added without the compiler asking what its badge says. The
volatiles have no such gate, so M9 reads the `Volatiles` interface out of
`battle.ts` and fails if any field of it has nothing to show — which is the
Leech Seed lesson written down as a test: it worked, and nothing said so, and
so it was reported as doing nothing at all.

**And the plate got wider** to hold the row: 200px to 264, with the health bar
as wide as the plate and a touch taller. At the old width a burned, seeded,
two-stages-down creature wrapped its badges onto three lines.

### The thirty-one moves that land more than once

Fury Swipes is 18 power, which is the worst number on any move button in the
game and is *meant* to be: it is 18 power five times over. It was landing once.

The cause is worth naming because it is a different one from the status moves
above. Those are script — Showdown computes them in callbacks the manifest
cannot hold, which is why `statusmoves.ts` exists. **This was plain data the
build script simply was not copying.** `multihit: [2, 5]` sits in the dex
beside `power` and `accuracy`; `scripts/build-dex.mjs` listed fourteen fields
and this was not one of them. Regenerating with it added the field to 31 moves
and changed **nothing else in any of the six data files** — which is what the
script's "byte-identical on a rebuild" property is for.

Two more fields came with it, both data and both missing for the same reason.
`multiaccuracy` (Triple Kick, Triple Axel, Population Bomb) rolls accuracy
again for every blow; without it a ten-hit move at ninety percent is two
hundred base power for ten power points, every time. `alwaysCrit` (Frost
Breath, Storm Throw, Wicked Blow, Flower Trick, Surging Strikes) is those five
moves' entire identity, and they had been critting one time in twenty-four
like anything else.

**356 of 1134 species learn at least one**, across 438 learnset slots.

The range is three eighths two, three eighths three, one eighth four, one
eighth five — the classic distribution, and eighths rather than the later
games' 35/35/15/15 because eighths divide exactly into one roll of eight and
this codebase has no rounding step to spare. It averages exactly three, so
Fury Swipes is a little over fifty and lands where a move of that shape
should.

What makes five blows read as five rather than as one blow times five:

- **Each rolls its own damage and its own crit.** The roll tags are suffixed
  per blow — and the *first* blow keeps the bare tag, deliberately, because
  that is what every single-hit move in the game already rolls against. A
  suffix on all of them would have re-rolled every battle in every save.
- **The sequence stops when the target goes down.** Otherwise three more blows
  land on a fainted creature and the log says so three more times.
- **Everything downstream reads the total.** Drain, recoil and a Life Orb's cut
  are outside the loop, because draining a fifth of each blow separately and
  rounding five times is not the same number.
- **The log says how many.** "It hit 3 times!", after the blows rather than
  before them, and said even when only one landed — for these thirty-one, how
  many is the interesting half of what happened.
- **The button says so too.** `18 pow ×2–5`, because the manifest's power is
  one blow's worth and printed bare it is a lie by omission.

The one thing the manifest genuinely cannot say is Triple Kick's rising power
— 10, 20, 30, and Triple Axel's 20, 40, 60. That is a `basePowerCallback`
upstream, so it lives in `moves.ts` beside the other thirty-nine formulas, as
`base * (blow + 1)`: the rule the pair share rather than a table of six
numbers.

`ENGINE_VERSION` 22 → 23. A recorded battle with a Fury Swipes in it resolves
differently now, and so does one with a Frost Breath.

**Measured while in there, and fixed next:** seventeen moves carried a
`self.boosts` drawback the manifest was also dropping. See below.

### What a move costs the creature that used it

The third field in the same family, and the one with the most on it. Seventeen
moves tell the user's own stat stages to move, sixteen of them downward: Close
Combat's guard, Overheat burning out its own Sp. Atk, Superpower spending the
very Attack it just hit with, V-create giving up three stages at once. All
seventeen were being dropped on the way across, so **every one of them was
strictly better in this game than it is meant to be** — Close Combat at 120
power with no downside is not a trade, it is simply the best physical move in
the game. 187 of 1134 species learn at least one, and five of the seventeen
are machines, so anything that can be taught can have one.

It is deliberately **not** folded into `secondary`, which is the
obvious-looking move and wrong twice over:

- A secondary is gated on **the target still standing**, so a Close Combat
  that knocked something out would keep its guard — the one case where the
  move would be free.
- A secondary is gated on **the target's shield**, which has nothing to do
  with what a move costs the creature that used it.

And it goes through `applyBoosts` with `byOther` left false, so a Clear Body
or a Mist does not cancel it. Those answer "can the other side lower my
stages", and this is not the other side; handing them this would make every
drawback move free on anything that happens to carry one.

`chance` is carried because Diamond Storm's is a coin flip — 50% for +2
Defence, the one of the seventeen that is a reward rather than a cost. The
other sixteen are certainties and default to 100.

The ordering matters too, and W7 pins it: the cost is paid **after** the
damage. Superpower spends the Attack it just hit with, not the Attack it is
about to hit with, and the other way round would be a different and much
worse move.

`ENGINE_VERSION` 23 → 24.

### The reveal shows the creature that earned it

The evolution scene asked for `variantId="normal"` and got it, for as long as
the scene existed. So the one moment the game stops everything for twenty
seconds to look at a creature was the one moment it showed somebody else's: a
shiny that had been shiny for forty levels turned up in factory colours,
changed shape, and went back to being shiny in the party list underneath.

The prop is required now and has no default, because a default is how this
survived. Both callers answer it by finding the creature rather than by copying
a field off it: the battle reads the `uid` already on the `exp` event, and the
`evolved` notice carries a `uid` for the same reason — "which species" does
not say which creature, and two Gloom in a party with a Leaf Stone on one of
them is enough to pick the wrong one. The notice is not in `stateHash`, so
widening it costs no save compatibility and no version bump.

The variant needs no staging of its own. The earlier stages flatten the sprite
to black and the peak blows it white, both through a filter on the whole
`.evolveSprite`, so the colour stays hidden until the reveal for free and the
reveal is the one frame that shows the creature as it actually is.

The **badges are off** for that frame, though, through a `marks` prop on
`Sprite` that is on everywhere else. Everywhere else a sprite is one of six in
a list and the star is how you pick the interesting one out of it; here there
is no list, and a badge in the corner of the only moment this game asks you to
just look at something is an interface element standing in front of it. The
colours already say which one it is.

And a **Rare Candy gets the scene too**. `awardExp` has always evolved on a
candy — the level path is the same one a battle uses, deliberately — but the
notice read "Used the Rare Candy on Metapod" and stopped, naming the creature
it had already become. So the one road to an evolution you had gone to a shop
and paid for was the one that said nothing about it.

Guarded three ways, because the bug was invisible: S18 and S19 check that an
appearance survives both roads to an evolution (levelling in a battle, and a
stone) and that the uid each road reports finds the creature that kept it —
S19 deliberately puts *two* Vulpix in the party wearing different appearances
and stones the second, since with one, a screen that assumed party slot zero
would pass. Y6 reads the components and fails on any literal `variantId="..."`
in the markup at all: an appearance is a fact about a creature, the only
honest source for it is the creature, and a literal there is not a compile
error, not a runtime error, and not visibly wrong either — because "normal"
is exactly what nine creatures in ten look like. It is wrong only for the ones
a player cares about.

### Creatures arrive rather than appear

The placeholder art is now a **silhouette**. It used to be a body, a head,
ears, a tail and two eyes in the species' own type colours, run through the
variant transform, from back when there were no real sprites and the ladder of
eleven appearances had to be visible somehow. The real pipeline shipped, and
the moment it did that became a liability: every creature arrived as a brightly
coloured two-ellipse snowman with eyes, held the frame for as long as the
download took, and then turned into something that looked nothing like it. A
placeholder that looks like art gets read as art and reported as a bug, which
is exactly what happened.

The shape is still generated the same way and still seeded on the species id,
so a long creature and a round one cast different shadows and the same species
always casts its own. Every pixel of it is one dark colour — #101218 rather
than black, because the field is a dark gradient and true black reads as a hole
punched in the panel. The eyes and the belly are gone: a face is the one thing
you cannot put on a silhouette and still have it stay a silhouette. One
consequence worth naming — a shadow has no colour, so it has no variant
either, and the cache is keyed on the species alone. The variant marks beside
the sprite still say which one it is.

And a creature **walks on** from its own side: the foe in from the right where
the foe stands, yours in from the left, 380ms, keyed on *who is standing there*
rather than on the turn. That last part is the whole difference from
`useBeat` — a turn spent switching and a turn spent attacking are both one
turn, and only one of them is an arrival. It is added *before* the beat hook on
purpose: both animate the same transform, the later-added animation wins while
they overlap, and a creature sent out into a move already aimed at it should
flinch rather than keep strolling.

A hundred and ten percent of its own width and no further, because nothing on
the battle screen clips. A longer run-up would have the sprite visibly cross
the field's border and pass over the party panel beside it, and clipping the
field is not the fix — both hover panels are anchored below their slots and
would go with it.

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

*The old version of this section listed the build order as "the battle system,
then a renderer, then the variant pipeline, then save/load, then peer-to-peer
battles". All five shipped. What follows is what is actually left, with the
numbers measured rather than remembered — re-measure before trusting them.*

### The largest single gap: 125 status moves

The manifest carries five effect fields and Showdown keeps the rest in script,
so of its **264 status moves, 54 are honoured in battle** (`statusmoves.ts`) and
**7 out in the world** (`fieldmoves.ts`). The remaining **125 are filtered out
of every pool** rather than dealt as dead slots — which means no creature ever
holds a move that does nothing, but it also means **888 of 1134 species lose at
least one learnset entry**, 2,209 entries in total.

That is the honest cost of the current design, and closing it is mostly a
matter of adding one *capability* at a time. Grouped by what each group needs
first, most-learned first, with the number of species that learn each:

**Cheap: more of the machinery that already exists.** Volatiles on an
appearance, which `statusmoves.ts` already has. No new concepts, and probably
the best value per hour in the whole list.

| Move | Learners | Shape |
| --- | --- | --- |
| Aqua Ring, Ingrain | 32, 30 | a per-turn heal, which is Leech Seed backwards |
| Attract | 23 | a lost-turn volatile, which is confusion with a gender check |
| Heal Pulse, Floral Healing, Strength Sap | 30, 1, 8 | heal the *target* rather than the user |
| Psych Up, and the stat swaps and splits | 30, 17+13+12+10+3+2 | copy or exchange stages |
| Stockpile / Swallow / Spit Up | 28, 25 | one counter volatile, three doors onto it |
| Lock-On, Mind Reader | 22, 12 | an unmissable volatile |
| Destiny Bond | 30 | a volatile read at faint time |
| Wish, Healing Wish, Lunar Dance, Revival Blessing | 19, 23, 1, 2 | a delayed or on-switch heal |
| Magnet Rise, Telekinesis | 20, 8 | a ground-immunity volatile |

**Needs types to belong to the appearance rather than the species.** Types are
read off `speciesById(...).types` everywhere, so nothing can change them.
Unlocks Soak (35), Camouflage (10), Reflect Type (7), Forest's Curse (2),
Trick-or-Treat, Conversion and Conversion 2 — and the three "ignore immunity"
moves, Odor Sleuth (43), Foresight (33) and Miracle Eye (11), which are the
same lookup from the other side.

**Needs abilities to belong to the appearance.** Same shape, different field.
Unlocks Worry Seed (27), Gastro Acid (25), Entrainment (23), Role Play (17),
Skill Swap (12), Simple Beam (7), Doodle (1).

**Needs a field condition.** Weather and terrain are one feature that changes
damage, residuals and a dozen abilities — half of it is worse than none of it.
Unlocks the five weathers, the four terrains, Water Sport (49), Mud Sport (30),
Aurora Veil (8) and Chilly Reception.

**Needs stage-passing on a switch.** Baton Pass (47) and Shed Tail (3).

**Needs a contact flag in the manifest.** A `scripts/build-dex.mjs` change, and
the smallest job on this list. It is what King's Shield, Spiky Shield, Baneful
Bunker, Burning Bulwark, Obstruct and Silk Trap are missing: all six currently
block the move and none of them punishes the attacker, which is written up in
`statusmoves.ts`. The `barb` items (Jaboca, Rowap) answer by *category* for the
same reason and would be more faithful with it.

**Needs an on-arrival hook that survives the switch path.** Spikes, Stealth
Rock, Sticky Web, Toxic Spikes.

**Needs a re-entrancy guard on `executeMove`.** Metronome, Sleep Talk, Copycat,
Mirror Move, Assist, Me First, Nature Power, Instruct. Do the depth limit
*first*; a move that calls a move that calls itself is a hang, not a bug.

**Needs items to move in battle.** The bag is engine state and the battle does
not touch it. Trick, Switcheroo, Bestow, Recycle, Stuff Cheeks, Embargo (25),
Magic Room, Snatch, Magic Coat.

**Risky, and worth doing carefully.** Move restriction — Taunt (83), Disable,
Encore, Torment, Imprison, Heal Block — changes *which moves are legal*, and
that is the one class of effect that can make a battle unwinnable. Struggle and
`hasLegalMove` are the safety net; run the deadlock probe while building it, and
expect it to earn its keep. Substitute (15) is in the same bracket for a
different reason: it sits in front of every damage path in the file.

**Not worth doing.** The 16 doubles-only moves (Helping Hand, Ally Switch, Wide
Guard, Follow Me, the ally heals) are meaningless in a game that is 1v1
throughout. Rototiller wants soft soil and Secret Power wants a base. Curse (66)
is a genuine oddity: it is two different moves depending on whether the user is
a Ghost, and the manifest has no way to say so.

A `docs/moves-deferred.md` alongside `items-deferred.md` and
`abilities-deferred.md` would fit the pattern, and H29's guard — "nothing on
the deferred list is quietly implemented after all" — would then cover moves
too. That guard is the reason those documents are worth keeping.

### The census has not grown with the world

`CENSUS_PLAN` places **58 decorated creatures**. The world was 120 routes in a
star, is now 50 in a graph, and each route holds 120 census slots — so a
decorated creature is about one encounter in a hundred inside the census window,
and a whole route often holds none. Whether that is too thin is a judgement
call about how long a hunt should take, which is why it has not simply been
scaled: the honest options are more placements, a narrower slot range, or
accepting that most routes are ordinary.

### The deadlock probe's coverage fell

It walks 60,000 field steps and now reaches **17 of 50 routes**, down from 43,
because tripling the trainers means those steps go on fighting — roughly 4,000
trainer battles a run. It still finds real bugs (it caught the Toxic crash on
its first run with the rival in the world), but it is covering a third of the
map. Loosening the walker's rival-chase was tried and measured and made no
difference, so it was reverted rather than kept as a comment claiming a result
it did not get. The likely fix is more steps or a second probe that only walks.

### Smaller things, in no order

- The three outer towns have no idle creatures of their own beyond the two
  themed ones each. Hearth's are much of what makes it feel inhabited.
- Transform copies the species, the numbers, the abilities and the moves, but
  deliberately not `variantId` — so a transformed Ditto takes the target's shape
  in its own colours, and a chroma Ditto stays a chroma. That reads correctly
  and is cheap to change if it ever reads wrong; it has not been playtested
  enough to know which.
- Milk Drink and Soft-Boiled give a fifth of the user's maximum out in the
  world, which is a number chosen rather than derived.
- `Facing` is not stored anywhere, so Headbutt works on any adjacent tree. With
  a facing direction it could want the tree you are looking at.
