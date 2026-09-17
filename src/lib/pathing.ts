import {
  critterOn,
  hasSeen,
  npcAt,
  tileAt,
  wantsRematch,
  type Direction,
  type GameState,
} from "@/engine/engine";
import { hasItem } from "@/engine/items";
import { passable } from "@/engine/terrain";
import { propBlocks, trainerAt, type World } from "@/engine/world";

/**
 * Tap-to-walk: the next step toward a tile you pointed at.
 *
 * Only ever a suggestion for the next single `move` input — the walk is still
 * a string of ordinary steps in the log, each one checked by the engine, so a
 * save made by tapping is the same save as one made with the arrow keys.
 *
 * The path only runs over ground you have already seen: pointing into the fog
 * does nothing, because a route you have not looked at is not a route the
 * map knows. It walks around people, creatures and trainers who want a fight,
 * and through a door, a creature or a person only when that is the very tile
 * pointed at — so tapping somebody walks you up to them and bumps them, which
 * is how talking already works.
 *
 * Recomputed every step rather than planned once, so anything that changes
 * under the walk — a trainer turning to fight, a creature wandering into the
 * way — is walked around, or ends it.
 */

const STEPS: readonly [Direction, number, number][] = [
  ["n", 0, -1],
  ["s", 0, 1],
  ["w", -1, 0],
  ["e", 1, 0],
];

/** The first step of the shortest walk to `target` over seen ground, or null if there is none. */
export function stepToward(world: World, state: GameState, target: { x: number; y: number }): Direction | null {
  const route = world.routes.get(state.route);
  if (!route) return null;
  if (state.x === target.x && state.y === target.y) return null;
  if (!hasSeen(state, route, target.x, target.y)) return null;

  const key = (x: number, y: number) => y * route.width + x;
  const first = new Map<number, Direction>();
  const queue: { x: number; y: number }[] = [{ x: state.x, y: state.y }];
  const seen = new Set<number>([key(state.x, state.y)]);

  const open = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= route.width || y >= route.height) return false;
    if (!hasSeen(state, route, x, y)) return false;
    if (!passable(tileAt(state, route, x, y), (item) => hasItem(state.bag, item))) return false;
    if (propBlocks(route, x, y)) return false;
    // Anything that turns a step into something else is only walked into on purpose.
    if (route.doors.some((door) => door.x === x && door.y === y)) return false;
    if (x === 0 || y === 0 || x === route.width - 1 || y === route.height - 1) return false;
    if (npcAt(world, state.route, x, y, state)) return false;
    if (critterOn(world, state, state.route, x, y)) return false;
    const trainer = trainerAt(world, state.route, x, y);
    if (trainer && wantsRematch(state, trainer.id)) return false;
    return true;
  };

  for (let head = 0; head < queue.length; head++) {
    const at = queue[head];
    for (const [dir, dx, dy] of STEPS) {
      const x = at.x + dx;
      const y = at.y + dy;
      const here = key(x, y);
      if (seen.has(here)) continue;
      const reached = x === target.x && y === target.y;
      if (!reached && !open(x, y)) continue;
      seen.add(here);
      const via = head === 0 ? dir : first.get(key(at.x, at.y))!;
      first.set(here, via);
      if (reached) return via;
      queue.push({ x, y });
    }
  }
  return null;
}
