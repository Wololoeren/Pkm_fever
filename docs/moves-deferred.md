# Moves not in yet

The third of the deferred lists, beside [`items-deferred.md`](./items-deferred.md)
and [`abilities-deferred.md`](./abilities-deferred.md), and under the same
rule: a move that half works teaches a player that moves are unreliable, which
is a much more expensive lesson than "that one is not in yet".

Every move here is a **status move whose manifest row is empty** — no
`status`, no `boosts`, no `heal`, no `drain`, no `secondary` — and which
`src/engine/statusmoves.ts` does not honour. Every such move is **filtered out
of every learnset and off the Mart's shelf** rather than dealt as a slot that
does nothing, which is why this list is a list of absences rather than of
disappointments. Nothing on it is approximated.

Filed under **the one capability each is waiting for**, most-learned first,
with the number of species that learn it — because that is the useful
ordering: build the capability and a whole row arrives at once. The number
after a name is how many of the 1,134 species learn it; a move with a large
number is a move a lot of creatures are quietly missing a slot for.

The measurement, re-run at every audit: **264 status moves in the manifest,
179 with empty rows, 104 of those honoured in battle or out in the world**, and
the **75** below are what is left. Between them they cost **786 species at
least one learnset entry**, 1,500 entries in all.

Two guards keep this honest. `X56` checks that every filtered move has a row
here, and `X57` that no move in a row here has quietly been honoured after
all — the way H29 guards the items list.

---

## Waiting on a field condition

Weather and terrain are one feature rather than nine: a condition on the
*battle* rather than on a creature, with a duration, which every damage
calculation, every residual and a dozen abilities then have to ask about. Half
of it is worse than none of it, so none of it is in.

| Move | Learners | What it wants |
| --- | --- | --- |
| **Rain Dance** | 61 | rain: Water up, Fire down, Thunder sure |
| **Sandstorm** | 43 | sand: a residual on most things, Rock's Sp. Def up |
| **Sunny Day** | 42 | sun: Fire up, Water down, Solar Beam in one |
| **Hail**, **Snowscape** | 23, 16 | hail: a residual; snow: Ice's Defence up |
| **Electric Terrain** | 28 | the four terrains: a type up, and a condition refused, for the grounded |
| **Grassy Terrain** | 25 | — and a residual heal |
| **Misty Terrain** | 21 | — and every status refused |
| **Psychic Terrain** | 9 | — and priority refused |
| **Water Sport**, **Mud Sport** | 49, 30 | a type made weaker for five turns, which is weather with one type in it |
| **Aurora Veil** | 8 | both screens at once, and only in hail |
| **Chilly Reception** | 2 | snow, then a switch |
| **Gravity** | 13 | Flying's immunity suspended, accuracy raised, for five turns |
| **Trick Room** | 5 | the slow move first, for five turns |
| **Wonder Room**, **Magic Room** | 15, 11 | Defence and Sp. Def exchanged; held items switched off |
| **Ion Deluge** | 7 | Normal moves become Electric for a turn |
| **Fairy Lock** | 1 | nobody may switch next turn |
| **Court Change** | 1 | the two sides' screens exchanged |

## Waiting on the battle knowing what it is standing on

Types belong to the appearance now — Soak, Reflect Type, the Conversions,
Forest's Curse, Foresight and Miracle Eye all arrived with the `types`
volatile — and one of that group did not, because it wants a second thing.

| Move | Learners | What it wants |
| --- | --- | --- |
| **Camouflage** | 10 | the user becomes the type of the ground it is standing on, and a battle does not know which route it is on |

## Waiting on abilities that belong to the appearance

The same shape, a different field. `abilities` is on the `Individual` and a
battle never rewrites it.

| Move | Learners | What it wants |
| --- | --- | --- |
| **Worry Seed** | 27 | the target's ability becomes Insomnia |
| **Gastro Acid** | 25 | the target's ability is switched off |
| **Entrainment** | 23 | the target's ability becomes the user's |
| **Role Play** | 17 | the user's ability becomes the target's |
| **Skill Swap** | 12 | the two exchanged |
| **Simple Beam** | 7 | the target's ability becomes Simple — which is not in either |
| **Doodle** | 1 | Role Play for the whole party |

## Waiting on stage-passing across a switch

A switch clears every stage and every volatile, on purpose. These three want
one specific exception to that, which is a second kind of switch rather than a
flag on the first.

| Move | Learners | What it wants |
| --- | --- | --- |
| **Baton Pass** | 47 | the user leaves and its stages and volatiles stay for the next one |
| **Shed Tail** | 3 | the same, with a Substitute left behind |
| **Parting Shot** | 7 | the target's Attack and Sp. Atk down, and then the user leaves |

## Waiting on an on-arrival hook that survives the switch path

`onArriving` exists — Intimidate uses it — but it is asked about the creature
arriving, not about what was laid on the ground before it did. Hazards are a
thing on the *side* that bites whoever steps in.

| Move | Learners | What it wants |
| --- | --- | --- |
| **Stealth Rock** | 36 | a Rock hit by the type chart on every arrival |
| **Toxic Spikes** | 26 | a poison on arrival, twice for the worse kind |
| **Sticky Web** | 16 | a Speed stage off on arrival |
| **Spikes** | 14 | an eighth, a sixth, a quarter, by how many layers |
| **Tidy Up** | 1 | the hazards swept up, and a stage of Attack and Speed |

## Waiting on more than a call

`executeMove` takes a depth now and refuses past one, and Metronome, Copycat,
Mirror Move, Sleep Talk, Assist and Instruct went in on it. These five are
callers too, and each wants one more thing the battle does not have.

| Move | Learners | What it wants |
| --- | --- | --- |
| **Me First** | 19 | the target's *chosen* move for this turn, and a half again on its power — the turn knows what was chosen, but no move can yet say "harder" |
| **Nature Power** | 11 | a move by the ground it is standing on, which a battle does not know — Camouflage's problem |
| **Snatch** | 13 | the target's status move, stolen before it goes off — a hook in front of the other side's move |
| **Magic Coat** | 12 | the target's status move, bounced back — the same hook |
| **Mimic** | 12 | Sketch that wears off when it leaves — a move slot that needs putting back on a switch |

## Waiting on items that move in a battle

The bag is engine state and the battle does not touch it. A held item is
read in a battle and can be *spent* in one, but never handed across, and every
one of these hands something across.

| Move | Learners | What it wants |
| --- | --- | --- |
| **Embargo** | 25 | the target's item switched off for five turns |
| **Recycle** | 22 | a spent berry, back |
| **Switcheroo**, **Trick** | 17, 16 | the two held items exchanged |
| **Bestow** | 15 | the user's item given to the target |
| **Stuff Cheeks** | 2 | the berry eaten now, for two stages of Defence |
| **Teatime** | 1 | everybody eats their berry |

## Risky: move restriction

These change *which moves are legal*, which is the one class of effect that
can make a battle unwinnable. Struggle and `hasLegalMove` are the safety net;
run the deadlock probe while building it, and expect it to earn its keep.

| Move | Learners | What it wants |
| --- | --- | --- |
| **Taunt** | 83 | no status moves for three turns |
| **Disable** | 51 | the last move, refused for four turns |
| **Encore** | 47 | the last move, and *only* the last move, for three turns |
| **Imprison** | 41 | any move the user also knows, refused |
| **Torment** | 37 | no move twice in a row |
| **Heal Block** | 24 | no mending for five turns |
| **Grudge** | 13 | the move that fainted the user loses all its uses |
| **Substitute** | 15 | a decoy at a quarter of the user's health, in front of *every* damage path in the file |
| **Powder** | 3 | a Fire move next turn hurts its user instead |
| **Electrify** | 3 | the target's move becomes Electric this turn |
| **Octolock** | 1 | trapped, and a stage of each guard off every turn |

## Not worth doing

The doubles-only moves are meaningless in a game that is 1v1 throughout: there
is no ally to help, redirect to, or guard. Rototiller wants soft soil and
Secret Power wants a base. Curse is a genuine oddity — two different moves
depending on whether the user is a Ghost — and the manifest has no way to say
so.

| Move | Learners | Why not |
| --- | --- | --- |
| **Helping Hand** | 89 | an ally's move, harder |
| **Quick Guard**, **Wide Guard**, **Crafty Shield**, **Mat Block** | 37, 35, 7, 3 | the side shielded from one kind of move |
| **After You**, **Quash** | 21, 6 | the target moves next, or last |
| **Ally Switch** | 17 | the two allies change places |
| **Rage Powder**, **Follow Me**, **Spotlight** | 14, 10, 6 | every move aimed at one creature |
| **Magnetic Flux**, **Gear Up** | 10, 3 | the allies with Plus or Minus, raised |
| **Rototiller** | 11 | every Grass type standing on soft soil |
| **Dragon Cheer** | 0 | an ally's crit ladder, and no species learns it anyway |
| **Curse** | 66 | two moves under one name |
