/**
 * What the people on the routes know.
 *
 * This game explains almost nothing. The stat sheet separates base, IV, nature
 * and effort into columns and trusts you to read them; the shine ladder has
 * six rungs and no tutorial; burn is applied last in the damage formula and
 * the only place that is written down is a reference document. All of that is
 * deliberate — a game that opens with forty screens of instruction has told
 * you everything and taught you nothing.
 *
 * But the opposite failure is real too, and this codebase had it: the
 * knowledge existed and there was nowhere to *meet* it. A player either read
 * `docs/status.md` or never found out that a third of the sleeps they land
 * cost the opponent nothing at all.
 *
 * So the route trainers know things. There are about two hundred and seventy
 * of them across a world, four to seven on every route, and each one opens
 * with a single thing it has learned. That is the whole feature, and the shape
 * of it matters more than the contents:
 *
 * - **It is spread across people you have to walk to.** A hint you are handed
 *   by a panel is a manual with extra steps. A hint that comes out of somebody
 *   you found round the third corner of a pinewood is a reason to have gone
 *   round the corner. The game already puts a person on every route who trades
 *   or hands out a job; this is the same idea one layer down, on the people
 *   who were previously furniture with a team.
 *
 * - **It is dealt from a shuffled deck rather than rolled.** Every hint in
 *   this list is seen before any of them is seen twice — see `dealHints`. A
 *   roll per trainer would hand you the same four facts eleven times and hide
 *   the other hundred behind the birthday problem, which is precisely the
 *   failure mode "there are lots of hints" is supposed to avoid.
 *
 * - **A trainer says the same thing forever.** Dealt at world generation from
 *   the seed, like everything else here. Somebody who tells you a different
 *   fact on Tuesday is not a character, they are a slot machine — the same
 *   rule the idle creatures' lines follow.
 *
 * ## What makes a line belong here
 *
 * **A number or a rule you can act on.** Not flavour, not encouragement, not
 * "the grass is dangerous". If a line does not change a decision somebody
 * makes, it is taking the place of one that would.
 *
 * **True.** Every figure below is the engine's, and several are deliberately
 * the ones that contradict what a player will assume from other games in this
 * shape: freeze has no thaw here, Toxic does not escalate, natures add rather
 * than multiply, and wild creatures cap at a fifth of the IV range. A hint
 * that is merely plausible is worse than no hint, because it will be believed.
 *
 * **Said by somebody.** These are people who have found this out, usually the
 * hard way, and have opinions about it. The joke is the relationship they have
 * with the fact, never a joke instead of the fact — a line that is funny and
 * says nothing has failed at the only job it had.
 */

export interface Hint {
  /** Stable, because a test names them and a save may one day. */
  id: string;
  /** What they say, before anything is thrown. */
  text: string;
}

export const HINTS: readonly Hint[] = [
  // ----------------------------------------------------- the five conditions
  {
    id: "sleep-is-short",
    text: "Everyone thinks sleep buys three turns. It rolls one, two or three, and at one they wake up and move anyway. So a third of the time you spent a turn singing somebody a lullaby and they got up. I keep a tally. It is not a happy tally.",
  },
  {
    id: "freeze-is-forever",
    text: "Freeze is the cruel one. One chance in five, every turn, and nothing else ends it — no, not a Fire move, I have tried, I have tried in front of witnesses. Five turns on average. I have watched a man lose a tournament to a Powder Snow.",
  },
  {
    id: "burn-is-last",
    text: "Burn halves physical damage, yes. What nobody tells you is where in the sum it lands: dead last, after the type chart. So a burned thing hitting for double damage loses half of the doubled number. It is the only condition that gets worse the better you are doing.",
  },
  {
    id: "burn-chip",
    text: "A burn takes a sixteenth of their maximum every turn. Poison takes an eighth. If you only remember one of those, remember that poison is twice the burn and burn is the one that also stops them hitting you. Different tools. I use both. Not at once, obviously.",
  },
  {
    id: "one-condition",
    text: "One condition at a time, and the first one sticks. So burning something is also how you stop it ever being put to sleep. I have used that on purpose exactly once and claimed it was on purpose about forty times.",
  },
  {
    id: "paralysis-two-jobs",
    text: "Paralysis does two things and people only count one. Speed halved, and a quarter of their turns simply do not happen. The speed is the part that wins games. The quarter is the part you will remember, because it will happen twice in a row at the worst possible moment.",
  },
  {
    id: "toxic-is-not",
    text: "Toxic. Sounds frightening. Here it is ordinary poison — an eighth a turn, and it does not get worse. I badly wanted it to get worse. It does not get worse.",
  },
  {
    id: "status-follows",
    text: "A condition follows the creature into the box. Switching out does nothing; the box does nothing; time does nothing. A Center, a Full Heal, or a Rest. Those three. I learned this by putting a poisoned Geodude away for a week and taking out a poisoned Geodude.",
  },
  {
    id: "immunities",
    text: "You cannot burn a Fire type, freeze an Ice one, paralyse an Electric, or poison a Poison or a Steel. And you can put absolutely anything to sleep. Sleep is the one with no door on it. Make of that what you will.",
  },

  // -------------------------------------------------------- the volatiles
  {
    id: "switch-clears",
    text: "Everything the badge row shows you goes away when you switch — the stages, the seed, the confusion, all of it. Everything except the five conditions and the screens. That is not a bug, that is where they are *kept*. Switch out and watch most of it vanish; that is the explanation.",
  },
  {
    id: "shield-streak",
    text: "Protect works. Protect twice works one time in three. Three times, one in nine. Press it four times in a row and you have a one in thirty chance and a very confident opponent. And one failure puts you back to the start, so it costs you for pressing it again, not for having pressed it.",
  },
  {
    id: "perish-switch",
    text: "Perish Song counts four and then they simply fall over. No roll, no resistance, no clever item. Switching is the only answer in the entire game. If you have nobody to switch to, you have four turns to make peace with that.",
  },
  {
    id: "confusion-hits-self",
    text: "Confusion is four turns and a third of them they hit themselves — their own Attack against their own Defence, forty power, and the type chart is not consulted. So confusing a fragile thing hurts it and confusing a wall is a mild inconvenience. Confuse the glass.",
  },
  {
    id: "seed-caps",
    text: "Leech Seed drains an eighth and hands it across — but only as much as the other side has room for. Seed something while you are at full health and you have done half a move. Take a hit first. I know. It feels wrong. Do it anyway.",
  },
  {
    id: "nightmare-needs-sleep",
    text: "Nightmare takes a quarter of their maximum every turn, which is enormous, and it only works while they are asleep, which is the catch. The moment they wake it is gone. Sleep first, and remember sleep is one to three turns and sometimes none.",
  },
  {
    id: "yawn-is-polite",
    text: "Yawn is sleep that knocks first. Two turns' warning, and it still has to get past a Safeguard or an Insomnia when it arrives. Which means they get two turns to switch out. Everybody switches out. Everybody.",
  },

  // ------------------------------------------------- stages, screens, crits
  {
    id: "stages-are-halves",
    text: "One stage up is half again. Two is double. Six is four times. It is halves all the way — but accuracy and evasion are *thirds*, which is a different ladder that looks like the same ladder. Six stages of evasion is triple, not quadruple. Somebody lost money teaching me that.",
  },
  {
    id: "screens-survive",
    text: "Reflect and Light Screen belong to your side, not to whoever put them up. Five turns, and switching does not take them with you. Put one up, bring in the thing that needed it. That is the trick and it is the whole trick.",
  },
  {
    id: "mist-is-not-yours",
    text: "Mist stops the other side lowering your stats. It does not stop *you* lowering your own. So Close Combat still costs you your guard behind a Mist, and it should — that is not the opponent doing it to you, that is you.",
  },
  {
    id: "crit-ladder",
    text: "Criticals are a ladder of four rungs: one in twenty-four, one in eight, one in two, and always. A high-crit move and a Focus Energy climb the same ladder, so they stack properly instead of arguing. Get to the third rung and half your hits are critical. Half.",
  },
  {
    id: "always-crit",
    text: "Five moves in the world crit every single time regardless — Frost Breath, Storm Throw, Wicked Blow, Flower Trick, Surging Strikes. They skip the ladder entirely. And a Lucky Chant switches all five off, which is the single most annoying thing that has ever happened to me.",
  },
  {
    id: "crit-and-stages",
    text: "A critical is half again on the damage. Worth knowing alongside this: your stat drops do not stop a critical from being big, so a creature that has spent the whole battle lowering your Attack can still be removed by one lucky roll. Hope is a strategy. A bad one.",
  },
  {
    id: "lucky-chant",
    text: "Lucky Chant means no critical hits against your side at all. Five turns, survives a switch, and it turns off the five moves that always crit. Nobody ever teaches it and then somebody does and you find out what it does in the worst way.",
  },

  // ------------------------------------------------------- damage and types
  {
    id: "stab",
    text: "A move of your own type is half again stronger. Which is why a sixty-power move off-type is worse than a forty-power one on it, more often than people expect. Check the type before you check the number.",
  },
  {
    id: "arrows-on-buttons",
    text: "The arrows on the move buttons are not decoration and they are not the type chart either — they are the real answer, abilities included. A green double arrow means four times. A red cross means it does nothing at all and you have spent your turn on a gesture.",
  },
  {
    id: "no-arrow-is-neutral",
    text: "No arrow on a button means neutral. That silence is deliberate — if every button wore a badge saying 'normal' you would stop reading any of them, and then the one that mattered would be just another badge.",
  },
  {
    id: "quarters",
    text: "Effectiveness here travels in quarters, so a doubly-resisted hit is a quarter and the arithmetic never leaves the integers. The practical upshot: there is no rounding to argue with. Two machines fighting the same battle get the same number. Every time.",
  },
  {
    id: "immune-is-zero",
    text: "An immunity is not a very big resistance, it is nothing. Zero. No chip, no minimum of one. Ground into a Flying is a turn you gave away for free, and the button will tell you so with a red cross before you press it.",
  },

  // ---------------------------------------------------------------- moves
  {
    id: "multihit-average",
    text: "Fury Swipes says eighteen power and it is lying by omission — it lands two to five times. Three eighths for two, three eighths for three, an eighth each for four and five. Averages three. So it is really fifty-four power, and every blow rolls its own critical.",
  },
  {
    id: "multihit-crits",
    text: "Every blow of a multi-hit move rolls its own critical separately. Five blows is five chances. That is the actual reason those moves are frightening and it is not printed anywhere on the button.",
  },
  {
    id: "self-cost",
    text: "Close Combat costs you your guard. Overheat burns out your own special attack. Superpower spends the very Attack it just hit with — after the hit, mind, not before, which is the only ordering that makes it a trade rather than a swindle. Seventeen moves do this. Read them.",
  },
  {
    id: "self-cost-unstoppable",
    text: "Your own move's drawback is not the opponent lowering your stats, so a Clear Body will not save you from it and neither will a Mist. Nothing saves you from it. You pressed the button.",
  },
  {
    id: "pp-is-real",
    text: "Every move has uses and this game actually counts them. Run out of all four and you are down to Struggle, which hurts you. In the Cup there is no bed in the building — five battles on one tank. People do not plan for that. People lose to that.",
  },
  {
    id: "struggle-exists",
    text: "Struggle is always there and it is always a mistake you were forced into. If you are reaching for it, the battle was decided several turns ago in the move selection screen.",
  },
  {
    id: "triple-kick-rises",
    text: "Triple Kick climbs as it goes — ten, twenty, thirty — and it rolls accuracy again for every single blow. So it is either magnificent or it stops after the first one and you feel foolish. Triple Axel is the same idea with bigger numbers and the same capacity to humiliate.",
  },
  {
    id: "status-moves-filtered",
    text: "You will never be handed a move that does nothing. Anything the battle here cannot honour is kept out of the pools entirely rather than dealt to you as a dead button. Which means every one of your four does something. Find out what.",
  },
  {
    id: "moves-in-town",
    text: "You can rearrange which four a creature carries, but only in town. Standing in front of something and rebuilding your moveset to beat it would make every matchup a formality, so you have to decide before you leave. That is the game.",
  },
  {
    id: "learn-is-a-choice",
    text: "Nothing forgets a move behind your back. When something wants to learn a fifth you are asked which of the four goes, and you are allowed to say no. Say no more often than you think. A move you understand beats a move that is stronger.",
  },

  // ------------------------------------------------------- catching things
  {
    id: "balls-and-health",
    text: "Lower their health and the ball works better. Obvious. What is less obvious is that a condition helps too — sleep most of all — and that a sleeping target might wake up and eat your arm. There is a reason I do this for a living and still get bitten.",
  },
  {
    id: "ball-economy",
    text: "A Great Ball is half again as good as an ordinary one and an Ultra is twice. They cost rather more than that. Whether the maths works depends entirely on what is standing in front of you, which is a way of saying: do not throw an Ultra at a Rattata.",
  },
  {
    id: "cannot-catch-people",
    text: "You cannot throw a ball at somebody's creature. I want to be clear that I have never tried this. I want to be extremely clear about that.",
  },
  {
    id: "tree-is-catchable",
    text: "Something shaken out of a tree with Headbutt can be caught, same as the grass. It would be a peculiar sort of cruelty otherwise — here is a creature, it is real, you may not keep it. A hundred and twenty-odd species learn Headbutt. Trees are worth hitting.",
  },

  // -------------------------------------------------- IVs, natures, effort
  {
    id: "wild-ivs-cap",
    text: "Everything wild is born weak here. Nought to six in a stat, and six is the ceiling — not thirty-one, six. So the thing you just caught is a starting point and nothing else. Breeding is the only road up. There is no lucky wild one. There is no lucky wild one.",
  },
  {
    id: "natures-add",
    text: "Natures add here rather than multiply. Twenty-four points one way and twenty-four the other, the same on everything, which means the stat sheet can actually tell you what your nature is worth instead of gesturing at it. At level fifty that is twelve stat points. Exactly what it should be.",
  },
  {
    id: "effort-from-fighting",
    text: "What you fight decides what your creature becomes. Four effort points make one stat point at a hundred, two hundred and fifty-two is the most any one stat can hold, and five hundred and ten is the whole budget. Spend it on purpose or something will spend it for you.",
  },
  {
    id: "effort-yield-is-strength",
    text: "A species pays out in whatever it is best at. Beat a Machamp and you get Attack. Beat something flat and even and you get a spread nobody asked for, which quietly fills a budget you were saving. Pick your fights. Yes, really. Pick them.",
  },
  {
    id: "stat-sheet-columns",
    text: "The sheet splits base, IV, nature and effort into separate columns for a reason: three different systems feed every number. Until you can see them apart you cannot tell a well-bred creature from a lucky one, and there are no lucky ones here.",
  },
  {
    id: "shine-multiplier",
    text: "A true shiny is worth eight and a half percent on every stat. That sounds small. It is deliberately small — any more and the rarest thing in the world would be worth more than the entire breeding project, and this would be a lottery instead of a game.",
  },

  // ------------------------------------------------------------- breeding
  {
    id: "breeding-inherits-all",
    text: "Every stat comes down from one parent or the other, and three of the six climb above both. That climb is the only reason the ceiling ever moves. Without it six would be the ceiling for the rest of your life.",
  },
  {
    id: "breeding-generations",
    text: "About twenty-five generations to perfect a stat. Fewer with the right equipment. It is a project rather than an afternoon, and anybody who tells you they did it quickly either had the items or is lying to you in a friendly way.",
  },
  {
    id: "egg-steps",
    text: "Leave two at the daycare and walk three hundred steps. Not three hundred seconds — steps. Standing still achieves nothing. I have stood still. It achieved nothing.",
  },
  {
    id: "daycare-is-a-place",
    text: "The daycare is in Hearth and only in Hearth. You walk back. That is on purpose: if you could breed anywhere, walking out would not mean anything.",
  },
  {
    id: "shine-average",
    text: "A child starts at the average of its parents' rungs. Two true shinies always make a true shiny. A shiny and an ordinary lands halfway, and since five rungs do not halve neatly it falls either side with even odds — no favoured parent, no clever ordering.",
  },
  {
    id: "shine-climb",
    text: "One child in a hundred climbs a rung it was not given, and a tenth of those climb again. From two ordinary parents that is a true shiny at odds nobody would plan around — but it is never zero. No line is ever locked out. The Prism multiplies it by five.",
  },
  {
    id: "colour-breeding",
    text: "Two of a colour always breed that colour. One of a colour is a coin flip. Two different colours give forty percent each and leave a fifth spread across every colour there is — which is how a line arrives somewhere neither parent came from.",
  },
  {
    id: "lens-aims",
    text: "A lens is the only way to *aim* at a colour rather than wait for one. One chance in five to overrule everything else. There is one lens per colour and they are found in particular places, never sold. Somebody out there is standing next to yours.",
  },
  {
    id: "gender-gate",
    text: "Forty-nine male, forty-nine female, two percent Trans, the same on every species. A Trans one pairs with either, and with another Trans, because 'works with both' has no business stopping short of itself. And Ditto ignores the question entirely, as Ditto does.",
  },
  {
    id: "daycare-matrix",
    text: "The daycare shows you the odds for whatever you have put in it, and those odds are computed from the same function the game rolls against — not written on a card beside it. A published table that can drift from the truth is worse than no table.",
  },

  // ------------------------------------------------------ the world itself
  {
    id: "trainers-avoidable",
    text: "We stand on the paths, never in the grass. That is a courtesy: you can see me, so you can walk around me. If you walked into me, that was a decision. A small one. But a decision.",
  },
  {
    id: "rematch",
    text: "Come back in a thousand steps and I will have grown. Three levels for every time you have beaten me, and the same for everybody out here. A route you cleared at level ten is not a route you cleared.",
  },
  {
    id: "fog-is-memory",
    text: "The little map is a memory, not a satellite. It shows what you have looked at. One good vantage point is about a twelfth of a route, so mapping a place properly is a dozen of them and a walk between — and in the dark it is the three tiles around your boots.",
  },
  {
    id: "flash-twice",
    text: "Flash is worth carrying twice over. It lights the dark places, and it turns mapping a route from ten walks into one. Out past the middle bands you will want it. Out past the middle bands you will want it *badly*.",
  },
  {
    id: "gates-every-side",
    text: "Every route has a gap in its wall on each side that has a neighbour. So if you have found two ways out, that is not proof there are only two. Walk the wall. The map is drawn from cells that actually touch, not from a diagram somebody liked the look of.",
  },
  {
    id: "nth-not-ring",
    text: "The places repeat by kind. Four meadows, one Crystal Vault, and the nearest copy of a thing is always nearer than the second. So 'the first marsh' means something in every world — which is how the people who placed us knew where to stand.",
  },
  {
    id: "blackout-centre",
    text: "If everything faints you wake at the last Poké Center you actually walked into — not the one you healed at, the one you stood in. Walk into them. It costs a step and it saves you an hour when it goes wrong nine hops from home.",
  },
  {
    id: "greyline",
    text: "The Grey Line keeps somebody at every sort of place there is. Twenty-four posts, and they will take you back to anywhere you have already walked. Anywhere you have not, you walk. That part is not theirs to sell and they will tell you so.",
  },
  {
    id: "town-count",
    text: "Four towns. Hearth, and three founded further out — one on the way, one past that, one near the rim. Whoever planned that did it so there is never six hops of nowhere to heal. I have been to the version of this world where there was. I did not care for it.",
  },
  {
    id: "signs-beside-doors",
    text: "Every building outside has a board beside its door telling you what it is. Beside, never on — a sign that blocked its own door would be a very good joke and a very bad building. Four identical red roofs is a town you cannot read.",
  },

  // ----------------------------------------------------------- the census
  {
    id: "census-is-placed",
    text: "The rare ones are not rolled when you meet them. They were put in specific slots when the world was made. Fifty-eight of them, exactly, in every world that has ever existed on any seed. Walk away and come back and it is still there, still the same.",
  },
  {
    id: "no-reset-scumming",
    text: "There is nothing to reset. Nothing is rolled at the moment you need it, so there is no moment to reload into. I found this liberating after about a year of finding it infuriating.",
  },
  {
    id: "one-true-shiny",
    text: "One true shiny per world. One. Plus one wearing a colour — the crown, out on the outermost ring, and the seed picks which colour so no two worlds are hunting the same thing. Findable and finite. That is the whole pitch.",
  },
  {
    id: "fishing-no-variants",
    text: "Fishing will never land you a rare form. The census lives in the grass slots, and a pond that could also hold the world's one shiny would make the count a lie. Fish for depth and for water types. Not for colours.",
  },
  {
    id: "starters-are-lucky",
    text: "The three you are offered at the start roll their colours at twenty times the wild rate. A shiny one wearing a colour is about one seed in four thousand. If you got one, do not let it go; you will not see another.",
  },

  // -------------------------------------------------- money, shops, items
  {
    id: "buy-sell-loses",
    text: "The Mart buys as well as sells, and a buy-then-sell round trip always loses money. Always. A shop that broke even would be an infinite loop with a counter in front of it, and somebody thought about that before you did.",
  },
  {
    id: "candy-is-expensive",
    text: "A Rare Candy is priced so that fighting is the cheaper road to a level. That is not an accident and it is not a slight on the candy. It is the shop telling you what the game is about.",
  },
  {
    id: "breeding-gear-is-found",
    text: "The breeding equipment is found and never stocked, and the Mart will not buy it off you. Sell your world's only Prism and you have not made a trade, you have lost something the world contains exactly one of. They will not let you. Be grateful.",
  },
  {
    id: "items-out-of-battle",
    text: "No potions mid-fight. Out here, between fights, like a sensible person. A heal the other side cannot answer is the shortest road to a battle that never ends, and anyone who has played the other sort knows exactly what I mean.",
  },
  {
    id: "trainers-pay-money",
    text: "Beat somebody and they pay money, not a handful of balls. A refill is not a reward; a purse is a choice. It scales with what you beat and how far out you beat it, so the long walk pays for itself.",
  },
  {
    id: "held-items-are-free-to-try",
    text: "Giving something to hold takes it out of the bag and taking it back puts it in. Nothing is consumed by changing your mind. So trying a Choice Band on something costs you nothing but the walk, which means you should try it.",
  },
  {
    id: "treasure-is-for-selling",
    text: "Nuggets, pearls, that sort of thing — they do nothing. That is the point of them. They exist to be sold and the shopkeeper will pay properly. Do not carry a Nugget around waiting to discover its purpose. This is its purpose.",
  },
  {
    id: "repel-keeps-the-slot",
    text: "A repel spends the step and spends the roll and does not spend the encounter. Whatever was waiting in that grass is still waiting, in the same order, when the repel runs out. You are skipping the walk, not the creature.",
  },
  {
    id: "lure-reaches",
    text: "A lure burns for five hundred moves and reaches six encounters ahead. Six. So it is a way of looking further down the list than your feet have got, which is a different thing from making rare creatures appear. Nothing here makes rare creatures appear.",
  },

  // --------------------------------------------------------- field moves
  {
    id: "sweet-scent",
    text: "Sweet Scent pulls whatever is next out of the grass you are standing in — the same creature, in the same order, that walking about would have found. It saves you the walking, not the luck. There is no luck.",
  },
  {
    id: "dig-and-teleport",
    text: "Dig takes you up and out to town. Teleport takes you to the last Center you stood in. Those are different destinations and the difference will matter exactly once, at the worst moment, which is how I learned it.",
  },
  {
    id: "defog",
    text: "Defog fills in the whole route's map at a stroke. Yes, the whole thing. If you have somebody who knows it you have been walking around in the dark for no reason, and I say that with enormous sympathy.",
  },
  {
    id: "hms-are-items",
    text: "The tools are keys, not moves. Cut, Surf, Strength, Flash, Fly — they live in your bag, so no creature has to give up one of its four to open a door. A key shaped like a verb. Whoever thought of that saved us all a great deal of grief.",
  },
  {
    id: "milk-drink-field",
    text: "Milk Drink and Soft-Boiled hand over a fifth of the user's own maximum, out here, to somebody in your party. Free healing that costs a walk back from nothing. People forget they have it for entire playthroughs.",
  },

  // ----------------------------------------- the rival, gyms and the Cup
  {
    id: "rival-builds-on-you",
    text: "He builds his team out of yours. As many as you carry, three levels above your average, each one picked to beat one of yours. There is no preparing for him in general — you prepare by not having an obvious weakness, which nothing else in this world will ever ask of you.",
  },
  {
    id: "rival-no-escape",
    text: "You cannot run from him and you cannot throw a ball at him. He is three steps behind you for twenty moves with a number over his head counting down, and then he is in front of you. Run for a town if you must. He does not follow you in.",
  },
  {
    id: "rival-is-decorated",
    text: "He turns up wearing the colours you have spent forty hours hunting. Chromas, high shine, at rates nothing else in the world comes close to. I do not know where he gets them. I have views about where he gets them.",
  },
  {
    id: "gyms-scale",
    text: "A gym grows with you. Every badge you already hold adds five levels to every leader still standing, and they climb a level for every thousand moves you walk. Beating them in the wrong order is allowed. It is also harder, and it should be.",
  },
  {
    id: "cup-no-healing",
    text: "The Cup is five of them, six each, back to back, and there is no bed in that building. Five battles on one tank of move uses. Whatever is in your bag is what you have. People bring six creatures and three potions and are never heard from again.",
  },
  {
    id: "cup-opponents-are-perfect",
    text: "Every creature in the Cup is bred the way a serious person breeds — perfect where it counts, every point of effort spent on purpose, two abilities apiece. They are what your line is *for*. If you walk in with things you caught, you will find out very quickly.",
  },

  // ------------------------------------------------------ the design itself
  {
    id: "save-is-a-log",
    text: "Your save is the seed and the list of everything you have done. That is all it is. Which means replaying it proves it — a team you did not actually earn will not replay. Nobody has to trust you. I find that restful.",
  },
  {
    id: "same-seed-same-world",
    text: "Give somebody your seed and they get this world. The same three starters, the same creature in the same patch of grass, the same shiny in the same place. Two people, one seed, ten hours, bring your best six. That is a whole tournament and it needs no referee.",
  },
  {
    id: "cheats-are-recorded",
    text: "There is a cheat menu, and everything it does goes into your save like any other input. So a save that used one says so forever. That is not a threat, it is just honest bookkeeping. Cheat all you like. It will simply be written down.",
  },
  {
    id: "party-order-matters",
    text: "Whoever is in the first slot walks into the next fight. That is a decision, not tidying. And you cannot reorder mid-battle, because that would be a free switch and switching costs a turn like everything else.",
  },
  {
    id: "nothing-is-hidden",
    text: "You can hover anything on the battlefield, either side, and see the whole truth of it — stats, nature, effort, what it knows. There is nothing to protect by making you guess. The numbers were fixed when the world was made and guessing would only be slower.",
  },
  {
    id: "duel-commitment",
    text: "In a duel neither of you sees the other's move first — both are committed, then both are revealed. And the dice come from both your nonces, so neither of you owns them. Two browsers, no server, nobody refereeing, and it still cannot be cheated. I think that is beautiful.",
  },
];

/** Every hint by id, for anything that stores one. */
const BY_ID = new Map(HINTS.map((one) => [one.id, one]));

export function hint(id: string): Hint | null {
  return BY_ID.get(id) ?? null;
}

/**
 * Deals one hint to each of `count` people, from a deck rather than by rolling.
 *
 * The difference is the entire value of the feature. Rolling a hint per trainer
 * independently means the second person you meet has a one-in-a-hundred-odd
 * chance of repeating the first, which sounds fine and is not: across the
 * hundred trainers a player meets in their first few hours, a roll hands out
 * roughly sixty distinct hints and gives some of them three times. Dealing from
 * a shuffled deck hands out a hundred distinct hints and *then* starts
 * repeating.
 *
 * Shuffled again whenever it runs out, so a world with more people than hints
 * cycles rather than running dry — and shuffled again each time rather than
 * repeating the same order, since a player who has learned the sequence would
 * otherwise be able to predict the next person's line.
 *
 * The `rng` is the caller's, named and seeded like everything else, so a world
 * deals the same hints to the same people forever.
 */
export function dealHints(rng: () => number, count: number): string[] {
  const out: string[] = [];
  let deck: Hint[] = [];

  for (let index = 0; index < count; index++) {
    if (!deck.length) deck = shuffled(rng, HINTS);
    out.push(deck.pop()!.id);
  }

  return out;
}

/** Fisher-Yates, local rather than imported, because `world.ts` owns the one
 * in `rng.ts` and this file is not allowed to depend on the world. */
function shuffled(rng: () => number, source: readonly Hint[]): Hint[] {
  const copy = [...source];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
