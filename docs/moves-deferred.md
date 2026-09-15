# Moves not in yet

The third of the deferred lists, beside [`items-deferred.md`](./items-deferred.md)
and [`abilities-deferred.md`](./abilities-deferred.md), and under the same
rule: a move that half works teaches a player that moves are unreliable, which
is a much more expensive lesson than "that one is not in yet".

Every move here is a **status move whose manifest row is empty** — no
`status`, no `boosts`, no `heal`, no `drain`, no `secondary` — and which
`src/engine/statusmoves.ts` does not honour. Every such move is **filtered out
of every learnset and off the Mart's shelf** rather than dealt as a slot that
does nothing.

The measurement, re-run at every audit: **264 status moves in the manifest**,
and after the last pass — rooms, hazards, restriction, substitutes, borrowed
abilities and items, Baton Pass, the remaining callers, Curse and the four
guards that work one-on-one — the **11** below are what is left. Between them
they cost **156 species at least one learnset entry**, 187 entries in all.

Two guards keep this honest. `X56` checks that every filtered move has a row
here, and `X57` that no move in a row here has quietly been honoured after
all — the way H29 guards the items list.

---

## Not worth doing

Every one of these is about an ally, or about a doubles battle, and this game
is one-on-one throughout: there is no partner to help, to redirect attacks to,
to swap places with or to raise. In the games each one simply fails in a
singles battle, and a move that always fails is exactly the dead slot this list
exists to keep out of the pools.

| Move | Learners | Why not |
| --- | --- | --- |
| **Helping Hand** | 89 | an ally's move, harder |
| **After You**, **Quash** | 21, 6 | the target moves next, or last — only means something with more than two in the turn |
| **Ally Switch** | 17 | the two allies change places |
| **Rage Powder**, **Follow Me**, **Spotlight** | 14, 10, 6 | every move aimed at one creature, which with one target is every move already |
| **Magnetic Flux**, **Gear Up** | 10, 3 | the allies with Plus or Minus, raised — and neither ability exists here |
| **Rototiller** | 11 | every Grass type standing on soft soil |
| **Dragon Cheer** | 0 | an ally's crit ladder, and no species learns it anyway |
