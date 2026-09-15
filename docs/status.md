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

**Poison also works on the map.** Every **5** steps each poisoned creature in
the party loses **1** HP, or has a **2%** chance to be cured instead. It never
faints from this: when it reaches 1 HP the poison wears off. The screen blinks
purple when it hurts.

One creature carries one condition. `applyStatus` refuses a second, and it is
the single gate every road to a status goes down — a move's own, a secondary, a
Yawn coming due, an ability, an item.

### Two things that are not what they look like

**Sleep costs one, two or three turns.** The counter is set to
`1 + intBelow(rng, 3)` and is the number of turns still to lose: each turn it
tries to move, `canAct` takes one off and the turn is lost, and once it is at
nought it wakes *and moves that turn*. It used to wake at 1 instead, which made
a roll of 1 cost nothing and a third of every sleep a wasted move. Rest sets it
to 2.

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
| **Transformed** (Transform) | it is the foe's species with the foe's IVs, EVs, nature, abilities and moves (5 PP each), keeping its own level and health. The original is kept and put back when it leaves the field or the battle ends, so a caught Ditto is a Ditto |
| **Afloat** (Magnet Rise, Telekinesis) | Ground *attacks* do nothing to it, for **5** or **3** turns. A Sand Attack still lands |

### What a damaging move leaves behind

The rows above all arrived with the status moves. These came later and from
the other direction: a damaging move whose entire identity is a flag on its
manifest row — `charge`, `recharge`, `partiallytrapped`, a `flinch` secondary
— and which, until the build script carried those flags, was dealt out with
its power and none of its cost. Hyper Beam was a hundred and fifty power with
no recharge; Fly hit the turn it was used.

| | Arithmetic |
| --- | --- |
| **Committed** (Fly, Dig, Solar Beam; Outrage, Thrash; Rollout) | the move next turn is this one, whatever is picked. A **charge** is one turn and then the blow; a **rage** is **2–3** turns and then confusion; a **roll** is up to **5**, doubling each time. Switching out and running are both refused while it runs |
| **Away** (the `hidden` half of a charge) | up in the sky, underground, underwater or out of the world. Nothing reaches it but the short list per hiding place — Gust and Thunder find a Fly, Earthquake finds a Dig, Surf finds a Dive, and **nothing at all** finds a Phantom Force |
| **Curled** (Defence Curl) | a Rollout from here starts at **twice** the power, on top of whatever the run has already doubled |
| **Recharging** (Hyper Beam and nine others) | the next turn is lost, **whether or not the blow landed**. Asked before sleep, paralysis and confusion, because it is the second half of last turn rather than a condition |
| **Flinched** | it does not move this turn. Written by whoever moved first and swept at the end of the turn **read or not**, which is why a flinch from the slower side is worth nothing |
| **Bound** (Wrap, Fire Spin, and eight others) | `max(1, floor(maxHp / 8))` every turn for **4 or 5**, rolled, and it can neither switch out nor run while it holds |
| **Biding** (Bide) | **2** turns of taking it, then **twice** the total move damage taken, exactly — no type chart, no critical hit. Only move damage counts; a Bide spent being poisoned has nobody to give it back to |
| **New** (`fresh`) | it has not had a turn since it arrived, which is the whole of what Fake Out asks. Written on arrival and spent the moment the slot resolves a move — a turn spent asleep is a turn had |

Two more belong to the **side** rather than the appearance, and so survive a
switch:

- **Future Sight** and **Doom Desire** land at the end of the turn after next,
  on **whoever is standing there** — which is the entire reason to throw one.
  The number is settled when the move is used rather than when it arrives.
- **U-turn**, **Volt Switch** and **Flip Turn** hit and then leave, and
  **Dragon Tail** and **Circle Throw** hit and drive the *other* side out.
  Neither leaves anything behind to show on a plate.

### The last of the deferred moves

Restriction, decoys, borrowed abilities and items, and the counters a handful
of attacks keep. All on the appearance: switching out ends every one of them,
except where Baton Pass carries it.

| | Arithmetic |
| --- | --- |
| **Substitute** (Substitute, Shed Tail) | costs `max(1, floor(maxHp / 4))` and fails at or below that much health. The decoy has that many HP; damaging moves hit it instead (sound and other `bypasssub` moves go through), status moves aimed at it fail, and nothing that hangs off a hit — secondaries, binds, item theft — reaches the creature behind |
| **Taunted** (Taunt) | no status moves for **3** turns |
| **Disabled** (Disable) | its last move refused for **4** turns |
| **Encore** (Encore) | only its last move for **3** turns; ends early if that move runs out of PP. A move picked before the Encore landed is replaced by it |
| **Tormented** (Torment) | never the same move twice in a row, for as long as it stays in |
| **Imprisoning** (Imprison) | the other side cannot use any move this one knows |
| **Heal Block** (Heal Block 5 turns, Psychic Noise 2) | no healing from moves, drains, items, Leftovers, Rest or Wish, and `heal`-flagged moves cannot be picked |
| **Grudge** (Grudge) | if a move knocks it out before it moves again, that move drops to **0** PP |
| **Powdered** (Powder) | a Fire move it uses this turn fails and costs it `max(1, floor(maxHp / 4))` |
| **Electrified** (Electrify, Ion Deluge) | its move this turn is Electric; Ion Deluge does it to every Normal move for the rest of the turn |
| **Octolocked** (Octolock) | cannot switch or run, and **−1** Defence and Sp. Def at the end of every turn while whoever set it stays in |
| **Cursed** (Curse from a Ghost) | `max(1, floor(maxHp / 4))` every turn. The Ghost pays `floor(maxHp / 2)` to set it; anything else using Curse gets **+1** Attack and Defence and **−1** Speed |
| **Guarding** (Quick Guard, Wide Guard, Crafty Shield, Mat Block) | this turn only: moves with raised priority, moves that hit everything opposite, status moves, or — first turn out only — damaging moves |
| **Snatching** (Snatch) | this turn, the other side's next self-targeting status move is used by this side instead |
| **Magic Coat** (Magic Coat) | this turn, a `reflectable` move aimed at it is used back on whoever threw it, once |
| **Mimicking** (Mimic) | Mimic's slot holds the target's last move at **5** PP until it leaves |
| **Embargo** (Embargo) | its held item does nothing for **5** turns |
| **No item** (`muffled`) | the item Embargo or Magic Room switched off, kept to hand back |
| **Ability changed** (Worry Seed, Gastro Acid, Entrainment, Role Play, Doodle, Skill Swap, Simple Beam) | its abilities rewritten until it leaves or the battle ends — Insomnia (and it wakes), none, the user's, the target's, exchanged, or Simple |
| **Fury Cutter** (`cutter`) | ×2 and ×4 power on the second and third consecutive hits, then stays at ×4 |
| **Echoed Voice** (`echoes`) | 40 power × (1 + consecutive turns used), up to 200 |
| **Failed** (`stumbled`) | its last move did not connect: Stomping Tantrum and Temper Flare are ×2 |
| **Rage** (Rage) | **+1** Attack every time it is hit, until it uses another move |
| **Exposed** (Glaive Rush) | until the end of next turn, every move hits it and does ×2 |
| **Grounded** (Smack Down, Thousand Arrows) | Ground moves reach it, terrain affects it, and it is pulled out of a Fly |
| **Salt Cure** (Salt Cure) | `max(1, floor(maxHp / 8))` every turn, `/ 4` for Water and Steel types |
| **Syrup** (Syrup Bomb) | **−1** Speed at the end of each of **3** turns |

Lash Out is ×2 after any of its stats was lowered this turn, and Rage Fist is
50 + 50 per hit taken this battle, up to 350 — counted per team member on the
side, so a switch does not reset it. Uproar is a three-turn commitment during
which nothing on either side can fall asleep, and it wakes whoever is asleep
when it starts.

**Items that move.** Knock Off removes the target's item for the rest of the
battle and it comes back afterwards. Thief and Covet take the target's item if
the user holds nothing; Trick and Switcheroo exchange them; Bestow gives the
user's away. In a wild battle those three are permanent; in any other battle
every item is handed back to whoever held it at the start. Incinerate burns a
held berry for good, Recycle returns the last item the user used up, Stuff
Cheeks eats a held berry now for **+2** Defence and Teatime makes both sides
eat theirs.

**Leaving.** Baton Pass switches out and the next one keeps the stages, the
two ladders, and confusion, Focus Energy, a seed, roots, a substitute, the
perish count, floating, a curse, Heal Block, Embargo, Lock-On and altered
stats. Shed Tail costs half its health and passes only a substitute worth a
quarter. Parting Shot lowers the target's Attack and Sp. Atk and then switches.

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

### The rooms

Also on the battle, and several can be up at once. Gravity fails if used while
up; the three rooms end early if used again.

| | Arithmetic |
| --- | --- |
| **Gravity** | **5** turns. Everything is grounded — Flying types and Levitate included, and anything mid-Fly comes down — accuracy is `floor(accuracy · 5 / 3)`, and moves with the `gravity` flag (Fly, Bounce, Splash, High Jump Kick…) fail |
| **Trick Room** | **5** turns. Within the same priority, the slower one moves first |
| **Wonder Room** | **5** turns. A physical hit meets the target's Sp. Def number and a special hit its Defence; the stages stay with their own stat |
| **Magic Room** | **5** turns. Every held item does nothing |
| **Fairy Lock** | nobody may switch or run this turn and the next |

Camouflage makes the user the type of the ground — the terrain's type if one
is up, otherwise the first type of the place the battle is in, or Normal — and
Nature Power calls a move by the same reading. Court Change exchanges every
screen and hazard between the two sides.

### The hazards

On the side, by layers, until something sweeps them. They bite on every
arrival, a replacement for something that fainted included.

| | Arithmetic |
| --- | --- |
| **Stealth Rock** | `max(1, floor(maxHp · quarters / 32))`, where quarters is how Rock hits it — everything, grounded or not |
| **Spikes** (up to 3) | grounded only: `floor(maxHp / 8)`, `/ 6`, `/ 4` |
| **Toxic Spikes** (up to 2) | grounded only: poisoned. A grounded Poison type clears them instead |
| **Sticky Web** | grounded only: **−1** Speed, from the other side, so Mist and Clear Body refuse it |

Rapid Spin and Mortal Spin clear the user's side; Defog clears both sides and
the target's Reflect, Light Screen, Mist and Safeguard, and lowers its
evasion; Tidy Up clears both sides and every substitute and raises Attack and
Speed.

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

**The eleven doubles-only moves are filtered out of every move pool** rather
than dealt as slots that always fail: Helping Hand, Follow Me and the rest of
what needs an ally. `docs/moves-deferred.md` is the list.
