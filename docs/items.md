# Items

**513 of them**, of which 275 are machines. The other 238 are below.

The machine count fell from 312 to 268 when status moves were audited: 44 of
them taught a move this engine has no machinery for, so the shelf was selling
a four-thousand-a-go lesson in wasting a turn. It climbs back as the machinery
arrives — seven returned with the two cheap groups of status moves — and
`docs/moves-deferred.md` is what is still off the shelf. See
`src/engine/statusmoves.ts`.

The bag sorts by what an item *is for*, because that is the only question a
player has when they open it: something you use, something you throw,
something you give to a creature to keep, something you use on the world.

| Shelf | Count | What it is |
| --- | --- | --- |
| Held | 70 | Given to a creature; does something while carried |
| Berries | 41 | The same, but eaten and gone the moment it does it |
| Tonics | 37 | Moves a number on a stat screen |
| Stones | 22 | Turns one creature into another |
| Breeding | 19 | Applied to a pairing at the daycare |
| Machines | 275 | Teaches a move, and keeps |
| Lures | 9 | Draws one kind of thing out of the grass |
| Medicine | 11 | Health, and what ails it |
| Field | 5 | Used on the world rather than on a creature |
| Tools | 10 | The HMs. Won from gyms |
| Rods | 3 | Reaches further out the water |
| Balls | 3 | |
| Valuables | 2 | For selling. That is the whole of it |
| Keys | 1 | The World Cup Invitation |

The companion to this file is [`items-deferred.md`](./items-deferred.md): what
is *not* here, grouped by the one mechanic each is waiting for.

---

## Held items

The design is one sentence: **a held item is an ability you can take off.**

Adaptability doubles the same-type bonus and a Choice Band raises Attack by
half; Sturdy leaves you on one hit point and so does a Focus Sash. Those are
not similar mechanics, they are the same mechanic reached by a different road.
So `effects()` in `battle.ts` folds what a creature is *carrying* in beside
what it was *born with*, and both answer the same closed set of questions.

Which is why 111 held items cost the battle about sixteen new questions rather
than 111. A Charcoal is `power` with a type on it. A Scope Lens is `luck`. An
Assault Vest is `stat`. A Clear Amulet is Clear Body. None of those needed a
line of new battle code at all.

Two things an ability does not have and an item does:

- **It can be spent.** Nearly free: the party *is* `battle.sides[0].team`, so
  clearing `heldItem` inside a battle is already clearing it in the save.
- **It can do more than one thing.** A Life Orb hits harder *and* costs health;
  a Choice Band raises a stat *and* locks a move. So `effects` is a list, where
  an ability has exactly one.

### What it does to damage

| Item | Effect |
| --- | --- |
| **Choice Band** | Attack **×1.5**, and one move only until it leaves |
| **Choice Specs** | Sp. Atk **×1.5**, the same way |
| **Choice Scarf** | Speed **×1.5**, the same way |
| **Life Orb** | **×1.3** damage, and **1/10** of its own maximum every swing that landed |
| **Expert Belt** | **×1.2**, but only when the hit was already super effective |
| **Muscle Band** | Its **physical** moves ×1.1 |
| **Wise Glasses** | Its **special** moves ×1.1 |
| **Big Root** | Draining moves return **×1.5** |
| The eighteen type items | That type **×1.2** — see below |

### What it does to defence

| Item | Effect |
| --- | --- |
| **Assault Vest** | Sp. Def **×1.5**, and it will not use a status move at all |
| **Eviolite** | Both defences **×1.5**, for anything that still has somewhere to grow |
| **Focus Sash** | From full health, survives one hit that would have finished it. **Spent** |
| **Focus Band** | **1 in 10**, from *any* health. Not spent |
| **Weakness Policy** | A super-effective hit raises both attacks **+2**. **Spent** |
| **Clear Amulet** | Nobody else lowers any of its stats |
| **Covert Cloak** | Secondary effects of moves used on it never fire |
| **Bright Powder** / **Lax Incense** | Whatever aims at it is **×0.9** accurate |

### What it mends

| Item | Effect |
| --- | --- |
| **Leftovers** | **1/16** of its maximum, end of every turn |
| **Black Sludge** | **1/8** to a poison type, **−1/8** to anything else |
| **Shell Bell** | **1/8** of the damage it dealt, back |

### Aim, luck and going first

| Item | Effect |
| --- | --- |
| **Scope Lens** / **Razor Claw** | Crit ratio **+1 stage** |
| **Wide Lens** | Accuracy **×1.1** |
| **Zoom Lens** | Accuracy **×1.2**, on the turns it moves **second** |
| **Quick Claw** | **1 in 5** it moves first, inside its priority bracket |

Quick Claw sits *inside* the bracket rather than above it: a claw does not beat
a Quick Attack, it beats being slow.

### What it does to itself

| Item | Effect |
| --- | --- |
| **Flame Orb** | Burns its holder |
| **Toxic Orb** | Poisons its holder |

Both go through the same status predicate as everything else, so a Water Veil
ignores its own Flame Orb and a Fire type cannot be burned by one.

### Outside a battle

| Item | Effect |
| --- | --- |
| **Lucky Egg** | Experience **×1.5** |
| **Amulet Coin** / **Luck Incense** | Trainer purse **×2** |
| **Everstone** | It will not evolve, by **either** road |
| **Macho Brace** | Effort **×2**, and Speed **×0.5** while it wears it |
| **Power Weight** | Effort **×2**, all of it into HP |
| **Power Bracer** | The same, into Attack |
| **Power Belt** | Into Defence |
| **Power Lens** | Into Sp. Atk |
| **Power Band** | Into Sp. Def |
| **Power Anklet** | Into Speed |
| **Destiny Knot** | Five inherited stat slots instead of three, at the daycare |
| **Smoke Ball** | Running from anything wild always works |

The Everstone answers in `progression.ts` rather than at its two call sites,
because there are two roads to an evolution and an item that blocked one would
be an item that half works.

### The eighteen type items

**×1.2** to that type. A complete family with no holes, the same way the
ability families are complete — the games shipped seventeen of these and took
two more generations to notice that Fairy had none.

| Type | Item | | Type | Item |
| --- | --- | --- | --- | --- |
| bug | Silver Powder | | grass | Miracle Seed |
| dark | Black Glasses | | ground | Soft Sand |
| dragon | Dragon Fang | | ice | Never-Melt Ice |
| electric | Magnet | | normal | Silk Scarf |
| fairy | Fairy Feather | | poison | Poison Barb |
| fighting | Black Belt | | psychic | Twisted Spoon |
| fire | Charcoal | | rock | Hard Stone |
| flying | Sharp Beak | | steel | Metal Coat |
| ghost | Spell Tag | | water | Mystic Water |

### The twelve that only work for somebody

Every one of these does nothing at all in the wrong hands, which is the point:
they exist to prop up something that needs propping. A Thick Club on a Cubone
is the difference between an unusable creature and a frightening one; on
anything else it is a rock.

| Item | Whose | Effect |
| --- | --- | --- |
| **Thick Club** | Cubone, Marowak | Attack ×2 |
| **Light Ball** | Pikachu | Both attacks ×2 |
| **Metal Powder** | Ditto | Defence ×2 |
| **Quick Powder** | Ditto | Speed ×2 |
| **Lucky Punch** | Chansey | Crit +2 stages |
| **Leek** | Farfetch'd, Sirfetch'd | Crit +2 stages |
| **Deep Sea Tooth** | Clamperl | Sp. Atk ×2 |
| **Deep Sea Scale** | Clamperl | Sp. Def ×2 |
| **Soul Dew** | Latias, Latios | Psychic and Dragon ×1.2 |
| **Adamant Orb** | Dialga | Dragon and Steel ×1.2 |
| **Lustrous Orb** | Palkia | Dragon and Water ×1.2 |
| **Griseous Orb** | Giratina | Dragon and Ghost ×1.2 |

The species lists are **read from the bestiary**, not written out. Writing them
by hand produced a Griseous Orb naming `giratinaorigin` — which is not a
species here — and a Light Ball naming `pikachu` when the manifest carries
eleven of them. Both were silent, because an effect whose condition matches
nothing is simply an effect that never applies.

---

## Berries

Held, and gone the moment they do their job. Checked at the end of the turn
rather than the instant health crosses the line — a deliberate simplification,
and the honest one: the alternative is a check inside every path that can
reduce health, and a berry that fires on four of five such paths is worse than
one that always fires a beat late.

| Berry | Effect |
| --- | --- |
| **Oran Berry** | 10 health back below half |
| **Sitrus Berry** | 1/4 of its maximum below half |
| **Figy Berry** | 1/3 of its maximum below a quarter |
| **Wiki Berry**, **Mago Berry**, **Aguav Berry**, **Iapapa Berry** | The same. One item under five names |
| **Cheri Berry** | Clears paralysis |
| **Chesto Berry** | Clears sleep |
| **Pecha Berry** | Clears poison |
| **Rawst Berry** | Clears a burn |
| **Aspear Berry** | Clears a freeze |
| **Lum Berry** | Clears anything |
| **Liechi Berry** | Attack **+1** below a quarter |
| **Ganlon Berry** | Defence, the same |
| **Petaya Berry** | Sp. Atk |
| **Apicot Berry** | Sp. Def |
| **Salac Berry** | Speed |
| **Enigma Berry** | 1/4 back when something hits it super effectively |
| **Kee Berry** | Defence +1 when something hits it physically |
| **Maranga Berry** | Sp. Def +1 when something hits it specially |
| **Jaboca Berry** | Whatever hits it physically loses 1/8 of its own maximum |
| **Rowap Berry** | The same, for special |

The five flavour berries are one item under five names. In the games they
differ only by which nature dislikes the taste, and there is no taste here — so
a player who finds a Mago Berry gets something, rather than being told they
already have this one.

### The eighteen resist berries

Halve **one super-effective hit** of that type, then gone.

| Type | Berry | | Type | Berry |
| --- | --- | --- | --- | --- |
| bug | Tanga Berry | | grass | Rindo Berry |
| dark | Colbur Berry | | ground | Shuca Berry |
| dragon | Haban Berry | | ice | Yache Berry |
| electric | Wacan Berry | | normal | Chilan Berry |
| fairy | Roseli Berry | | poison | Kebia Berry |
| fighting | Chople Berry | | psychic | Payapa Berry |
| fire | Occa Berry | | rock | Charti Berry |
| flying | Coba Berry | | steel | Babiri Berry |
| ghost | Kasib Berry | | water | Passho Berry |

These have their **own shape** rather than borrowing Thick Fat's. Expressed as
`ward` at first, they were a permanent halving of a type that was never spent —
two bugs wearing one shape. They are noted during the damage calculation and
spent once the blow is known to have landed, so a berry is never eaten by a
hit that then missed.

---

## Stones

**Twenty-two of them, sixty-seven doors.** Read from the bestiary rather than
listed: every item evolution the manifest carries names its item as a display
string, so the set of stones that exists is exactly the set of names those
evolutions mention. Point the build script at a different bestiary and the
shelf restocks itself.

Every one is stocked. Ten open more than one door and cost ¤2,100; the twelve
specialists cost double. Leaving the specialists off the shelf — to be found
instead — read well and was wrong: sharing one slot in the drop table, a given
one appeared in under one world in twelve, so whether a Sinistea could ever
become a Polteageist was decided by a die rolled before the player existed.

Fire · Water · Thunder · Leaf · Moon · Sun · Ice · Shiny · Dusk · Dawn Stone,
and then Auspicious Armor, Malicious Armor, Cracked Pot, Chipped Pot,
Unremarkable Teacup, Masterpiece Teacup, Sweet Apple, Tart Apple, Syrupy
Apple, Galarica Cuff, Galarica Wreath, Metal Alloy.

A stone keeps the **proportion** of health, not the number: a Magikarp on its
last legs comes out of it a Gyarados on its last legs.

---

## Tonics

| Item | Effect |
| --- | --- |
| **HP Up / Protein / Iron / Calcium / Zinc / Carbos** | **+10** effort in that stat |
| **Pomeg / Kelpsy / Qualot / Hondew / Grepa / Tamato Berry** | **−10** effort in that stat |
| **25 mints**, one per nature | Settles that nature, whatever it was born with |

Effort was the one stat input a player controls completely, and the only way to
move it was to go and fight the right thing — which meant a misspent creature
was misspent for good. Both directions go through `gainEffort`, so the per-stat
252 and the total 510 are enforced in one place and no bottle can mint an
illegal creature.

There is a mint for the five **neutral** natures too. "Take this creature's
nature off it" is a thing somebody will want, and there is no reason to make
them work out which of the five is the flat one.

---

## Field items

| Item | Effect |
| --- | --- |
| **Repel / Super Repel / Max Repel** | 200 / 500 / 1,000 moves of quiet grass |
| **Escape Rope** | Back to Hearth from wherever you are standing |
| **Heart Scale** | Offers back one move a creature grew past |

A repel is a lure run backwards and shares its record exactly: an expiry
written down once, never a counter decremented every step. It is checked
**after** the encounter roll and **before** the creature is built, which is the
one ordering that keeps the label's promise — the step is spent, the roll is
spent, and the census is not. Whatever is waiting in that grass is still
waiting, in the same order, when it runs out.

A Heart Scale goes through the same offer queue a level-up uses, so what to
forget is asked in exactly one place, in the same words.

---

## How they are built

`carry.ts` holds what an item *does*; `items.ts` holds what it costs and which
shelf it sits on. Two files, one catalogue, and neither needs the other's job:
`items.ts` never imports the battle, and `carry.ts` never needs a price.

The effects are the same closed set of shapes the abilities use — see
[`abilities.md`](./abilities.md) — plus these, which arrived with items because
an item asked a question the battle was not already asking:

| Shape | Question it answers |
| --- | --- |
| `sharp` | Is a super-effective hit of mine multiplied? |
| `soften` | Is one super-effective hit of that type softened, once? |
| `graze` | Is the *other* side's accuracy against me multiplied? |
| `tick` | Do I mend, or bleed, at the end of a turn? |
| `siphon` | Do I keep a share of what I dealt? |
| `toll` | Do I pay for having attacked? |
| `barb`, `brace` | Does whatever hit me pay, or do I gain a stage? |
| `solace` | Am I healed for having been hit hard? |
| `gamble` | Do I move first anyway? |
| `afflict` | Do I give myself something? |
| `policy` | Does a super-effective hit raise my stages? |
| `silent`, `locked` | Is this move off the menu? |
| `study`, `purse`, `regimen` | Is what I earned multiplied, or steered? |
| `anchor` | Will I evolve at all? |
| `lineage` | How many stat slots pass down? |
| `roots` | Do draining moves return more? |
| `bolt` | Does running work? |

**The hole two of these opened.** `silent` and `locked` take moves off the
menu, and both can take *every* move off it: an Assault Vest on something that
knows only status moves, or a Choice item committed to a move that then runs
out of PP. Struggle was gated on `anyPp`, which is a complete answer only while
PP is the only thing that can take a move away — so both cases were a battle
that could be neither won, lost nor left. It asks `hasLegalMove` now.
