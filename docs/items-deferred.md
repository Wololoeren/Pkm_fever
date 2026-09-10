# Items not in yet

The companion to [`items.md`](./items.md), and the same rule
[`abilities-deferred.md`](./abilities-deferred.md) follows: an item that half
works teaches a player that items are unreliable, which is a much more
expensive lesson than "that one is not in yet".

So nothing here is approximated. Each is filed under **the one mechanic it is
waiting for**, because that is the useful ordering: build the mechanic and a
whole row arrives at once. Most rows are one mechanic away.

---

## Waiting on a volatile

The largest group by far, and the cheapest to unlock. A **volatile** is a
condition that lives on a creature for the rest of a battle and then is gone —
confusion, flinching, a taunt, a substitute, Focus Energy. `BattleState` has
`stages` per side and nothing else, so there is nowhere to write "this one is
confused" or "this one flinched".

Nothing in the game has one yet, which is why this list is long: about half the
in-battle items in the canon are a volatile in a wrapper.

| Item | What it needs |
| --- | --- |
| **King's Rock**, **Razor Fang** | Flinch |
| **Persim Berry** | Confusion (to cure) |
| **Berserk Gene** | Confusion (to cause) |
| **Lansat Berry** | A crit-ratio boost that persists past the turn |
| **Custap Berry** | A one-turn priority flag |
| **Micle Berry** | A one-turn accuracy flag |
| **Starf Berry** | A random stat +2 — the roll is easy, the "once" is not |
| **White Herb** | A record of which stages were lowered |
| **Mental Herb** | Taunt, Encore, Torment, Disable |
| **Power Herb** | Two-turn charging moves |
| **Throat Spray** | A "used a sound move" flag |
| **Room Service** | Trick Room |
| **Mirror Herb** | A record of what the other side just gained |
| **Blunder Policy** | A "missed" flag that survives to the boost |
| **Binding Band**, **Grip Claw** | Partial trapping (Wrap, Bind, Fire Spin) |
| **Shed Shell** | Trapping (so there is something to escape) |

Flinch alone would unlock King's Rock and Razor Fang; confusion would unlock
Persim and Berserk Gene. Those two are the ones worth doing first.

Big Root looked like it belonged here and does not: draining moves were already
implemented, so it was one shape and no new mechanic. It is **in**.

---

## Waiting on weather

There is no weather. Sun, rain, sand and hail are a per-battle condition with a
duration, which is a volatile on the *battle* rather than on a creature — and
then every damage calculation has to ask about it.

| Item | What it does |
| --- | --- |
| **Heat Rock**, **Damp Rock**, **Smooth Rock**, **Icy Rock** | Extends its weather |
| **Utility Umbrella** | Ignores sun and rain |
| **Safety Goggles** | Ignores sand and hail (and powder moves) |

The ability list defers the whole weather family for the same reason, so this
row and that one arrive together.

---

## Waiting on terrain and screens

Also absent, and also battle-level state.

| Item | What it does |
| --- | --- |
| **Terrain Extender** | Extends its terrain |
| **Light Clay** | Extends Reflect and Light Screen |

---

## Waiting on a contact flag

The move manifest carries `power`, `accuracy`, `priority`, `critRatio`,
`drain`, `recoil`, `heal`, `status`, `boosts` and `secondary` — and no flags at
all. So "did that move make contact" is a question the data cannot answer.

| Item | What it does |
| --- | --- |
| **Rocky Helmet** | Contact costs the attacker 1/6 |
| **Sticky Barb** | Contact passes the barb to the attacker |
| **Protective Pads** | Its own contact moves stop being contact |
| **Punching Glove** | Punching moves ×1.1, and stop being contact |

Jaboca and Rowap Berry are **in**, and are the closest honest version of this
shape: they read the move's *category*, which the manifest does carry. Rocky
Helmet as "any physical move" was considered and rejected — it is a different
item, and calling it Rocky Helmet would be the half-working kind.

This one is a build-script change rather than an engine change: `@pkmn/dex`
has the flags, `scripts/build-dex.mjs` simply does not copy them.

---

## Waiting on multi-hit

No move hits more than once. `variableDamage` computes a number and
`landDamage` applies it, and there is no loop.

| Item | What it does |
| --- | --- |
| **Loaded Dice** | Multi-hit moves hit four or five times |

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
