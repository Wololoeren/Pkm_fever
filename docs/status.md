# Status

Everything that can be true of a creature in a battle beyond its health, and
the exact arithmetic of each.

**The grouping is the lifetimes**, because where a condition is stored is the
whole of what it means. Five conditions live on the `Individual` and survive
the battle; the volatiles and the two stat ladders live on the `Combatant` and
are gone the moment it switches out; screens live on the `Combatant` too but
outlive whoever is standing there. A player has no reason to care which is
which until they switch, at which point most of the badge row emptying out is
the explanation.

Every number below is **integer arithmetic**, with a `Math.floor` at every
step. That is not a style preference: a battle is a pure function of its seed,
and a float is a rounding difference waiting to make two machines disagree
about who won.

---

## The five conditions

On the creature. They follow it into the box, and only a Center, a Full Heal or
a Rest clears one.

| | Per-turn damage | Other arithmetic | How it ends |
| --- | --- | --- | --- |
| **BRN** Burn | `max(1, floor(maxHp / 16))` | physical damage `floor(value / 2)` | nothing ends it |
| **PSN** Poison | `max(1, floor(maxHp / 8))` | — | nothing ends it |
| **PAR** Paralysis | — | Speed `floor(value / 2)`; **25%** each turn to lose the turn | nothing ends it |
| **SLP** Sleep | — | loses the turn | a counter set to **1, 2 or 3** on landing |
| **FRZ** Freeze | — | loses the turn | a **20%** roll every turn |

One creature carries one condition. `applyStatus` refuses a second, and it is
the single gate every road to a status goes down — a move's own, a secondary, a
Yawn coming due, an ability, an item.

### Two things that are not what they look like

**Sleep costs nought, one or two turns — not one to three.** The counter is set
to `1 + intBelow(rng, 3)`, and `canAct` wakes the creature when it reaches 1
*and lets it move that same turn*. So a roll of 1 costs nothing at all, and a
third of every sleep landed in this game is a wasted move by whoever cast it.

**Freeze is the harshest thing in the table.** Twenty percent a turn is a mean
of five lost turns, and unlike the games this one has **no thaw on being hit by
a Fire move** — the roll is the only way out. Nothing else here can take five
turns off somebody.

### Who cannot catch what

| Condition | Immune types |
| --- | --- |
| **BRN** | Fire |
| **FRZ** | Ice |
| **PAR** | Electric |
| **PSN** | Poison, Steel |
| **SLP** | *nothing* |

Abilities add to this — Immunity, Limber, Water Veil, Insomnia, Magma Armor —
and Safeguard refuses all five at once for five turns. Attract is not a
condition and is refused by none of them; it is refused by gender. All three are asked in
`applyStatus`, so none of them can be true in one place and not another.

---

## The volatiles

On the appearance. Switching out clears every one of them, which is the
cheapest answer to most of the list.

| | Arithmetic |
| --- | --- |
| **Seeded** | `max(1, floor(maxHp / 8))` off, and **the same number healed across the field** — capped by the other side's room, so a full creature gains nothing and no health appears out of nowhere |
| **Nightmare** | `max(1, floor(maxHp / 4))`, and **only while asleep**. It clears itself the moment the sleep ends rather than lingering on something awake |
| **Confused** | **4 turns**. Each turn, a **33%** chance to hit itself instead, for `floor((floor(2·level/5) + 2) · 40 · atk / def / 50) + 2` — its own Attack against its own Defence, **40 power**, no type multiplier and no critical hit |
| **Drowsy** (Yawn) | **2 turns**, then sleep — applied through `applyStatus`, so a Safeguard or an Insomnia still says no at the last moment |
| **Perish** | counts **4** down to 0; at 0, `applyDamage(hp)`. Exact, unavoidable, and switching out is the only answer |
| **Shield** | nothing lands on it this turn |
| **Endure** | it survives at `hp - 1` |
| **Crit** (Focus Energy) | *n* stages up the crit ladder |
| **Trapped** | it cannot switch out and it cannot run |
| **Rooted** (Aqua Ring, Ingrain) | `max(1, floor(maxHp / 16))` back every turn, before the seed drains. Ingrain also traps the user, and a Roar does not move it |
| **Infatuated** (Attract) | a **50%** chance each turn to lose the turn, asked after confusion. Lands only where `gendersPair` says the two would — the same question breeding asks |
| **Altered** (Power Split, Guard Split, Speed Swap) | the *number* the stages multiply, averaged or exchanged with the foe's. A stage landed afterwards still multiplies it; a switch throws it away |
| **Stockpile** | a counter, up to **3**. Each count is a stage of Defence and Sp. Def; Swallow spends it for a quarter, a half, everything, and Spit Up for 100 power a count. Either takes the stages back |
| **Locked on** (Lock-On, Mind Reader) | the next move cannot miss. Spent by that move whatever it was |
| **Bonded** (Destiny Bond) | the *move* that knocks it out takes its user down too. Held until the bonded creature next moves; a poison or a seed has nobody to take |
| **Wish** | **2 turns**, then `floor(maxHp / 2)` of *whoever is standing there*. It is a fact about the slot, so a switch throws the wish away with the rest |
| **Blessing** (Healing Wish, Lunar Dance) | the user faints, and the one that replaces it arrives at full health with no condition. Refused with nobody in reserve |
| **Retyped** (Soak, Reflect Type, Conversion, Forest's Curse) | its types are these now rather than its species', and every question about a type — the chart, the same-type bonus, a status immunity, a seed, a Prankster — is asked of them. A switch restores its species' |
| **Seen** (Foresight, Odor Sleuth, Miracle Eye) | its Ghost does not stop Normal and Fighting, or its Dark does not stop Psychic. Scrappy for one battle |
| **Afloat** (Magnet Rise, Telekinesis) | Ground *attacks* do nothing to it, for **5** or **3** turns. A Sand Attack still lands |

### The shield streak

A shield put up on consecutive turns gets rarer, and that is the whole of what
stops Protect being the answer to everything:

```
odds = max(1, floor(100 / 3 ** streak))
```

**100%**, then **33%**, then **11%**, then **3%**. One failure resets the
streak to nought, so the cost is paid for pressing it again rather than for
having pressed it at all.

### The crit ladder

`CRIT_ODDS = [24, 8, 2, 1]` — one in twenty-four, one in eight, one in two,
always. A move's own `critRatio`, Focus Energy's stages and the `luck`
abilities and items all walk the **same ladder**, which is why Focus Energy has
no odds of its own to get out of step with.

Five moves skip the ladder entirely and always crit: Frost Breath, Storm
Throw, Wicked Blow, Flower Trick and Surging Strikes. A Lucky Chant stops even
those.

---

## The two ladders

Both clamp to ±6, and both are kept as a **numerator and denominator pair**
rather than a decimal, so nothing rounds twice.

**Stats** — halves. This is the ladder Attack, Defence, Sp. Atk, Sp. Def and
Speed walk:

```
stage >= 0  ?  (2 + n) / 2  :  2 / (2 - n)
```

| Stage | −6 | −4 | −2 | −1 | 0 | +1 | +2 | +4 | +6 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Multiplier | ÷4 | ÷3 | ÷2 | ÷1.5 | ×1 | ×1.5 | ×2 | ×3 | ×4 |

**Accuracy and evasion** — thirds. Not a simplification of the above: it is a
different ladder, and at +6 evasion is three times itself rather than four.

```
stage >= 0  ?  (3 + n) / 3  :  3 / (3 - n)
```

The two are combined into **one fraction** rather than applied as two
roundings, so lowering accuracy by a stage and raising evasion by a stage
cancel exactly:

```
accuracy = max(1, min(100, floor(accuracy · an · ed / (ad · en))))
```

Paralysis is applied to Speed *after* the stage multiplier and *before* the
abilities, which is why a paralysed creature with Quick Feet ends up faster
than one that is merely paralysed — that ordering is what carrying it is for.

Seventeen moves move the **user's own** stages rather than the target's, and
sixteen of those are a cost: Close Combat's guard, Overheat's Sp. Atk,
Superpower spending the Attack it just hit with. Paid after the damage, and
deliberately not blocked by a Clear Body or a Mist — those answer "can the
other side lower my stages", and this is not the other side.

---

## The six screens

On the side. A screen does not stop mattering because you switched, and that is
the point of it. All six last **5 turns**.

| | Arithmetic |
| --- | --- |
| **Reflect** | physical damage `floor(value / 2)` |
| **Light Screen** | special damage `floor(value / 2)` |
| **Tailwind** | Speed `base × 2` |
| **Mist** | refuses stat drops **caused by the other side** — its own costs still apply |
| **Safeguard** | refuses every status condition |
| **Lucky Chant** | no critical hits against that side at all |

Reflect and Light Screen are halved off the running damage value rather than by
doubling the defence, because doubling a defence would round differently for an
odd one.

---

## The field

On the battle, not on either side. Weather, terrain and the two sports are
each an id and a count, all lasting **5 turns**, absent when nothing is up.
Cloud Nine and Air Lock do not end a weather: they stop it being felt while
their owner stands there. "Grounded" is one question — not Flying, not
Levitating, not under Magnet Rise — asked wherever a terrain reads it.

| | Arithmetic |
| --- | --- |
| **Sun** | Fire ×1.5, Water ×0.5. Thunder and Hurricane at 50. Synthesis, Moonlight and Morning Sun mend two thirds |
| **Rain** | Water ×1.5, Fire ×0.5. Thunder and Hurricane cannot miss |
| **Sand** | `max(1, floor(maxHp / 16))` a turn off anything not Rock, Ground or Steel. A Rock type's Sp. Def ×1.5. Shore Up mends everything |
| **Hail** | the same sixteenth off anything not Ice. Blizzard cannot miss |
| **Snow** | an Ice type's Defence ×1.5, and no residual. Blizzard cannot miss |
| **Electric Terrain** | Electric ×1.3 from a grounded attacker; a grounded creature cannot fall asleep |
| **Grassy Terrain** | Grass ×1.3 from a grounded attacker; a sixteenth back to every grounded creature a turn |
| **Misty Terrain** | Dragon ×0.5 into a grounded target; a grounded creature takes no condition |
| **Psychic Terrain** | Psychic ×1.3 from a grounded attacker; nothing with priority reaches a grounded target |
| **Water Sport**, **Mud Sport** | Fire ×0.333, or Electric ×0.333 |

The three sun-readers mend a quarter in any weather that is not sun. Solar
Beam and Solar Blade are ×0.5 in any weather that is not sun, and never need
a turn to charge here. Weather Ball is the weather's type at 100 power. Aurora
Veil is Reflect and Light Screen together, and only while it hails or snows.

In the formula below, the field's multipliers land **between the same-type
bonus and the abilities**, so a Sand Force compounds on top of the sand.

## Where each of these lands in the damage formula

The order is the arithmetic. Written out, because "burn halves your attack" is
a different number depending on where you say it:

```
 1.  floor(2 · level / 5) + 2
 2.  floor(value · power · attack / defence)       ← stat stages are in here
 3.  floor(value / 50) + 2
 4.  Reflect / Light Screen      floor(value / 2)
 5.  critical hit                floor(value · 3 / 2)
 6.  spread roll 85–100          floor(value · spread / 100)
 7.  same-type bonus             ×1.5  (×2 with Adaptability)
 7a. the field                   sun, rain, terrain, sport
 8.  power abilities and items
 9.  type chart                  floor(value · quarters / 4)
10.  cushion / pierce / ward abilities
11.  BURN                        floor(value / 2)
12.  max(1, value)
```

**Burn is last.** So it halves everything else rather than being halved by the
type chart, and a burned creature hitting for super-effective damage loses half
of the doubled number. Guts skips step 11 entirely.

Type effectiveness travels in **quarters** — 4 is neutral, 8 doubled, 2
resisted, 0 immune — and two types multiply as `floor(quarters · row / 4)`, so
the smallest a pair can produce is 1 and the arithmetic never leaves the
integers.

---

## What is not here

**Toxic does not escalate.** The manifest carries `tox` and `conditionOf` maps
it to ordinary poison: the same immunities, the same eighth a turn, without the
doubling. It is a normaliser rather than a special case at one call site,
because the alternative is a crash — `STATUS_IMMUNE["tox"]` is `undefined`, and
`.includes` on it throws from a move that is perfectly legal. That one survived
until the rival started drawing moves from the whole dex.

**Freeze has no thaw on a Fire hit**, as above. It is the one condition here
that is meaningfully harsher than its namesake.

**Toxic Spikes, Stealth Rock and the rest of the hazards** are not here; they
want an on-arrival hook, and `docs/moves-deferred.md` says so.

**Sixteen further conditions are filtered out of every move pool** rather than
dealt as slots that do nothing: Substitute, Taunt, Encore, Disable and the rest
of the move-restriction family, the hazards, Baton Pass. `src/engine/
statusmoves.ts` is the list, and `README.md` groups them by the one capability
each is waiting for.
