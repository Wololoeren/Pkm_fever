# Abilities

Two hundred and twenty-four of them. **Ninety-five** are their own idea; **ninety** are five families of
eighteen, one entry per type; **fifteen** are the swaps, one per pair of types; and **fourteen** are
the social perks, which do nothing in a fight.

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
For the conditions and ladders several of these read and modify, see
[`status.md`](./status.md).

---

## The ninety-five singles

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
| **Simple** | Every stage change to it **counts double**, still capped at ±6. What Simple Beam gives the target |

### The field

Twenty-three that set or read the weather and the terrain, which arrived with
the field itself. See `status.md` for what each weather and terrain does on
its own.

| Ability | Effect |
| --- | --- |
| **Drought**, **Drizzle**, **Sand Stream**, **Snow Warning** | Brings its weather when it arrives, for five turns |
| **Electric Surge**, **Grassy Surge**, **Misty Surge**, **Psychic Surge** | Lays its terrain when it arrives, for five turns |
| **Chlorophyll**, **Swift Swim**, **Sand Rush**, **Slush Rush** | Speed **×2** in sun, rain, sand, hail or snow respectively |
| **Surge Surfer** | Speed **×2** on Electric Terrain, while grounded |
| **Grass Pelt** | Defence **×1.5** on Grassy Terrain, while grounded |
| **Rain Dish** | A sixteenth back every turn in the rain |
| **Ice Body** | A sixteenth back every turn in hail or snow |
| **Hydration** | Any condition cleared at the end of a turn in the rain |
| **Sand Veil**, **Snow Cloak** | Moves against it are **×0.8 accurate** in sand, or in hail and snow |
| **Sand Force** | Rock, Ground and Steel moves **×1.3** in a sandstorm |
| **Leaf Guard** | No condition takes in the sun |
| **Cloud Nine**, **Air Lock** | While it stands there, there is no weather — it is not ended, it is not felt |

Dry Skin and Solar Power are not in: each is two or three effects under one
name, and a spec carries one.

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
| **Grim Neigh** | Every knockout raises its **Sp. Atk +1** |
| **Trophy Hide** | Every knockout raises its **Defense +1** |
| **Victor's Calm** | Every knockout raises its **Sp. Def +1** |
| **Bloodrush** | Every knockout raises its **Speed +1** |
| **Intimidate** | On arrival, lowers the opponent's **Attack −1**. Fires on the **opening lead**, not only on a switch. Scrappy is immune to it |
| **Regenerator** | Switching out mends **1/3** of its maximum |
| **Rock Head** | **Recoil never touches it.** Struggle's own cost is not waived — that is what having nothing left costs you |
| **Scrappy** | Its **Normal and Fighting reach Ghosts** |

### The classes

One per class, each built around one common attack: that move does **×2** (every blow of a multi-hit move). Nothing else it knows is touched.

| Ability | Move |
| --- | --- |
| **Barbarian** | Bite |
| **Bard** | Disarming Voice |
| **Cleric** | Dazzling Gleam |
| **Druid** | Razor Leaf |
| **Fighter** | Quick Attack |
| **Monk** | Double Kick |
| **Paladin** | Metal Claw |
| **Ranger** | Aerial Ace |
| **Rogue** | Feint Attack |
| **Sorcerer** | Ember |
| **Warlock** | Hex |
| **Wizard** | Swift |

### Effort

EVs from each defeated foe, including one beaten while it sat out holding an Exp. Share. The 252 per stat and 510 total caps still apply.

| Ability | Effect |
| --- | --- |
| **Diligent** | EVs **×1.5**, rounded down |
| **Hard Worker** | EVs **×2** |
| **Workaholic** | EVs **×3** |
| **Marathoner** | All EVs into **HP**, ×2 |
| **Weightlifter** | All EVs into **Attack**, ×2 |
| **Bulwark Drill** | All EVs into **Defence**, ×2 |
| **Scholar** | All EVs into **Sp. Atk**, ×2 |
| **Stoic** | All EVs into **Sp. Def**, ×2 |
| **Sprinter** | All EVs into **Speed**, ×2 |

A held Macho Brace or Power item that picks a stat overrides which stat the steered ones aim at.

### Natures

The nature term is **+24 / −24** on the raw sum (see `natures.ts`). These scale it; a neutral nature is unaffected.

| Ability | Raised stat | Lowered stat |
| --- | --- | --- |
| **Strong-Willed** | +48 | −24 |
| **Fervent** | +72 | −24 |
| **Headstrong** | +48 | −48 |
| **Extremist** | +72 | −72 |

### Foraging

Every **500** steps walked, each of these on a party member finds one item, equal odds from its list. Eggs and the box find nothing.

| Ability | Finds |
| --- | --- |
| **Scavenger** | Potion, Super Potion, Poké Ball, Great Ball, Repel, Super Repel, Escape Rope, Full Heal, Revive, Ultra Ball |
| **Berry Picker** | Oran, Sitrus, Figy, Wiki, Mago, Aguav, Iapapa, Cheri, Chesto, Pecha, Rawst, Aspear, Lum |
| **Ball Collector** | Poké, Great, Ultra, Quick, Timer, Net, Nest, Level, Fast, Dive Ball — or, 0.5% of the time, a **Master Ball** |
| **Herbalist** | Potion, Super Potion, Hyper Potion, Full Heal, Revive |
| **Treasure Hunter** | Nugget, Pearl |
| **Rockhound** | Leaf, Fire, Water, Thunder, Ice, Moon, Sun, Dusk, Dawn, Shiny Stone |
| **Gym Rat** | HP Up, Protein, Iron, Calcium, Zinc, Carbos |

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

## Two more families

Only in battle: out on the map a creature is still its species' types to anybody asking. Deficiencies come off first, then affinities are added. A move that sets types (Soak and the rest) replaces the lot while it lasts.

### Deficiency — in battle it does not have that type

Losing every type leaves it **typeless**: no same-type bonus, and every attack neutral against it. No effect on a creature without the type.

| Type | Name | | Type | Name |
| --- | --- | --- | --- | --- |
| bug | Bug Deficiency | | grass | Grass Deficiency |
| dark | Dark Deficiency | | ground | Ground Deficiency |
| dragon | Dragon Deficiency | | ice | Ice Deficiency |
| electric | Electric Deficiency | | normal | Normal Deficiency |
| fairy | Fairy Deficiency | | poison | Poison Deficiency |
| fighting | Fighting Deficiency | | psychic | Psychic Deficiency |
| fire | Fire Deficiency | | rock | Rock Deficiency |
| flying | Flying Deficiency | | steel | Steel Deficiency |
| ghost | Ghost Deficiency | | water | Water Deficiency |

### Affinity — in battle it also has that type

Same-type bonus on those moves, and the type's weaknesses, resistances and immunities. No effect if it already has it.

| Type | Name | | Type | Name |
| --- | --- | --- | --- | --- |
| bug | Bug Affinity | | grass | Grass Affinity |
| dark | Dark Affinity | | ground | Ground Affinity |
| dragon | Dragon Affinity | | ice | Ice Affinity |
| electric | Electric Affinity | | normal | Normal Affinity |
| fairy | Fairy Affinity | | poison | Poison Affinity |
| fighting | Fighting Affinity | | psychic | Psychic Affinity |
| fire | Fire Affinity | | rock | Rock Affinity |
| flying | Flying Affinity | | steel | Steel Affinity |
| ghost | Ghost Affinity | | water | Water Affinity |

---

## The swaps

Two types trade places on its own attacks: a Grass move goes out Fire, and a Fire move goes out
Grass. Only the moves change — the creature keeps its own types, so its same-type bonus follows the
move's *new* type. Applied last, after Electrify and Ion Deluge.

| Ability | Swaps |
| --- | --- |
| **Green Fire** | Grass ⇄ Fire |
| **Boiling Tide** | Fire ⇄ Water |
| **Frozen Spark** | Electric ⇄ Ice |
| **Falling Stone** | Rock ⇄ Flying |
| **Iron Brawl** | Fighting ⇄ Steel |
| **Haunted Mind** | Ghost ⇄ Psychic |
| **Night Bloom** | Dark ⇄ Fairy |
| **Tainted Soil** | Poison ⇄ Ground |
| **Dragon Frost** | Dragon ⇄ Ice |
| **Hive Mind** | Bug ⇄ Normal |
| **Charged Surf** | Electric ⇄ Water |
| **Quicksilver** | Steel ⇄ Psychic |
| **Wild Wind** | Grass ⇄ Flying |
| **Spirit Fist** | Ghost ⇄ Fighting |
| **Sweet Venom** | Poison ⇄ Fairy |

---

## The social perks

Nothing in battle (Stage Presence aside, which changes what a Ribbon does). Read by the Streamer,
the Influencer, the beauty pageant, the paparazzo and Dr. Couch.

| Ability | What it does |
| --- | --- |
| **Celebrity** | Everything it earns on stream is multiplied by 5. The larger of this and Renowned, never both. |
| **Renowned** | Everything it earns on stream is doubled. |
| **Pretty** | At the beauty pageant its IVs count five times over. |
| **Drama Queen** | When it faints on stream, the pool loses nothing — the crowd loves it more. |
| **Viral** | At the Influencer every step counts twice towards its fame. |
| **Photogenic** | At the beauty pageant it scores 150 more. |
| **Stage Presence** | A Ribbon on it charms twice as often (60%) and drops the foe's Attack two stages instead of one. |
| **Thick Skin** | The paparazzo's photoshoot still takes its Ribbon, but it never comes back Burned Out. |
| **Trendsetter** | At the beauty pageant each shine rung is worth 80 instead of 40. |
| **Colour Coordinated** | At the beauty pageant its colour scores double. |
| **Low Bandwidth** | While it is on stream, walking costs the pool nothing. |
| **Humblebrag** | At the beauty pageant its pageant item's bonus counts whatever its type. |
| **Comeback Story** | Dr. Couch sees it for free, and its course takes a tenth of the steps. |
| **Paparazzi Magnet** | The paparazzo pays three times as much for its photoshoot. |

---

## The hours

Ten that read the sky. The cycle is ten thousand steps — day, a thousand-step
dusk, night, a thousand-step dawn — and a battle carries the hour it *began*
at, so nothing here changes mid-fight.

| Ability | Effect |
| --- | --- |
| **Night Stalker** | Attacks do **+50%** at night |
| **Moonlit** | **Sp. Def ×1.5** at night |
| **Sunbather** | Attacks do **+50%** in the day |
| **Daybound** | **Defense ×1.5** in the day |
| **Dusk Runner** | Attacks do **+80%** at dusk |
| **Evening Calm** | **Sp. Atk ×1.6** at dusk |
| **Dawn Chorus** | Attacks do **+80%** at dawn |
| **First Light** | **Speed ×1.6** at dawn |
| **Twilight Born** | **Attack ×1.4** at dusk and at dawn |
| **Early and Late** | Attacks do **+30%** from dawn through the day |

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
| `power` (signature) | Is this one named move doubled? (the classes) |
| `lack`, `affinity` | Which types does it have in battle? |
| `regimen` | How much effort does it earn, and into which stat? |
| `temper` | How much does its nature count? |
| `forage` | What does it find on the walk? |
