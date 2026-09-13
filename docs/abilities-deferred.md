# Abilities waiting on a mechanic

Every ability in `src/engine/abilities.ts` is built out of a shape the battle
already understands. This is the other list: the ones that are *not* there, and
the one thing each is waiting for.

It is written down rather than approximated. An ability that half works is
worse than one that visibly does not exist yet — a player who catches a
creature with Static and finds it does nothing has learned that abilities are
unreliable, which is a much more expensive lesson than "there are 313 of these
and 112 are in".

Each heading below is **one mechanic**. Adding it unlocks everything under it
at once, which is what makes this a plan rather than a wishlist. They are in
rough order of how much the game gets back per unit of work.

---

## 1. Move flags — contact, punch, bite, sound, pulse, slicing, ballistic, powder

**The data has arrived; the wiring has not.** This section used to say
`moves.json` did not carry the flag set and that copying it was the cheapest
item on the list. It was, and it has been done: `scripts/build-dex.mjs` copies
it, `MoveEntry.flags` holds it, and 263 moves say `contact`, 24 `punch`, 10
`bite`, 32 `sound`, 7 `pulse`, 25 `slicing`, 26 `bullet` and 8 `powder`.

It was copied for `charge` and `recharge` — the two-turn and beam moves needed
it — and the rest came along in the same field, which was the argument for
carrying the whole useful set at once rather than two flags with a caller.

So **every row below is now an engine change of a few lines rather than a data
problem**, and this is the cheapest section on this list by a wider margin than
before. The place to put most of them is `landDamage`, where the blow is
already known to have landed and the move is in hand.

**Deliberately not approximated.** "Physical" is not "contact": Earthquake and
Rock Slide are physical and touch nothing, and Grass Knot is special and
absolutely does. Wiring Static to `category === "physical"` would give roughly
the right answer often enough to look correct and be wrong in exactly the
matchups people plan around. That trade no longer has to be made either way.

| Ability | Waiting on |
| --- | --- |
| Static, Flame Body, Poison Point, Cute Charm, Effect Spore | `contact` |
| Rough Skin, Iron Barbs, Aftermath | `contact` |
| Gooey, Tangling Hair, Mummy, Lingering Aroma, Wandering Spirit | `contact` |
| Pickpocket, Perish Body, Cotton Down, Sand Spit, Seed Sower | `contact` |
| Iron Fist, Punk Rock, Strong Jaw, Mega Launcher, Sharpness | the matching flag |
| Soundproof, Bulletproof, Overcoat (powder half) | the matching flag |
| Reckless (the *other* half — jump-kick moves) | `recharge` / crash flags |

## 2. Weather

**What is in.** The field exists — `src/engine/field.ts` — and twenty-three
abilities went in with it: the four that bring a weather, the four that lay
a terrain, and the fifteen that read one. What is left here wants something
beyond the field.

| Ability | Waiting on |
| --- | --- |
| Desolate Land, Primordial Sea, Delta Stream | a weather that cannot be replaced or ended |
| Solar Power | two effects under one name — a stat and a per-turn cost |
| Dry Skin | three effects under one name — an absorb, a weakness, and a per-turn heal or cost |
| Flower Gift, Forecast | weather plus form change |

## 3. Terrain

**What is in.** The same field state, a second slot, and grounded-ness asked in
one place — Flying, Levitate and Magnet Rise are the three ways off the ground.

| Ability | Waiting on |
| --- | --- |
| Mimicry | terrain plus a type change of its own |

## 4. Held items

**Also out of date.** This said a creature has no item slot.
`Individual.heldItem` is that slot, 111 held items and berries are in, and the
battle reads and spends them — see [`items.md`](./items.md).

What is left is not the slot but the *moving*: an item that is given, taken,
swapped or switched off crosses from battle state into the bag, which is the
line `docs/moves-deferred.md` draws under its own "items that move in a battle"
heading.

| Ability | Waiting on |
| --- | --- |
| Klutz, Unburden, Harvest, Ripen | nothing — each reads `heldItem` and is simply not built |
| Sticky Hold | an item that can be taken, so there is something to hold on to |
| Magician, Pickpocket (the stealing half), Symbiosis, Pickup | an item changing hands mid-battle |
| Unnerve, As One (the Unnerve half) | a held berry being *withheld*, which `eatBerry` has no hook for |

## 5. Volatile conditions — all of which now exist

**This section is out of date and worth reading as a record of that.** It said
there was nowhere to put a condition belonging to a slot rather than a
creature. `Combatant.volatiles` is that place, it holds thirty-odd fields, and
every condition this section was waiting on is in it: `confusion` and
`infatuated` arrived with the status moves, `trapped` with Mean Look, and
`flinched` with the twenty-eight moves that cause it. Forced switches are in
too — Roar and Whirlwind through `forceOut`, Dragon Tail and Circle Throw
through the move row.

So none of these is blocked. They are simply not built.

| Ability | Reads |
| --- | --- |
| Own Tempo, Tangled Feet | `confusion` |
| Oblivious, Cute Charm (the infatuation half) | `infatuated` |
| Inner Focus, Steadfast | `flinched` |
| Stench | a flinch chance added to every move, which is the one that wants new plumbing rather than a read |
| Shadow Tag, Arena Trap, Suction Cups | `trapped`, `bound`, and the two force-out paths |
| Run Away | escape, which wild battles do differently here |

Inner Focus is the pick of them: one line in `canAct`, and it is the answer to
a mechanic the game has just grown.

## 6. Multi-hit and fixed-damage move shapes

**Half of this has arrived too.** It said a move still lands exactly once;
thirty-one of them now land two to five times, and `hitsOf` is the loop.

| Ability | Waiting on |
| --- | --- |
| Skill Link | nothing — `hitsOf` returning the top of the range |
| Parental Bond | a second swing at half power, which the loop can express |
| Sheer Force | secondary effects being *removable* per hit |
| Serene Grace | secondary chance doubling — trivial once Sheer Force's shape exists |

## 7. Abilities that read or suppress other abilities

**What is missing.** Nothing reads an opponent's ability list. The shape exists
(`effects()`); what is missing is the decision about ordering and about what
happens when two of these meet.

| Ability | Waiting on |
| --- | --- |
| Mold Breaker, Teravolt, Turboblaze | ignoring the target's ability |
| Trace, Imposter, Power of Alchemy, Receiver | copying an ability |
| Neutralizing Gas | suppressing every ability at once |
| Unaware | ignoring stat stages, which is close but not the same shape |

## 8. Form changes

**What is missing.** A creature's species is fixed except by evolution, and
evolution is permanent. A form that changes mid-battle and changes back is a
different thing entirely.

| Ability | Waiting on |
| --- | --- |
| Disguise, Ice Face, Zen Mode, Schooling, Shields Down, Gulp Missile | in-battle form change |
| Stance Change, Battle Bond, Power Construct, Hunger Switch | in-battle form change |

## 9. Entry hazards and screens

| Ability | Waiting on |
| --- | --- |
| Magic Bounce | bouncing hazards and status moves back |
| Screen Cleaner | screens |
| Toxic Debris | hazards |

---

## Deliberately excluded, not deferred

Two are not on the list above because they are shapes this game *has* and still
should not be handed out at random.

**Wonder Guard.** Only super-effective moves land. With abilities rolled rather
than assigned, a wild creature carrying it could be one that a player has no
super-effective answer to — and because Struggle is deliberately neutral rather
than exempt, Wonder Guard would block Struggle too. That is a battle that can
be neither won nor left, which is the exact failure the deadlock probe exists
to prevent. It would need a Struggle exemption to be safe, and a Wonder Guard
with a hole in it is not Wonder Guard.

**Truant, Slow Start, Stall, and the other self-inflicted ones.** They work
fine mechanically. They are excluded because an ability here is something a
creature is *lucky* to have — one in ten carries anything at all — and rolling
a penalty onto a creature you were pleased to catch reads as a bug rather than
as a trade. Defeatist is in because halving both attacking stats below half
health is a real cost attached to nothing, but it is the only one, and it is
there to keep the roll from being pure upside.
