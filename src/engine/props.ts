import { intBelow, shuffle, type Rng } from "./rng";
import type { InteriorRole } from "./world";

/**
 * Furniture.
 *
 * A separate layer rather than twenty-five new tile ids. A prop is a thing
 * standing *on* a floor, not a kind of floor, and the tile vocabulary is
 * already the thing that decides what you can walk on and what hides an
 * encounter — doubling its size with sofas would make every switch over it
 * five times longer for no gain.
 *
 * Whether a prop blocks is a property of the prop, so a rug is something you
 * walk over and a bookcase is not, without either of them needing a tile.
 */

export type PropKind =
  | "table" | "chair" | "stool" | "bed" | "bunk"
  | "bookcase" | "shelf" | "cabinet" | "chest" | "crate"
  | "barrel" | "sack" | "basket" | "bin" | "pot"
  | "rug" | "mat" | "plant" | "vase" | "flowerbox"
  | "lamp" | "painting" | "clock" | "mirror" | "hearth";

export interface PropSpec {
  kind: PropKind;
  /** Whether you can stand on it. */
  walkable: boolean;
  /** Whether it wants to be against a wall, or is happy in the open. */
  wall: boolean;
}

export const PROPS: Record<PropKind, PropSpec> = {
  table: { kind: "table", walkable: false, wall: false },
  chair: { kind: "chair", walkable: false, wall: false },
  stool: { kind: "stool", walkable: false, wall: false },
  bed: { kind: "bed", walkable: false, wall: true },
  bunk: { kind: "bunk", walkable: false, wall: true },

  bookcase: { kind: "bookcase", walkable: false, wall: true },
  shelf: { kind: "shelf", walkable: false, wall: true },
  cabinet: { kind: "cabinet", walkable: false, wall: true },
  chest: { kind: "chest", walkable: false, wall: true },
  crate: { kind: "crate", walkable: false, wall: false },

  barrel: { kind: "barrel", walkable: false, wall: false },
  sack: { kind: "sack", walkable: false, wall: true },
  basket: { kind: "basket", walkable: false, wall: false },
  bin: { kind: "bin", walkable: false, wall: true },
  pot: { kind: "pot", walkable: false, wall: false },

  // The flat ones. A rug you cannot walk on is not a rug.
  rug: { kind: "rug", walkable: true, wall: false },
  mat: { kind: "mat", walkable: true, wall: false },
  plant: { kind: "plant", walkable: false, wall: true },
  vase: { kind: "vase", walkable: false, wall: true },
  flowerbox: { kind: "flowerbox", walkable: false, wall: true },

  // The ones that hang. Drawn on the wall itself, so they never take a floor
  // tile and never stand between you and a door.
  lamp: { kind: "lamp", walkable: true, wall: true },
  painting: { kind: "painting", walkable: true, wall: true },
  clock: { kind: "clock", walkable: true, wall: true },
  mirror: { kind: "mirror", walkable: true, wall: true },
  hearth: { kind: "hearth", walkable: false, wall: true },
};

export const PROP_KINDS = Object.keys(PROPS) as PropKind[];

export interface PropPlacement {
  x: number;
  y: number;
  kind: PropKind;
}

/** What each sort of room is furnished out of, in rough order of importance. */
const ROOM_STYLE: Record<InteriorRole, PropKind[]> = {
  house: [
    "bed", "table", "chair", "bookcase", "rug", "hearth", "lamp", "painting",
    "clock", "plant", "cabinet", "stool", "vase", "mirror", "basket",
  ],
  daycare: [
    "bunk", "crate", "sack", "basket", "mat", "shelf", "plant", "flowerbox",
    "barrel", "pot", "stool", "bin", "lamp", "clock", "table",
  ],
  centre: [
    "bed", "bunk", "cabinet", "shelf", "clock", "lamp", "plant", "rug",
    "mirror", "chair", "table", "vase", "painting", "stool", "bin",
  ],
  // Spartan on purpose: a gym is a room somebody fights in.
  gym: [
    "mat", "rug", "bin", "crate", "barrel", "lamp", "clock", "painting",
    "stool", "shelf", "chest", "mirror", "pot", "table", "bunk",
  ],
  mart: [
    "crate", "barrel", "sack", "shelf", "cabinet", "chest", "bin", "table",
    "clock", "lamp", "basket", "pot", "stool", "mat", "painting",
  ],
};

/**
 * Furnishes one room.
 *
 * Wall pieces go round the edge and everything else stands in the middle, with
 * the tile in front of the door left clear — a bookcase across the way out
 * would be a room you can enter and not leave, which no amount of atmosphere
 * makes up for.
 */
export function furnish(
  rng: Rng,
  width: number,
  height: number,
  role: InteriorRole,
  keepClear: readonly { x: number; y: number }[],
): PropPlacement[] {
  const style = ROOM_STYLE[role] ?? ROOM_STYLE.house;
  const blocked = new Set(keepClear.map((at) => `${at.x},${at.y}`));
  const used = new Set<string>();

  const spots = (wall: boolean) => {
    const out: { x: number; y: number }[] = [];
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const againstWall = x === 1 || y === 1 || x === width - 2 || y === height - 2;
        if (againstWall !== wall) continue;
        if (blocked.has(`${x},${y}`) || used.has(`${x},${y}`)) continue;
        out.push({ x, y });
      }
    }
    return out;
  };

  const placed: PropPlacement[] = [];

  // Between eight and thirteen pieces: enough that a room reads as lived in,
  // few enough that it is still a room rather than a warehouse.
  const wanted = 8 + intBelow(rng, 6);

  for (let i = 0; i < wanted; i++) {
    const kind = style[i % style.length];
    const spec = PROPS[kind];
    const options = shuffle(rng, spots(spec.wall));
    const at = options[0];
    if (!at) continue;

    used.add(`${at.x},${at.y}`);
    placed.push({ x: at.x, y: at.y, kind });
  }

  return placed;
}
