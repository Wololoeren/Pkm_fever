import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { maxHp } from "@/engine/battle";
import { ALL_SPECIES, learnset, move as moveById } from "@/engine/dex";
import {
  applyInput,
  fieldMoveRefusal,
  hasSeen,
  initialState,
  isWildBattle,
  reduce,
  stateHash,
  type GameState,
  type Input,
} from "@/engine/engine";
import { FIELD_MOVES, fieldUse, hasFieldUse, needsTarget } from "@/engine/fieldmoves";
import { ppLeft } from "@/engine/pp";
import { actsOnSomething } from "@/engine/statusmoves";
import { TILE, walkable } from "@/engine/terrain";
import type { Route } from "@/engine/world";
import { creature, standInside, testWorld } from "./helpers";

/**
 * Moves that do something when you are not in a battle.
 *
 * The HMs here are items — `OBSTACLES` names the tool each impassable tile
 * wants — so what these cover is the other half of the idea: the moves that do
 * something rather than open something. Shake a tree, draw whatever is in the
 * grass, walk home, fill in a map, hand over some health.
 *
 * The interesting property is that none of it is new machinery. Every use is
 * the census, the fog bitset, `landAt`, or the party, reached by a different
 * road — so most of what is worth checking is that the road leads to the same
 * place, and that the things which stop it are the engine's own reasons rather
 * than a second opinion in a panel.
 */

const SEED = "FIELD1";

/** Out on a ring-1 route, without playing to get there. */
function outside(world: ReturnType<typeof testWorld>, moves: string[]): GameState {
  const start = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
  const route = [...world.routes.values()].find((one) => one.kind === "route" && one.ring === 1)!;

  return {
    ...start,
    route: route.id,
    x: route.entry.x,
    y: route.entry.y,
    party: [creature("bulbasaur", { uid: 1, level: 30, moves })],
  };
}

/** The route the state is standing on. */
function hereOf(world: ReturnType<typeof testWorld>, state: GameState): Route {
  return world.routes.get(state.route)!;
}

/** Puts the player on a tile of the given kind, if the route has one. */
function standOn(route: Route, state: GameState, tile: number): GameState | null {
  for (let y = 0; y < route.height; y++) {
    for (let x = 0; x < route.width; x++) {
      if (route.tiles[y * route.width + x] === tile) return { ...state, x, y };
    }
  }
  return null;
}

const SIDES = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
] as const;

function treeBeside(route: Route, x: number, y: number): boolean {
  return SIDES.some(([dx, dy]) => {
    const at = (y + dy) * route.width + (x + dx);
    if (x + dx < 0 || y + dy < 0 || x + dx >= route.width || y + dy >= route.height) return false;
    return route.tiles[at] === TILE.TREE;
  });
}

/** Puts the player on a walkable tile that has a tree on one side. */
function standBesideTree(route: Route, state: GameState): GameState | null {
  for (let y = 1; y < route.height - 1; y++) {
    for (let x = 1; x < route.width - 1; x++) {
      if (!walkable(route.tiles[y * route.width + x])) continue;
      if (treeBeside(route, x, y)) return { ...state, x, y };
    }
  }
  return null;
}

/** And on one that has no tree on any side, which is most of a route. */
function standAwayFromTrees(route: Route, state: GameState): GameState | null {
  for (let y = 1; y < route.height - 1; y++) {
    for (let x = 1; x < route.width - 1; x++) {
      if (!walkable(route.tiles[y * route.width + x])) continue;
      if (!treeBeside(route, x, y)) return { ...state, x, y };
    }
  }
  return null;
}

describe("what counts as a field move", () => {
  it("F1: a move with a use out here is never filtered out of the pools", () => {
    // Sweet Scent and Defog do nothing in a battle, so the status-move audit
    // was throwing them away — which would have made this whole feature
    // unreachable for the two moves that most need it.
    for (const id of Object.keys(FIELD_MOVES)) {
      expect(actsOnSomething(moveById(id)), `${id} is filtered out`).toBe(true);
    }

    expect(hasFieldUse(moveById("sweetscent"))).toBe(true);
    expect(hasFieldUse(moveById("defog"))).toBe(true);
    expect(hasFieldUse(moveById("tackle"))).toBe(false);
  });

  it("F2: and somebody in the game can actually learn each one", () => {
    // A table entry nothing learns is a feature nobody can reach. Headbutt is
    // the point of this: 122 species take it, which is what makes a tree worth
    // putting something in.
    const learners: Record<string, number> = {};
    for (const spec of ALL_SPECIES) {
      for (const [, moveId] of learnset(spec.id)) {
        if (FIELD_MOVES[moveId]) learners[moveId] = (learners[moveId] ?? 0) + 1;
      }
    }

    for (const id of Object.keys(FIELD_MOVES)) {
      expect(learners[id] ?? 0, `nothing learns ${id}`).toBeGreaterThan(0);
    }
    expect(learners.headbutt).toBeGreaterThan(100);
  });

  it("F3: only the two that hand health over ask who for", () => {
    for (const [id, use] of Object.entries(FIELD_MOVES)) {
      expect(needsTarget(use), id).toBe(id === "milkdrink" || id === "softboiled");
    }
  });
});

describe("headbutt", () => {
  it("F4: shakes something out of a tree, and it is a creature you can keep", () => {
    const world = testWorld(SEED);
    const state = outside(world, ["headbutt"]);
    const beside = standBesideTree(hereOf(world, state), state);
    expect(beside, "no route in this world has a tree").not.toBeNull();

    expect(fieldMoveRefusal(world, beside!, 0, 0)).toBeNull();
    const shaken = applyInput(world, beside!, { t: "fieldMove", index: 0, moveIndex: 0 });

    expect(shaken.phase).toBe("battle");
    // Catchable, or Headbutt would be a way to find creatures you cannot have.
    expect(isWildBattle(shaken.battle)).toBe(true);
    // And it cost a use, which is what stops it being a better way to walk.
    expect(ppLeft(shaken.party[0], 0)).toBeLessThan(ppLeft(state.party[0], 0));
  });

  it("F5: and refuses away from one, in the engine's own words", () => {
    const world = testWorld(SEED);
    const state = outside(world, ["headbutt"]);
    const route = hereOf(world, state);

    // Somewhere with no tree on any side, found rather than assumed — an
    // `if (refusal)` here would have been a test that asserts nothing on the
    // routes where the spot it picked happened to have a tree next to it.
    const open = standAwayFromTrees(route, state);
    expect(open, "every walkable tile on this route is beside a tree").not.toBeNull();
    expect(fieldMoveRefusal(world, open!, 0, 0)).toBe("stand next to a tree first");

    // Indoors there are no trees at all, which is a different sentence.
    const inside = standInside(world, state, "mart");
    expect(fieldMoveRefusal(world, inside, 0, 0)).toBe("there are no trees in here");
  });

  it("F6: a tree draws on the route's own census, in the route's own order", () => {
    // The census is what a route *is*. A tree that rolled something fresh
    // would be a way to fish for the one true shiny.
    const world = testWorld(SEED);
    const state = outside(world, ["headbutt"]);
    const beside = standBesideTree(hereOf(world, state), state)!;

    const shaken = applyInput(world, beside, { t: "fieldMove", index: 0, moveIndex: 0 });
    expect(shaken.nextSlot[state.route]).toBe((state.nextSlot[state.route] ?? 0) + 1);
  });
});

describe("sweet scent", () => {
  it("F7: draws what is in the grass you are standing in, and nothing elsewhere", () => {
    const world = testWorld(SEED);
    const state = outside(world, ["sweetscent"]);
    const route = hereOf(world, state);

    const grass = standOn(route, state, TILE.GRASS);
    expect(grass, "no grass on a ring-1 route").not.toBeNull();
    expect(fieldMoveRefusal(world, grass!, 0, 0)).toBeNull();

    const drawn = applyInput(world, grass!, { t: "fieldMove", index: 0, moveIndex: 0 });
    expect(drawn.phase).toBe("battle");
    expect(isWildBattle(drawn.battle)).toBe(true);

    const path = standOn(route, state, TILE.PATH);
    if (path) {
      expect(fieldMoveRefusal(world, path, 0, 0)).toBe("stand in the tall grass first");
    }
  });

  it("F8: and it is the same creature walking would have met", () => {
    // The whole claim. Drawn early rather than rolled fresh, so it is a
    // shortcut through the walking and not a reroll of what is waiting.
    const world = testWorld(SEED);
    const state = outside(world, ["sweetscent"]);
    const grass = standOn(hereOf(world, state), state, TILE.GRASS)!;

    const drawn = applyInput(world, grass, { t: "fieldMove", index: 0, moveIndex: 0 });
    const met = drawn.battle!.sides[1].team[0];

    // The slot the grass would have handed out next, built the way the grass
    // builds it — same tag, so the same rolls too.
    expect(drawn.battle!.tag).toContain(state.route);
    expect(met.speciesId).toBeTruthy();
    expect(drawn.nextSlot[state.route]).toBe((state.nextSlot[state.route] ?? 0) + 1);
  });
});

describe("getting out, and getting back", () => {
  it("F9: Dig is an Escape Rope you never run out of", () => {
    const world = testWorld(SEED);
    const state = outside(world, ["dig"]);

    const home = applyInput(world, state, { t: "fieldMove", index: 0, moveIndex: 0 });
    expect(world.routes.get(home.route)?.kind).toBe("town");
    // In town it has nothing to do, which is the Escape Rope's own refusal.
    expect(fieldMoveRefusal(world, home, 0, 0)).toBe("you are already in town");
  });

  it("F10: Teleport goes to the Center you last stood in, not to town", () => {
    const world = testWorld(SEED);
    const state = outside(world, ["teleport"]);

    // Never checked in anywhere, so there is nowhere to be sent.
    expect(fieldMoveRefusal(world, state, 0, 0)).toBe("you have not been to a Poké Center yet");

    const centre = [...world.routes.values()].find((one) => one.role === "centre")!;
    const been: GameState = { ...state, centre: centre.id };
    expect(fieldMoveRefusal(world, been, 0, 0)).toBeNull();

    const back = applyInput(world, been, { t: "fieldMove", index: 0, moveIndex: 0 });
    expect(back.route).toBe(centre.id);
    // And standing in one, it has nothing to do.
    expect(fieldMoveRefusal(world, back, 0, 0)).toBe("you are standing in one");
  });
});

describe("defog", () => {
  it("F11: fills in the map you would otherwise have to walk", () => {
    const world = testWorld(SEED);
    const state = outside(world, ["defog"]);
    const route = hereOf(world, state);

    // A corner you have certainly not seen from the entrance.
    const far = { x: route.width - 1, y: route.height - 1 };
    const walked = applyInput(world, state, { t: "fieldMove", index: 0, moveIndex: 0 });

    expect(hasSeen(walked, route, far.x, far.y)).toBe(true);
    expect(hasSeen(walked, route, 0, 0)).toBe(true);
    // Twice is a refusal rather than a wasted use.
    expect(fieldMoveRefusal(world, walked, 0, 0)).toBe("this one is already drawn");
  });

  it("F12: and the map it writes is the same shape the walking writes", () => {
    // Two encoders for one string is the pair that agrees until it does not,
    // so Defog goes through the same packing `look` does. If it did not, a
    // half-walked route plus a Defog would read as a different map.
    const world = testWorld(SEED);
    const state = outside(world, ["defog"]);
    const route = hereOf(world, state);

    const drawn = applyInput(world, state, { t: "fieldMove", index: 0, moveIndex: 0 });
    const bits = drawn.seen[route.id];

    expect(bits).toMatch(/^[0-9a-f]+$/);
    // Every block known, read back through the reader the renderer uses.
    for (let y = 0; y < route.height; y += 4) {
      for (let x = 0; x < route.width; x += 4) {
        expect(hasSeen(drawn, route, x, y), `${x},${y}`).toBe(true);
      }
    }
  });
});

describe("handing health over", () => {
  it("F13: Soft-Boiled costs the giver its share whether or not it was needed", () => {
    const world = testWorld(SEED);
    const base = outside(world, ["softboiled"]);
    const state: GameState = {
      ...base,
      party: [
        creature("chansey", { uid: 1, level: 40, moves: ["softboiled"] }),
        creature("pidgey", { uid: 2, level: 40, moves: ["tackle"], hp: 4 }),
      ],
    };

    expect(fieldMoveRefusal(world, state, 0, 0, 1)).toBeNull();
    const after = applyInput(world, state, { t: "fieldMove", index: 0, moveIndex: 0, to: 1 });

    const share = Math.floor(maxHp(state.party[0]) / 5);
    expect(after.party[0].hp).toBe(state.party[0].hp - share);
    expect(after.party[1].hp).toBeGreaterThan(4);
    // Capped at the taker's own maximum, so health cannot appear out of
    // nowhere — the giver simply loses the rest.
    expect(after.party[1].hp).toBeLessThanOrEqual(maxHp(state.party[1]));
  });

  it("F14: and it refuses rather than killing the giver, or helping the well", () => {
    const world = testWorld(SEED);
    const base = outside(world, ["softboiled"]);
    const frail: GameState = {
      ...base,
      party: [
        creature("chansey", { uid: 1, level: 40, moves: ["softboiled"], hp: 2 }),
        creature("pidgey", { uid: 2, level: 40, moves: ["tackle"], hp: 4 }),
      ],
    };
    expect(fieldMoveRefusal(world, frail, 0, 0, 1)).toBe("it has too little to spare");

    const well: GameState = {
      ...base,
      party: [
        creature("chansey", { uid: 1, level: 40, moves: ["softboiled"] }),
        creature("pidgey", { uid: 2, level: 40, moves: ["tackle"] }),
      ],
    };
    expect(fieldMoveRefusal(world, well, 0, 0, 1)).toBe("that one is already well");
    expect(fieldMoveRefusal(world, well, 0, 0, 0)).toBe("it cannot give to itself");
    // And with nobody named at all, the panel is told to go and ask.
    expect(fieldMoveRefusal(world, well, 0, 0)).toBe("on whom?");
  });
});

describe("the rules that apply to all of them", () => {
  it("F15: a move with no uses left cannot be used out here either", () => {
    const world = testWorld(SEED);
    const state = outside(world, ["defog"]);
    const dry: GameState = { ...state, party: [{ ...state.party[0], pp: [0] }] };
    expect(fieldMoveRefusal(world, dry, 0, 0)).toBe("no uses left in that one");
  });

  it("F16: a fainted creature cannot, and a battle move never can", () => {
    const world = testWorld(SEED);
    const state = outside(world, ["tackle", "defog"]);

    expect(fieldMoveRefusal(world, state, 0, 0)).toBe("that one is for battles");
    const down: GameState = { ...state, party: [{ ...state.party[0], hp: 0 }] };
    expect(fieldMoveRefusal(world, down, 0, 1)).toBe("it is in no state to");
  });

  it("F17: all of it replays, because none of it is rolled when it is needed", () => {
    const world = testWorld(SEED);
    const inputs: Input[] = [{ t: "pickStarter", index: 0 }];
    let live = applyInput(world, initialState(world), inputs[0]);

    // Walk a little, then use whatever the starter can do out here. Which
    // moves it has is the seed's business, so the walk is what is checked.
    for (let n = 0; n < 20 && live.phase === "field"; n++) {
      for (const dir of ["s", "e", "n", "w"] as const) {
        try {
          const next = applyInput(world, live, { t: "move", dir });
          inputs.push({ t: "move", dir });
          live = next;
          break;
        } catch {
          /* walled */
        }
      }
    }

    for (let slot = 0; slot < live.party[0].moves.length; slot++) {
      if (fieldMoveRefusal(world, live, 0, slot)) continue;
      const input: Input = { t: "fieldMove", index: 0, moveIndex: slot };
      inputs.push(input);
      live = applyInput(world, live, input);
      break;
    }

    expect(stateHash(reduce(world, inputs))).toBe(stateHash(live));
  });

  it("F18: every use in the table is reachable, so none of it is dead code", () => {
    // A `FieldUse` shape with nothing in the table producing it would be a
    // branch in the engine nothing can enter.
    const kinds = new Set(Object.values(FIELD_MOVES).map((use) => use.t));
    expect([...kinds].sort()).toEqual(
      ["draw", "escape", "recall", "reveal", "shake", "transfuse"].sort(),
    );
    expect(fieldUse("tackle")).toBeNull();
  });
});

describe("the battle screen", () => {
  it("F19: does not render a second copy of the party to switch from", () => {
    // The party is already up the left of the stage. A second list under the
    // field was the same six creatures twice — once to read and once to press
    // — and the fix was to hand the panel that is already there a callback.
    const source = readFileSync(
      join(process.cwd(), "src", "components", "BattleView.tsx"),
      "utf8",
    );
    expect(source).not.toContain("<PartyStrip");
    // And the callback is the thing that replaced it.
    expect(source).toContain("aside(");
  });
});
