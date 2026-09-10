# Abilities

Eighty-nine of them. **Thirty-five** are their own idea; **fifty-four** are
three families of eighteen, one entry per type.

An ability here belongs to the individual, not to the species — see the header
of `src/engine/abilities.ts` for why. What that means in play:

| | |
| --- | --- |
| A wild creature with **none** | 89% |
| with **one** | 10% |
| with **two** | 1% |
| with **three** | never — only breeding reaches three |
| Breeding | a coin per parent ability, up to three kept |

The companion to this file is [`abilities-deferred.md`](./abilities-deferred.md):
the 223 that are *not* here, grouped by the one mechanic each is waiting for.

---

## The thirty-five singles

### Damage it deals

| Ability | Effect |
| --- | --- |
| **Adaptability** | Same-type bonus is **×2** instead of ×1.5 |
| **Technician** | Moves of **60 power or less ×1.5**. Reads the power actually being swung with, so a Low Kick standing in at 60 qualifies and a Flail at 200 does not. Struggle included |
| **Reckless** | Moves that cost it recoil **×1.2** |
| **Analytic** | **×1.3** when it moves last this turn |
| **Tinted Lens** | Moves that are **not very effective ×2** |

### Damage it takes

| Ability | Effect |
| --- | --- |
| **Filter** | Super-effective hits **×0.75** |
| **Solid Rock** | Super-effective hits **×0.667** |
| **Thick Fat** | **Fire and Ice ×0.5** |
| **Levitate** | **Ground cannot reach it at all** — immunity, no healing |
| **Sturdy** | From **full health**, one hit leaves it on 1 HP |

### Stats

| Ability | Effect |
| --- | --- |
| **Huge Power** | Attack **×2**, always |
| **Hustle** | Attack **×1.5**, and its **physical** moves are **×0.8 accurate** |
| **Guts** | Attack **×1.5** while statused, **and it ignores the burn penalty** |
| **Marvel Scale** | Defence **×1.5** while statused |
| **Quick Feet** | Speed **×1.5** while statused — applied *after* paralysis, so a paralysed Quick Feet is faster than a paralysed anything |
| **Defeatist** | At **half health or less**, Attack *and* Sp. Atk **×0.5**. The one ability here that is purely a cost |
| **Clear Body** | Nobody else lowers **any** of its stages |
| **Hyper Cutter** | Nobody else lowers its **Attack** |
| **Big Pecks** | Nobody else lowers its **Defence** |

Clear Body and its two narrow cousins only stop *somebody else*. A creature
lowering its own Defence to raise its Attack is its own business.

### Status

| Ability | Effect |
| --- | --- |
| **Immunity** | Poison never takes |
| **Limber** | Paralysis never takes |
| **Water Veil** | Burn never takes |
| **Insomnia** | Sleep never takes |
| **Magma Armor** | Freeze never takes |
| **Shield Dust** | Secondary effects of moves **used on it** never fire. Its own self-targeting secondaries still do |
| **Natural Cure** | Switching out **clears** whatever ails it |

Every road to a status goes through one predicate, so these hold against a
move's own status *and* against a secondary.

### Accuracy, crits, order

| Ability | Effect |
| --- | --- |
| **Compound Eyes** | Its accuracy **×1.3** |
| **No Guard** | Its moves **never miss** |
| **Super Luck** | Crit ratio **+1 stage** |
| **Prankster** | Status moves get **+1 priority** — but **Dark types are immune** to it |

### Around the edges

| Ability | Effect |
| --- | --- |
| **Moxie** | Every knockout raises its **Attack +1** |
| **Intimidate** | On arrival, lowers the opponent's **Attack −1**. Fires on the **opening lead**, not only on a switch. Scrappy is immune to it |
| **Regenerator** | Switching out mends **1/3** of its maximum |
| **Rock Head** | **Recoil never touches it.** Struggle's own cost is not waived — that is what having nothing left costs you |
| **Scrappy** | Its **Normal and Fighting reach Ghosts** |

---

## The three families

Blaze, Torrent, Overgrow and Swarm are one ability wearing four coats, and the
games only ever shipped four because only four starters needed one. With
abilities rolled rather than assigned there is no reason the other fourteen
types go without — a Rock type that gets stronger when cornered is exactly as
interesting as a Fire one.

A canon name is used **only where the canon mechanic is**. Volt Absorb and
Water Absorb are immunity plus a quarter healed, which is this shape exactly.
Flash Fire and Sap Sipper are immunity plus a *boost*, so they do not get to
borrow those names.

### Cornered — below a third of its health, its own moves of that type ×1.5

| Type | Name | | Type | Name |
| --- | --- | --- | --- | --- |
| bug | **Swarm** | | grass | **Overgrow** |
| dark | Dark Fury | | ground | Ground Fury |
| dragon | Dragon Fury | | ice | Ice Fury |
| electric | Electric Fury | | normal | Normal Fury |
| fairy | Fairy Fury | | poison | Poison Fury |
| fighting | Fighting Fury | | psychic | Psychic Fury |
| fire | **Blaze** | | rock | Rock Fury |
| flying | Flying Fury | | steel | Steel Fury |
| ghost | Ghost Fury | | water | **Torrent** |

### Absorb — immune to that type, and healed **1/4** of its maximum by it

| Type | Name | | Type | Name |
| --- | --- | --- | --- | --- |
| bug | Bug Drinker | | grass | Grass Drinker |
| dark | Dark Drinker | | ground | Ground Drinker |
| dragon | Dragon Drinker | | ice | Ice Drinker |
| electric | **Volt Absorb** | | normal | Normal Drinker |
| fairy | Fairy Drinker | | poison | Poison Drinker |
| fighting | Fighting Drinker | | psychic | Psychic Drinker |
| fire | Fire Drinker | | rock | Rock Drinker |
| flying | Flying Drinker | | steel | Steel Drinker |
| ghost | Ghost Drinker | | water | **Water Absorb** |

Note **Ground Drinker** is not Levitate: it heals. Levitate is its own entry
above, and heals nothing.

### Ward — that type does **×0.5** to it

| Type | Name | | Type | Name |
| --- | --- | --- | --- | --- |
| bug | Bug Guard | | grass | Grass Guard |
| dark | Dark Guard | | ground | Ground Guard |
| dragon | Dragon Guard | | ice | Ice Guard |
| electric | Electric Guard | | normal | Normal Guard |
| fairy | Fairy Guard | | poison | Poison Guard |
| fighting | Fighting Guard | | psychic | Psychic Guard |
| fire | **Heatproof** | | rock | Rock Guard |
| flying | Flying Guard | | steel | Steel Guard |
| ghost | Ghost Guard | | water | Water Guard |

---

## How they are built

The effects are a **closed set of twenty-one shapes**, not a callback each. The
battle never asks "what does Adaptability do"; it asks "does anything change
the same-type bonus" and takes what comes back.

That is what keeps the list open — a new entry answering an existing question
needs no change in `battle.ts` at all — and it is why the battle's behaviour
can still be read off one file. Anything needing a shape this game does not
have is in `abilities-deferred.md` rather than approximated: an ability that
half works teaches a player that abilities are unreliable, which is a much
more expensive lesson than "not all of them are in yet".

| Shape | Question it answers |
| --- | --- |
| `stab` | What is the same-type bonus? |
| `power` | Is this attack multiplied? (always / weak / costly / cornered / late) |
| `absorb`, `immune` | Does this type reach it at all? |
| `ward`, `cushion`, `pierce` | Is the incoming or outgoing damage scaled? |
| `stat` | Is this stat multiplied? (always / statused / hurt) |
| `hold` | Can somebody else lower this stage? |
| `ignore`, `unfazed` | Does this status or secondary land? |
| `aim`, `luck`, `quick` | Accuracy, crit ratio, priority |
| `endure`, `spoils`, `arrival`, `mend`, `shake` | Surviving, knocking out, arriving, leaving |
| `reckless`, `reach` | Recoil, and reaching a Ghost |
