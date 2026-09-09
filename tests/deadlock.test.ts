import { describe, expect, it } from "vitest";
import { ALL_SPECIES } from "@/engine/dex";
import { applyInput, initialState, type GameState, type Input } from "@/engine/engine";
import { intBelow, rngFor } from "@/engine/rng";
import { DEFAULT_WORLD } from "@/engine/types";
import { generateWorld, HUB_ID, type World } from "@/engine/world";

type Direction = "n" | "s" | "e" | "w";
const DIRECTIONS: readonly Direction[] = ["n", "s", "e", "w"];

/** The same beeline-out-then-drift-east walk tests/helpers.ts uses; a uniform
 * random walk spends hundreds of steps failing to find the hub's one-tile exit. */
function walkCandidates(world: World, state: GameState, rng: () => number): Input[] {
  const route = world.routes.get(state.route);
  const midY = route ? Math.floor(route.height / 2) : 9;
  const order: Direction[] = [];
  if (state.route === HUB_ID) {
    if (state.y < midY) order.push("s");
    else if (state.y > midY) order.push("n");
    else order.push("e");
  } else {
    const weighted: Direction[] = ["n", "n", "n", "n", "s", "s", "s", "s", "e", "e", "e"];
    order.push(weighted[intBelow(rng, weighted.length)]);
  }
  return [...order, ...DIRECTIONS].map((dir) => ({ t: "move", dir }) as Input);
}

function uiCandidates(world: World, state: GameState, rng: () => number): Input[] {
  const out: Input[] = [];
  if (state.phase === "starter") {
    for (let i = 0; i < 6; i++) out.push({ t: "pickStarter", index: i });
    return out;
  }
  if (state.phase === "battleEnd") return [{ t: "continue" }];
  if (state.phase === "battle") {
    const b = state.battle!;
    if (b.awaitingSwitch[0]) {
      for (let i = 0; i < b.sides[0].team.length; i++) out.push({ t: "switch", partyIndex: i });
      return out;
    }
    const active = b.sides[0].team[b.sides[0].active];
    for (let i = 0; i < Math.max(4, active.moves.length); i++) out.push({ t: "fight", moveIndex: i });
    for (let i = 0; i < b.sides[0].team.length; i++) out.push({ t: "switch", partyIndex: i });
    out.push({ t: "ball" });
    out.push({ t: "flee" });
    return out;
  }
  return walkCandidates(world, state, rng);
}

function legal(world: World, state: GameState, input: Input): GameState | null {
  try {
    return applyInput(world, state, input);
  } catch {
    return null;
  }
}

describe("deadlock probe", () => {
  it("never reaches a state with no legal input", () => {
    const failures: string[] = [];
    const stats = { battles: 0, fights: 0, longest: 0, trainerBattles: 0 };

    for (const seed of ["PKMFEVER1", "AAAA1", "ZZZZ9", "TOURNEY7", "GRASS42"]) {
      const world = generateWorld(DEFAULT_WORLD, seed, ALL_SPECIES);
      let state = initialState(world);
      let turnsInBattle = 0;

      for (let step = 0; step < 60000; step++) {
        const rng = rngFor("probe", seed, step);
        const cands = uiCandidates(world, state, rng);
        // Fight by preference so battles actually run to their natural length.
        const fights = state.phase === "battle" && !state.battle!.awaitingSwitch[0]
          ? cands.filter((c) => c.t === "fight")
          : [];
        const pool = fights.length ? fights : cands;

        let next: GameState | null = null;
        for (const c of pool) { next = legal(world, state, c); if (next) break; }
        if (!next) for (const c of cands) { next = legal(world, state, c); if (next) break; }

        if (!next) {
          const b = state.battle;
          failures.push(
            `NO LEGAL INPUT seed=${seed} step=${step} phase=${state.phase} route=${state.route} ` +
              `battleTurn=${b?.turn} tag=${b?.tag} awaiting=${JSON.stringify(b?.awaitingSwitch)} ` +
              `activeMoves=${b ? JSON.stringify(b.sides[0].team[b.sides[0].active].moves) : "-"} ` +
              `party=${state.party.map((c) => `${c.speciesId}/hp${c.hp}/mv${c.moves.length}`).join(",")}`,
          );
          break;
        }

        if (state.phase !== "battle" && next.phase === "battle") {
          stats.battles++;
          if (next.battle!.tag.startsWith("trainer:")) stats.trainerBattles++;
        }
        if (state.phase === "battle") {
          if (fights.length) stats.fights++;
          if (next.phase === "battle") {
            turnsInBattle++;
            stats.longest = Math.max(stats.longest, turnsInBattle);
            if (turnsInBattle > 1000) {
              const b = state.battle!;
              failures.push(
                `STALL seed=${seed} step=${step} ${turnsInBattle} turns, no end. tag=${b.tag} ` +
                  `ours=${b.sides[0].team[b.sides[0].active].speciesId}` +
                  `/hp${b.sides[0].team[b.sides[0].active].hp}` +
                  `/mv${JSON.stringify(b.sides[0].team[b.sides[0].active].moves)} ` +
                  `theirs=${b.sides[1].team[b.sides[1].active].speciesId}` +
                  `/hp${b.sides[1].team[b.sides[1].active].hp}` +
                  `/mv${JSON.stringify(b.sides[1].team[b.sides[1].active].moves)}`,
              );
              break;
            }
          } else {
            turnsInBattle = 0;
          }
        }
        state = next;
      }
    }
    console.log("probe stats", stats);
    expect(failures).toEqual([]);
  }, 600000);
});
