# The trainer's policy

How the side you are not driving decides what to do, why it is built the way
it is, and how to train it again.

**The short version.** A trainer *searches*. For every legal action of its
own and the three replies the other side is likeliest to make, it plays the
turn out on the real engine six times on differently named dice, plays one
more turn with a cheap policy, and reads the position that results. Every
step of that is integer arithmetic on a pure engine, so the choice is a pure
function of the battle state and replays identically on any machine. The
cheap policy underneath it, an integer dot product of thirty-four features
and thirty-four weights, plays the rollouts, ranks the replies, and is what
the training pipeline exists to improve.

---

## Why not a GAN

A generative adversarial network learns to produce samples that a second
network cannot tell apart from a dataset. It answers "what does a thing from
this distribution look like?" A battle AI has to answer "what should I do
*here*, so that I win later?", which is a sequential decision problem with
delayed reward. There is no dataset of expert battles to imitate the
distribution of, the quality of a decision is not something a discriminator
can read off one turn, and the adversarial part of a GAN is a training trick
for density estimation, not a model of an opponent. Every approach that has
worked on games of this shape is a search, a value function, a policy, or a
combination; none of them is a GAN.

The word people usually mean when they say GAN here is *self-play*, which is
adversarial in the ordinary sense. That is used below, in the form that does
not need a neural network.

## What the engine makes easy

Three properties of `src/engine/battle.ts` decide the design.

- **`resolveTurn` is pure.** The same state and the same two actions give the
  same next state. That makes the engine its own simulator: any "what if I
  did this" is one function call, with no copying of hidden state.
- **A battle is a pure function of its seed.** The other side's choices are
  never in a save file; they are recomputed on replay. So whatever decides
  for a trainer has to be deterministic in the battle state, and it has to
  be *bit-identical across machines*, because two peers checking the same
  save must agree. That rules out floating-point inference in play — a
  `Math.exp` or `tanh` is not promised to round the same in every JavaScript
  engine — and it is why the policy that ships is integer arithmetic and an
  argmax.
- **Nothing in the engine is a neural-network runtime**, and nothing should
  be. The game runs in a browser with no build step for weights.

## The candidates

| Approach | What it needs | Fits the constraints? |
| --- | --- | --- |
| Hand-written heuristic | A person's time, forever | Deterministic and cheap. Stops improving when the person does. It is the *starting point* here, not the answer. |
| Search in play (expectimax, MCTS) | The pure engine, per turn | Deterministic if the rollouts are, and integer if the value is. Every turn costs a few hundred `resolveTurn` calls, which is nine milliseconds; the cost that matters is that loading a save replays every trainer battle in it. **This is what plays**, with the budget set by that. |
| Reinforcement learning (PPO, DQN) | A network, a training loop, millions of turns | Rewards are sparse and the game has hidden information, so it is the slowest of these to get anywhere; and inference is floating point unless the network is quantised by hand. Possible later; not first. |
| Imitation of a search oracle ("expert iteration") | The engine as oracle, a small model, a fit | Supervised learning is stable; the labels come from the engine itself so there is no dataset to collect; and the model can be anything, including one that is integer at inference. **This is how the cheap policy inside the search is made**, and it is what plays where the search cannot be afforded. |
| Evolution strategies over the same model | The arena, patience | Deterministic and needs no gradients, but a win rate over a few hundred games is a very noisy signal for thirty-four numbers. Used here only in the last mile, on a much cheaper objective. |
| GAN | A dataset and a discriminator | Wrong problem — see above. |

## How it is built

Everything lives in `src/ai/`, imports the engine, and is imported by it in
exactly one place.

- **`actions.ts`** — `legalActions(state, side)`: the moves with uses left,
  the healthy bench, Struggle when there is nothing else, in a fixed order.
  Every candidate is checked with `actionRefusal`, so the policy never hands
  the engine something it will throw on.
- **`features.ts`** — `featuresOf(state, side, action)`: thirty-four
  integers, most in thousandths. The important ones are an estimate of the
  move's damage as a fraction of the target's HP (a middle roll of the real
  formula, with the same floors in the same order), whether that is a
  knock-out, the type chart, STAB, accuracy, priority, who moves first, and,
  for a switch, the same questions asked of the creature coming in. A
  `threat` family asks what the other side's best move would do back. The
  list is versioned: a weights file records the names it was trained
  against, and a mismatch is refused at load.
- **`policy.ts`** — `linearPolicy(weights)`: argmax of the dot product, with
  ties broken by the battle's own random stream so two identical moves are
  not always the first. `UNIFORM` is the opponent the game shipped with.
- **`value.ts`** — `evaluate(state, side)`: health and bodies, ours minus
  theirs, or the outcome. Deliberately blunt, because the search supplies the
  cleverness.
- **`oracle.ts`** — the search, and the teacher. For each legal action, for
  each reply considered, on `samples` differently-named dice, resolve the
  turn, play `horizon` more turns with a rollout policy, and score the
  position. Under `model: "predict"` the replies are the other side's three
  best by the linear ranking, weighted four, two and one over the rest, and
  the value is three parts that expectation to one part the worst of them:
  enough hedge to refuse a coin-flip. The real dice are never used: a player
  that could see the next critical hit would be gambling on numbers the other
  side's replay does not have.
- **`teams.ts`** — level-matched random teams from the whole bestiary, as a
  pure function of a seed.
- **`arena.ts`** — two policies over a set of matchups, each played from both
  chairs, so a lopsided matchup does not flatter whoever held the stronger
  team.
- **`train.ts`** — `collect` (play battles, ask the teacher about every
  decision), `fit` (full-batch Adam on softmax cross-entropy against the
  teacher's values, in floating point), `quantize` (to integers),
  `refine` (coordinate descent on the integer weights, minimising the value
  the student's pick loses against the teacher's), and `iterate`, which does
  the four in rounds: after the first round the student plays the games and
  the teacher's rollouts, so the positions collected are the ones the
  student's own habits lead to.
- **`index.ts`** — loads `src/data/ai-weights.json`, checks it, builds the
  linear policy and the search over it, and exports `trainerAction`.
  `engine.ts` calls it for anything that is not the grass;
  `lib/tournament.ts` calls it for both chairs of a cup.

## What the numbers said

Measured on *mirror matches*, the same team in both chairs and every matchup
played from both sides, because on random matchups the teams decide and
every policy lands at fifty percent. Share of decided games, 160 games each
unless said otherwise.

| Policy | vs random play | vs the linear policy | ms per decision |
| --- | --- | --- | --- |
| Linear (hand-set weights) | 90% | — | 0.1 |
| Search, 2 dice, no rollout | | 46% | 1 |
| Search, 3 dice, 2 rollout turns, win worth 100,000 | | 46% (300 games) | 14 |
| Search, 3 dice, 2 rollout turns, win worth 1,500 | | 54% | 14 |
| Search, 8 dice, 1 rollout turn | | 57% | 16 |
| **Search, 6 dice, 1 rollout turn, matchup term** | 94% | **59%** | **9** |
| Search, 6 dice, 2 rollout turns, matchup term | | 59–64% | 16 |
| Search, 6 dice, 3 rollout turns, matchup term | | 52% | 22 |

Three things had to be found out the hard way. A win worth a hundred
thousand made the search a gambler: one sample in three that happened to
end the battle outweighed any position that had not, so a coin-flip on a
knock-out beat a sure hit. Dice noise was the next ceiling: the argmax of a
noisy estimate is the luckiest action, not the best one, and six samples
was where that stopped dominating. And a value that only counts health
cannot see that the creature on the field is outmatched until it has been
hit, so it now also weighs what each active creature can do to the other.
Deeper rollouts did not help: the horizon adds noise faster than it adds
foresight with a rollout policy this simple.

The pruning to three predicted replies is what pays for the extra dice.
Without it the same setting is twice the time for the same result.

The grass still picks at random. A wild creature running a damage calculator
is not what a wild creature is, and every existing save's wild rolls are
part of its replay.

## Training it

```bash
npm run ai:train -- --seed fever --iterations 3 --games 100 --samples 3 --horizon 1 --write
npm run ai:eval -- --seed judge --games 100
```

The whole run is a pure function of its flags. `--continue` starts from the
shipped weights instead of from nought; `--write` replaces
`src/data/ai-weights.json`. The script prints the weights, the agreement and
regret on what it trained on, the same on a held-out set it never trained
on, and arena results against random play, against the weights that ship,
and against the teacher itself. The held-out regret is the number to watch:
arena shares over a hundred games move by ten points on noise alone.

Two rules for changing it:

- **Add a feature at the end of `FEATURE_NAMES`, never in the middle**, and
  retrain. The names are the contract.
- **Changing the policy is an `ENGINE_VERSION` bump.** A trainer battle in a
  save is replayed against whatever the policy says today, so different
  weights, a different search setting, or a different value are a different
  battle. The version was raised to 28 when the policy arrived, and it goes
  up again whenever any of the three changes.
- **Keep the search under about ten milliseconds a decision.** Loading a
  save replays every trainer battle in it. A long playthrough has hundreds
  of trainer decisions, and every millisecond here is a second on load.

## Where it stops, and what would move it

The search looks one turn ahead with real dice and one more with a linear
guess, and the linear guess is what limits it: a better rollout policy makes
every leaf value more honest, which is what lets a longer horizon pay. So
the road to a stronger opponent runs through the cheap policy, in order of
cost:

1. **Train the linear policy against the search**, not against the uniform
   teacher: `collect` with `model: "predict"` and the current weights as
   `guess`. The pipeline supports it today; it has not yet beaten the
   hand-set weights on held-out regret, which is the gate.
2. **A model with a hidden layer**, still integer at inference: fixed-point
   weights, a ReLU, and an argmax are as deterministic as a dot product. The
   training side is a hundred lines of hand-written backprop, or a Python
   trainer that exports integers; the dataset `collect` produces is plain
   JSON either way.
3. **Take the replay cost off the load path.** If a save recorded the
   opponent's choices and only the tournament check-in recomputed them, the
   search could afford ten times the dice in play. That changes what a save
   file is, and is a decision for the save format rather than for this page.
