import { ALL_SPECIES, species as speciesById } from "./dex";
import type { GameState } from "./engine";
import { encounterTable, type World } from "./world";

/**
 * The Pokédex: seen, caught, and what a route has shown you.
 *
 * Two of its three questions were already answered by state that existed for
 * other reasons. *Seen* is `whereMet` — every species you have stood across a
 * battlefield from or held, and where. *What lives here* is the route's own
 * encounter table, which is a pure function of the world and has never needed
 * storing. Only *caught* is new: a sorted list of species ever owned, folded
 * in the same place `whereMet` is, so the party and the box are the source and
 * releasing something later does not unwrite having had it.
 *
 * ## The reveal
 *
 * The field notes deliberately carry no denominator — "7 of the 23 that live
 * here" would turn a record of where you have been into a checklist of where
 * to go. The dex is the checklist, and it is allowed to be one, on a condition:
 * a route's table is shown only once you have met `DEX_REVEAL` things on it.
 * That is read off `nextSlot`, which already counts every encounter served on
 * a route, so the reveal costs no state at all. Before that the route says how
 * many more it wants, and nothing else.
 */

/** Encounters on a route before its table is shown. */
export const DEX_REVEAL = 10;

export interface DexEntry {
  speciesId: string;
  num: number;
  name: string;
  seen: boolean;
  caught: boolean;
  /** Where it was first met, when it has been. */
  where: string | null;
}

export interface DexRoute {
  routeId: string;
  label: string;
  /** Encounters served here so far. */
  encounters: number;
  /** The table, once `encounters` has reached the reveal; null before. */
  table: { speciesId: string; weight: number }[] | null;
}

export interface Dex {
  seen: number;
  caught: number;
  total: number;
  /** Every species that has been seen, in dex order. The unseen are a count. */
  entries: DexEntry[];
  /** Every outdoor route stepped on, outward, with its table if earned. */
  routes: DexRoute[];
}

export function dexOf(world: World, state: GameState): Dex {
  const caught = new Set(state.caught);
  const entries: DexEntry[] = [];
  for (const spec of ALL_SPECIES) {
    const where = state.whereMet[spec.id];
    if (where === undefined) continue;
    entries.push({
      speciesId: spec.id,
      num: spec.num,
      name: spec.name,
      seen: true,
      caught: caught.has(spec.id),
      where,
    });
  }
  entries.sort((a, b) => a.num - b.num || a.speciesId.localeCompare(b.speciesId));

  const order = (id: string) => {
    const route = world.routes.get(id);
    return route ? route.depth * 100 + route.ring : 9999;
  };
  const routes: DexRoute[] = state.visited
    .map((routeId) => world.routes.get(routeId))
    .filter((route): route is NonNullable<typeof route> => route !== undefined && route.kind === "route")
    .map((route) => {
      const encounters = state.nextSlot[route.id] ?? 0;
      return {
        routeId: route.id,
        label: route.label,
        encounters,
        table:
          encounters >= DEX_REVEAL
            ? encounterTable(ALL_SPECIES, route.biome, route.ring, world.config.rings)
                .map(({ speciesId, weight }) => ({ speciesId, weight }))
                .sort((a, b) => b.weight - a.weight || speciesById(a.speciesId).num - speciesById(b.speciesId).num)
            : null,
      };
    })
    .sort((a, b) => order(a.routeId) - order(b.routeId) || a.routeId.localeCompare(b.routeId));

  return {
    seen: entries.length,
    caught: entries.filter((entry) => entry.caught).length,
    total: ALL_SPECIES.length,
    entries,
    routes,
  };
}
