# Abilities waiting on a mechanic

Every ability in `src/engine/abilities.ts` is built out of a shape the battle
already understands. This is the other list: the ones that are *not* there, and
the one thing each is waiting for.

It is written down rather than approximated. An ability that half works is
worse than one that visibly does not exist yet — a player who catches a
creature with Static and finds it does nothing has learned that abilities are
unreliable, which is a much more expensive lesson than "there are 313 of these
and 90 are in".

Each heading below is **one mechanic**. Adding it unlocks everything under it
at once, which is what makes this a plan rather than a wishlist. They are in
rough order of how much the game gets back per unit of work.

---

## 1. Move flags — contact, punch, bite, sound, pulse, slicing, ballistic, powder

**What is missing.** `moves.json` carries type, category, power, accuracy, PP,
priority, crit ratio, target, status, boosts, secondary, drain, recoil and
heal. It does not carry the flag set. `@pkmn/dex` has it, so this is a
`scripts/build-dex.mjs` change and one new field — the cheapest item on this
list by a wide margin.

**Deliberately not approximated.** "Physical" is not "contact": Earthquake and
Rock Slide are physical and touch nothing, and Grass Knot is special and
absolutely does. Wiring Static to `category === "physical"` would give roughly
the right answer often enough to look correct and be wrong in exactly the
matchups people plan around.

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

**What is missing.** There is no field state at all. Weather needs a duration,
a source, a way for it to end, and hooks in the damage formula, in accuracy, in
residual damage and in speed. It is the largest single item here and it unlocks
the most.

| Ability | Waiting on |
| --- | --- |
| Drought, Drizzle, Sand Stream, Snow Warning, Desolate Land, Primordial Sea, Delta Stream | setting weather |
| Chlorophyll, Swift Swim, Sand Rush, Slush Rush, Solar Power | reading weather |
| Rain Dish, Ice Body, Dry Skin (the healing half), Hydration | reading weather |
| Sand Veil, Snow Cloak, Sand Force | reading weather |
| Cloud Nine, Air Lock | suppressing weather |
| Flower Gift, Forecast | weather plus form change |

## 3. Terrain

**What is missing.** The same field state as weather, plus a second slot for
it, and grounded-ness (which needs Levitate and Flying to be asked the same
question in one place).

| Ability | Waiting on |
| --- | --- |
| Grassy Surge, Misty Surge, Electric Surge, Psychic Surge | setting terrain |
| Grass Pelt, Surge Surfer | reading terrain |
| Mimicry | reading terrain |

## 4. Held items

**What is missing.** A creature has no item slot. This is a small data change
and a large design one: the item catalogue would need battle items, and the
"census, not lottery" rule has to have something to say about where they come
from.

| Ability | Waiting on |
| --- | --- |
| Klutz, Unburden, Harvest, Pickup, Symbiosis, Ripen | a held item |
| Magician, Pickpocket (the stealing half), Sticky Hold | a held item |
| Unnerve, As One (the Unnerve half) | a held berry |

## 5. Volatile conditions — confusion, infatuation, trapping, flinching

**What is missing.** `Individual.status` holds one non-volatile condition.
There is nowhere to put a condition that belongs to a *slot in a battle* rather
than to a creature, and no turn counter for one.

| Ability | Waiting on |
| --- | --- |
| Own Tempo, Tangled Feet | confusion |
| Oblivious, Cute Charm (the infatuation half) | infatuation |
| Inner Focus, Stench, Steadfast | flinching |
| Shadow Tag, Arena Trap, Suction Cups | trapping / forced switches |
| Run Away | escape, which wild battles do differently here |

## 6. Multi-hit and fixed-damage move shapes

**What is missing.** `moves.ts` already computes the damage the manifest cannot
express, but a move still lands exactly once.

| Ability | Waiting on |
| --- | --- |
| Skill Link, Parental Bond | multi-hit |
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
