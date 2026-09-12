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
  /**
   * Every route whose table you have earned that lists it, outward. Only the
   * earned ones: the dex may say where a thing lives once a route has been
   * asked enough, and not before, which is the whole price of the reveal.
   */
  livesOn: string[];
  /**
   * What one you hold looks like, or null when you hold none. An appearance
   * is a fact about a creature, so the dex shows a picture only when there is
   * a creature to take it from; a seen-but-never-caught species has no
   * picture, because the one you met is not yours to draw.
   */
  variantId: string | null;
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

  // Which earned tables name each species, so an entry can say where it
  // lives without a second pass over the routes.
  const homes = new Map<string, string[]>();
  for (const route of routes) {
    for (const { speciesId } of route.table ?? []) {
      const list = homes.get(speciesId);
      if (list) list.push(route.routeId);
      else homes.set(speciesId, [route.routeId]);
    }
  }

  // The first of each species you hold, in the order they became yours.
  const held = new Map<string, string>();
  for (const one of [...state.party, ...state.box].sort((a, b) => a.uid - b.uid)) {
    if (!held.has(one.speciesId)) held.set(one.speciesId, one.variantId);
  }

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
      livesOn: homes.get(spec.id) ?? [],
      variantId: held.get(spec.id) ?? null,
    });
  }
  entries.sort((a, b) => a.num - b.num || a.speciesId.localeCompare(b.speciesId));

  return {
    seen: entries.length,
    caught: entries.filter((entry) => entry.caught).length,
    total: ALL_SPECIES.length,
    entries,
    routes,
  };
}

/**
 * The entries that match what was typed.
 *
 * A name or part of one, a dex number, a type, or the words "caught" and
 * "seen" — every term typed has to match, so "grass caught" is the Grass
 * types you own. Case does not matter and neither does the "#". Empty is
 * everything, in dex order.
 */
export function searchDex(entries: readonly DexEntry[], query: string): DexEntry[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.replace(/^#/, ""))
    .filter(Boolean);
  if (!terms.length) return [...entries];

  return entries.filter((entry) => {
    const types = speciesById(entry.speciesId).types;
    return terms.every((term) => {
      if (term === "caught") return entry.caught;
      if (term === "seen" || term === "uncaught") return !entry.caught;
      if (/^\d+$/.test(term)) return entry.num === Number(term) || String(entry.num).startsWith(term);
      return entry.name.toLowerCase().includes(term) || (types as readonly string[]).includes(term);
    });
  });
}
