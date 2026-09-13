# Items not in yet

The companion to [`items.md`](./items.md), and the same rule
[`abilities-deferred.md`](./abilities-deferred.md) follows: an item that half
works teaches a player that items are unreliable, which is a much more
expensive lesson than "that one is not in yet".

So nothing here is approximated. Each is filed under **the one mechanic it is
waiting for**, because that is the useful ordering: build the mechanic and a
whole row arrives at once. Most rows are one mechanic away.

---

## Unblocked, and not built

**This section used to be the top of the list and it is now the bottom of the
argument.** It read "nothing in the game has a volatile yet", and that has not
been true for some time: confusion, trapping and eleven others arrived with the
status moves, and flinching, partial trapping and the two-turn charge arrived
with the damaging ones — see the second table in [`status.md`](./status.md).

So these are no longer waiting on a mechanic. The mechanic is there, the item
is not, and each is now a small piece of wiring rather than a feature:

| Item | Reads |
| --- | --- |
| **King's Rock**, **Razor Fang** | `flinched`, which Iron Head and twenty-seven others already set |
| **Persim Berry** | `confusion`, to cure |
| **Berserk Gene** | `confusion`, to cause |
| **Binding Band**, **Grip Claw** | `bound` — a harder squeeze, and a longer hold |
| **Shed Shell** | `bound` and `trapped`, as the one way out of either |
| **Power Herb** | `committed` with `commitment: "charge"`, skipped the way sun already skips a Solar Beam |

That last one is the cheapest of the six and the most worth having: the engine
already has the exact shape in `chargeSkipped`, and a Power Herb is that
function returning true for one turn.

## Still waiting on a volatile

The rest of the group, and what each still wants. A **volatile** is a condition
that lives on a creature for the rest of a battle and then is gone.

| Item | What it needs |
| --- | --- |
| **Lansat Berry** | A crit-ratio boost that persists past the turn |
| **Custap Berry** | A one-turn priority flag |
| **Micle Berry** | A one-turn accuracy flag |
| **Starf Berry** | A random stat +2 — the roll is easy, the "once" is not |
| **White Herb** | A record of which stages were lowered |
| **Mental Herb** | Taunt, Encore, Torment, Disable |
| **Throat Spray** | A "used a sound move" flag — the `sound` flag is carried now, the record of having used one is not |
| **Room Service** | Trick Room |
| **Mirror Herb** | A record of what the other side just gained |
| **Blunder Policy** | A "missed" flag that survives to the boost |

Big Root looked like it belonged here and does not: draining moves were already
implemented, so it was one shape and no new mechanic. It is **in**.

---

## Waiting on weather

There is weather now, and these still wait: each wants to change how long it
lasts or who feels it, and the field has no hook for either yet.

| Item | What it does |
| --- | --- |
| **Heat Rock**, **Damp Rock**, **Smooth Rock**, **Icy Rock** | Extends its weather |
| **Utility Umbrella** | Ignores sun and rain |
| **Safety Goggles** | Ignores sand and hail (and powder moves) |

The abilities that read the weather are in; these are the items that would
adjust it.

---

## Waiting on terrain and screens

Also absent, and also battle-level state.

| Item | What it does |
| --- | --- |
| **Terrain Extender** | Extends its terrain |
| **Light Clay** | Extends Reflect and Light Screen |

---

## The contact flag, which has arrived

This section said "the move manifest carries no flags at all", and that was the
whole obstacle. **It is no longer true.** `scripts/build-dex.mjs` now copies
the flag set, `MoveEntry.flags` carries it, and 263 moves say `contact`, 24 say
`punch` and 10 say `bite`. It was copied for the charge and recharge mechanics
and these came along for free, which was the argument for carrying the whole
useful set rather than the two flags with a caller.

So none of these is waiting on data any more. Each is an engine change of a few
lines, in `landDamage` where the blow is known to have landed:

| Item | What it does |
| --- | --- |
| **Rocky Helmet** | Contact costs the attacker 1/6 |
| **Sticky Barb** | Contact passes the barb to the attacker |
| **Protective Pads** | Its own contact moves stop being contact |
| **Punching Glove** | Punching moves ×1.1, and stop being contact |

Jaboca and Rowap Berry are **in**, and were the closest honest version of this
shape while the data was missing: they read the move's *category*, which the
manifest always carried. Rocky Helmet as "any physical move" was considered and
rejected — it is a different item, and calling it Rocky Helmet would be the
half-working kind. That trade no longer has to be made.

---

## Multi-hit, which has also arrived

This said "no move hits more than once", and that stopped being true when
`multihit` started being copied across: thirty-one moves land two to five
times, and `hitsOf` is the loop this section said did not exist.

| Item | What it does |
| --- | --- |
| **Loaded Dice** | Multi-hit moves hit four or five times — `hitsOf` returning the top of the range |

---

## Waiting on weight

The manifest carries no weight, so Low Kick and Heavy Slam already stand in
with a fixed power — see the placeholders in `moves.ts`.

| Item | What it does |
| --- | --- |
| **Float Stone** | Halves the holder's weight |
| **Iron Ball** | Doubles it, and grounds the holder |

Another build-script change: the weight is in the source data.

---

## Waiting on friendship

There is no friendship, and adding one is a design decision rather than a
plumbing one: it would be a number that goes up as you play, which is the
opposite of everything else here being derived from the input log.

| Item | What it does |
| --- | --- |
| **Soothe Bell** | Friendship grows faster |
| Nineteen `levelFriendship` evolutions | Espeon, Umbreon, Togetic, Riolu and the rest |

The nineteen are the loud part. They are in the manifest and unreachable, and
the honest fix may be a different one entirely — a stone for each, or a
"levelled up somewhere specific" condition. Worth a decision rather than an
implementation.

---

## Waiting on forced switching

A battle resolves both sides' actions together, so "the other side is now
somebody else, mid-turn" is a shape the turn loop does not have.

| Item | What it does |
| --- | --- |
| **Eject Button**, **Eject Pack** | Switches its holder out |
| **Red Card** | Switches the *attacker* out |

---

## Waiting on hazards

Nothing is ever on the ground. Spikes, Stealth Rock and Toxic Spikes are
per-side state that fires on arrival.

| Item | What it does |
| --- | --- |
| **Heavy-Duty Boots** | Ignores them |

---

## Waiting on the bag, in a battle

`itemRefusal` refuses anything outside the `field` phase, deliberately: an
item used mid-battle is a free action, and a duel resolves both peers' actions
together, so it would have to become a `BattleAction` that both sides agree
about. That is a protocol change rather than an item.

| Item | What it does |
| --- | --- |
| **X Attack**, **X Defend**, **X Speed**, **X Sp. Atk**, **X Sp. Def**, **X Accuracy** | A stage, from the bag |
| **Dire Hit** | Crit ratio, from the bag |
| **Guard Spec.** | Blocks stage drops, from the bag |
| Potions and Revives *during* a battle | They work in the field already |

Worth doing, and it is one input plus one action shape. It is filed here rather
than done because it changes what a battle *is*, and every balance number
measured so far — the Cup especially — assumes you cannot heal mid-fight.

---

## Waiting on reading an ability as data

An ability is a list of ids on a creature. Nothing changes, suppresses or
copies one, so an item that protects an ability has nothing to protect it from.

| Item | What it does |
| --- | --- |
| **Ability Shield** | Stops its ability being changed |
| **Ability Capsule**, **Ability Patch** | Changes the ability |

The Capsule and the Patch are a **deliberate exclusion** as well as a deferral.
Abilities here are rolled once and inherited by breeding — 89% of wild
creatures have none, and the only route to three is a bred lineage. An item
that rerolls them would undo the whole of that. If they ever arrive they should
be the rarest thing in the game, not a shop row.

---

## Waiting on a form change

No creature changes species mid-battle.

| Item | What it does |
| --- | --- |
| **Mega Stones** (all of them) | Mega evolution |
| **Z-Crystals** (all of them) | One-per-battle Z-moves |
| **Tera Shards** | Terastallisation |
| **Adamant / Lustrous / Griseous Crystal** | Origin forms |
| **Rusted Sword**, **Rusted Shield** | Crowned forms |
| **Reveal Glass**, **Prison Bottle**, **Gracidea**, **Red / Blue Orb**, **DNA Splicers**, **Zygarde Cube**, **N-Lunarizer** and the rest | A form each |

The three legendary **Orbs** are in — those are the type-boosting items, not
the form-changing Crystals.

---

## Deliberately not in

Not deferred. These would work today and should not exist here.

| Item | Why not |
| --- | --- |
| **Ether**, **Max Ether**, **Elixir**, **Max Elixir** | `pp.ts` says it in as many words: PP comes back at a Center or by losing, and a bottle that refilled it would undo the one resource this game asks you to budget. The Cup is balanced on exactly that |
| **PP Up**, **PP Max** | The same, permanently |
| **Bottle Cap**, **Gold Bottle Cap** | Sets IVs to perfect. Breeding *is* the IV system — ten to fifteen generations to perfect one stat — and a shop row that skips it would make the pillar decorative |
| **Rare Candy** | Already in, and priced so that fighting stays the cheaper road |
| **Exp. Share** | Would work, and shouldn't be free: experience is earned by whatever was standing, which is what makes the switch a decision. It is a balance change, not an item |
| **Berries for planting** | There is no growing anything, and adding soil is a different game |
| **Vitamins beyond the six** | There are six stats |
| **Poké Doll**, **Fluffy Tail**, **Poké Toy** | A Smoke Ball is in and does this better: an item that guarantees an escape is worth having, and three of them is two too many |
| **Repel candles, Lures (the encounter kind)** | The nine Shiny and Chroma lures already are this, built on the census rather than on a rate |
| **Escape Rope variants**, **Fly-to-town items** | One rope, and HM Fly |

---

## What the two lists come to

| | |
| --- | --- |
| Held items and berries **in** | 111 |
| Items in the bag **in** | 541 |
| Waiting on **one volatile** | ~17 |
| Waiting on weather, terrain or screens | 7 |
| Waiting on a **contact flag** | 4 |
| Waiting on friendship | 1 item, 19 evolutions |
| Waiting on a form change | ~40 |
| Waiting on the bag mid-battle | ~9 |
| Deliberately excluded | ~12 |

The cheapest three things to build next, in order of items-per-line:

1. **A volatile on the battle.** Flinch and confusion alone unlock four items,
   and the ability list is waiting on the same thing.
2. **Move flags in the build script.** One script change unlocks the contact
   family, and `abilities-deferred.md` wants them too.
3. **Weight in the build script.** Two items, and it retires two of the
   placeholder powers in `moves.ts`.
