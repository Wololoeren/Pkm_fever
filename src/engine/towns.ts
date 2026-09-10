import type { InteriorRole } from "./world";

/**
 * The towns, and the people who stand in them.
 *
 * Four: the one you start in, and three founded out on the lattice at least
 * three hops from each other and from home. Where each one *is* comes from the
 * plan and not from here — they are cells chosen for being as far apart as the
 * world allows — so a name cannot promise a place. See `OUTER_TOWNS` in
 * layout.ts.
 *
 * ## The three out there are each an homage
 *
 * Hearth is Hearth: it is where you wake up and it does not need a joke. The
 * other three each borrow the shape of a television programme — a mountain town
 * where the awful is unremarkable, a future where the future is a job, and a
 * garage where a very clever man is a great deal of trouble — and everything in
 * them leans the same way. The people, what they say, the jobs they hand out,
 * the things they sell and the creatures pottering about are all of a piece.
 *
 * They are homages rather than transcriptions: the situations are recognisable
 * and the words are this game's own. That is the better joke anyway. A line
 * lifted whole is somebody else's; a line that lands because you know what it
 * is *doing* is a joke you and the game are making together.
 *
 * They escalate with the world, because the plan founds them in order of
 * distance: the first is a town where children are unsupervised, the second is
 * an office, the third is a garage with a hole in reality in it. Which is more
 * or less the order in which those three things get harder to explain.
 */

export interface TownSpec {
  id: string;
  name: string;
  /** Which buildings it keeps. Only Hearth has the daycare. */
  roles: InteriorRole[];
}

export const TOWNS: readonly TownSpec[] = [
  { id: "hub-0", name: "Hearth", roles: ["daycare", "centre", "mart", "house"] },
  { id: "town-1", name: "Southpass", roles: ["centre", "mart", "house"] },
  { id: "town-2", name: "New Willow", roles: ["centre", "mart", "house"] },
  { id: "town-3", name: "Sanchford", roles: ["centre", "mart", "house"] },
];

/**
 * Somebody standing in a town who will fight you, written down rather than
 * generated.
 *
 * The routes fill themselves: `buildTrainers` draws a team from the route's own
 * encounter table a couple of levels above the grass, which is the right answer
 * for a hundred and fifty anonymous people. It is the wrong answer here,
 * because in a town the team *is* the joke — five of the same creature, or a
 * man, a bear and a pig — and a table cannot tell a joke.
 *
 * Everything else about them is ordinary. They are `TrainerSpec`s standing on a
 * map, walking into one starts a battle through the same door as anywhere else,
 * and beating one pays out the same way.
 */
export interface TownTrainer {
  id: string;
  town: string;
  name: string;
  /** Roughly where in the square. The world finds the nearest open ground. */
  x: number;
  y: number;
  team: { speciesId: string; level: number }[];
}

export const TOWN_TRAINERS: readonly TownTrainer[] = [
  // ------------------------------------------------------------- Southpass
  {
    // A small boy in a red hat with strong opinions about being respected, and
    // a team selected entirely on the basis of mass.
    id: "town-cartwright",
    town: "town-1",
    name: "Cartwright",
    x: 12,
    y: 10,
    team: [
      { speciesId: "munchlax", level: 26 },
      { speciesId: "swalot", level: 27 },
      { speciesId: "snorlax", level: 29 },
    ],
  },
  {
    // The cryptid nobody believes in, which is three animals at once. Fielded
    // as three animals, because that is funnier than looking for one creature
    // that is all three.
    id: "town-cryptid",
    town: "town-1",
    name: "Cryptid Hunter",
    x: 28,
    y: 18,
    team: [
      { speciesId: "machoke", level: 26 },
      { speciesId: "ursaring", level: 28 },
      { speciesId: "grumpig", level: 26 },
    ],
  },

  // ------------------------------------------------------------ New Willow
  {
    // A bending unit with a drinking problem and a magnificent opinion of
    // itself. Steel, obviously.
    id: "town-bendo",
    town: "town-2",
    name: "Bendo",
    x: 12,
    y: 10,
    team: [
      { speciesId: "klang", level: 40 },
      { speciesId: "bronzong", level: 41 },
      { speciesId: "klinklang", level: 43 },
    ],
  },
  {
    // Announces at length which planet he is from and how far away it is.
    // Beheeyem and Elgyem are, in this game's own bestiary, actual visitors.
    id: "town-lrrr",
    town: "town-2",
    name: "Lrrr the Loud",
    x: 28,
    y: 18,
    team: [
      { speciesId: "elgyem", level: 40 },
      { speciesId: "beheeyem", level: 43 },
    ],
  },

  // ------------------------------------------------------------- Sanchford
  {
    // He turned himself into a pickle. It was, by his own account, the funniest
    // thing he had ever done. He now cannot move, and fields the one creature
    // in the game whose whole contribution is also not moving.
    id: "town-pickle",
    town: "town-3",
    name: "The Pickle",
    x: 12,
    y: 10,
    team: [{ speciesId: "metapod", level: 52 }],
  },
  {
    // A council of himselves. Ditto is a creature that is a copy of somebody
    // else, so five of them is the joke told in the game's own vocabulary
    // rather than in the programme's.
    id: "town-council",
    town: "town-3",
    name: "The Council",
    x: 28,
    y: 18,
    team: [
      { speciesId: "ditto", level: 48 },
      { speciesId: "ditto", level: 49 },
      { speciesId: "ditto", level: 50 },
      { speciesId: "ditto", level: 51 },
      { speciesId: "ditto", level: 52 },
    ],
  },
];
