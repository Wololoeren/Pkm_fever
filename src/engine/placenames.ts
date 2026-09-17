import { intBetween, rngFor } from "./rng";

/**
 * Names for the routes.
 *
 * Twenty biomes and fifty-odd routes means most biomes turn up two, three or
 * four times, and "Thunderplain · ring 2" next to "Thunderplain · ring 5" is
 * two places with one name. So every route is named by a small generator: a
 * kind of ground and something it is *of*, both drawn from words that belong
 * to its biome — "Fields of Static", "Maze of Discharge" — so the name still
 * tells you what sort of place you are walking into.
 *
 * Only ever a label. Drawn from a stream of its own, after the world is built,
 * so no name can move a tile, a creature or a roll, and nothing the engine
 * decides ever reads one: renaming every route leaves every save replaying
 * exactly as it did.
 */

interface Words {
  /** Kinds of ground. Singular or plural, whichever reads naturally before "of". */
  grounds: readonly string[];
  /** What the place is of. */
  of: readonly string[];
}

const WORDS: Record<string, Words> = {
  meadow: {
    grounds: ["Fields", "Meadow", "Downs", "Lea", "Pastures", "Green", "Commons"],
    of: ["Clover", "Buttercups", "Larks", "Honey", "Long Grass", "Summer", "Daisies", "Bees", "Dandelions"],
  },
  pinewood: {
    grounds: ["Woods", "Forest", "Thicket", "Grove", "Stand", "Timberland", "Glade"],
    of: ["Needles", "Resin", "Pinecones", "Owls", "Old Bark", "Shadows", "Sap", "Whispers", "Moss"],
  },
  ashflats: {
    grounds: ["Flats", "Wastes", "Plain", "Barrens", "Scar", "Expanse", "Reach"],
    of: ["Cinders", "Soot", "Embers", "Smoke", "Char", "Grey Snow", "Old Fires", "Kindling", "Ash"],
  },
  marsh: {
    grounds: ["Marsh", "Fen", "Bog", "Mire", "Wetlands", "Reeds", "Slough"],
    of: ["Frogs", "Rushes", "Mist", "Standing Water", "Leeches", "Lilies", "Peat", "Herons", "Drizzle"],
  },
  glacier: {
    grounds: ["Glacier", "Icefield", "Shelf", "Crevasse", "Tundra", "Floes", "Wastes"],
    of: ["Rime", "Hoarfrost", "Blue Ice", "Silence", "Frozen Breath", "Long Winter", "Sleet", "Icicles", "Stillness"],
  },
  stormcoast: {
    grounds: ["Coast", "Shore", "Cliffs", "Strand", "Headland", "Breakers", "Bay"],
    of: ["Gales", "Spray", "Squalls", "Gulls", "Thunderheads", "Salt Wind", "Wrecks", "Surf", "Lightning"],
  },
  dunes: {
    grounds: ["Dunes", "Sands", "Desert", "Erg", "Drifts", "Wastes", "Ridges"],
    of: ["Mirages", "Scorpions", "Dry Wind", "Glass", "Heat", "Thirst", "Sandstorms", "Sun", "Bones"],
  },
  boneyard: {
    grounds: ["Boneyard", "Ossuary", "Barrows", "Graves", "Field", "Hollows", "Pits"],
    of: ["Skulls", "Old Kings", "Marrow", "Rattles", "the Forgotten", "Dust", "Tusks", "Ribs", "Echoes"],
  },
  mycelia: {
    grounds: ["Tangle", "Undergrowth", "Rot", "Warren", "Carpet", "Thicket", "Hollow"],
    of: ["Spores", "Toadstools", "Mould", "Threads", "Damp", "Puffballs", "Decay", "Gills", "Caps"],
  },
  thunderplain: {
    grounds: ["Fields", "Maze", "Land", "Plain", "Flats", "Steppe", "Expanse"],
    of: ["Thunder", "Static", "Discharge", "Sparks", "Voltage", "Rolling Clouds", "Crackle", "Charge", "Storms"],
  },
  crystalvault: {
    grounds: ["Vault", "Caverns", "Galleries", "Halls", "Geodes", "Chambers", "Deep"],
    of: ["Quartz", "Prisms", "Facets", "Amethyst", "Refraction", "Glimmer", "Silence", "Mirrors", "Shards"],
  },
  emberfields: {
    grounds: ["Fields", "Fires", "Plain", "Burn", "Blaze", "Kilns", "Hearths"],
    of: ["Embers", "Flame", "Scorch", "Wildfire", "Smoulder", "Red Grass", "Sparks", "Heat Haze", "Brands"],
  },
  cloudreach: {
    grounds: ["Heights", "Peaks", "Reach", "Crags", "Summits", "Ridges", "Spires"],
    of: ["Clouds", "Thin Air", "Eagles", "Updrafts", "Vapour", "High Wind", "Vertigo", "Sky", "Condors"],
  },
  sunkenreach: {
    grounds: ["Reach", "Shallows", "Lagoon", "Drowned Lands", "Channels", "Sunk", "Basin"],
    of: ["Tides", "Pearls", "Kelp", "Undertow", "Coral", "Old Harbours", "Brine", "Currents", "Sunken Bells"],
  },
  bramblewood: {
    grounds: ["Brambles", "Briars", "Wood", "Hedges", "Thorns", "Scrub", "Copse"],
    of: ["Blackberries", "Hooks", "Snags", "Nettles", "Hawthorn", "Scratches", "Wild Roses", "Burrs", "Wrens"],
  },
  saltpan: {
    grounds: ["Pans", "Flats", "Crust", "Playa", "Basin", "Beds", "Wastes"],
    of: ["Salt", "White Glare", "Crystals", "Brine", "Dry Lakes", "Evaporation", "Mirage", "Bitter Water", "Crust"],
  },
  fellgarden: {
    grounds: ["Garden", "Beds", "Grounds", "Terraces", "Orchard", "Bower", "Arbour"],
    of: ["Nightshade", "Hemlock", "Poison Ivy", "Foxglove", "Thorns", "Wilting", "Blight", "Belladonna", "Rue"],
  },
  slagheap: {
    grounds: ["Heaps", "Tips", "Spoil", "Workings", "Pits", "Slag", "Yards"],
    of: ["Iron", "Rust", "Clinker", "Old Engines", "Scrap", "Tailings", "Smelt", "Gears", "Bolts"],
  },
  frostmire: {
    grounds: ["Mire", "Fen", "Bog", "Marsh", "Slush", "Hollows", "Wetlands"],
    of: ["Frost", "Black Ice", "Cold Mud", "Chill", "Frozen Reeds", "Numbness", "Sleet", "Pale Mist", "Hail"],
  },
  duskhollow: {
    grounds: ["Hollow", "Vale", "Dell", "Gloom", "Glen", "Coomb", "Dingle"],
    of: ["Dusk", "Shades", "Twilight", "Whispers", "Moths", "Long Shadows", "Lanterns", "Owls", "Nightfall"],
  },
};

/** Words for a biome the table does not know, so a new biome is named rather than a crash. */
const FALLBACK: Words = {
  grounds: ["Lands", "Reach", "Wilds", "Expanse", "Country"],
  of: ["Wandering", "Mystery", "Echoes", "Old Roads", "Far Places", "Winds"],
};

/** Every name a biome can produce, in a fixed order. */
function namesFor(biome: string): string[] {
  const words = WORDS[biome] ?? FALLBACK;
  return words.grounds.flatMap((ground) => words.of.map((of) => `${ground} of ${of}`));
}

/**
 * A name for every route, unique across the world.
 *
 * Routes are named in id order from a stream of their own, each drawing from
 * its biome's names not yet taken — so the same seed always names the same
 * route the same thing, and no two routes ever share a name.
 */
export function placeNames(seed: string, routes: readonly { id: string; biome: string }[]): Map<string, string> {
  const taken = new Set<string>();
  const named = new Map<string, string>();

  for (const route of [...routes].sort((a, b) => a.id.localeCompare(b.id))) {
    const free = namesFor(route.biome).filter((name) => !taken.has(name));
    const rng = rngFor(seed, "place-name", route.id);
    // Sixty-three names a biome and a handful of copies of it: running out is
    // not a real case, but a numbered name is better than a repeat.
    const name = free.length ? free[intBetween(rng, 0, free.length - 1)] : `${namesFor(route.biome)[0]} ${taken.size + 1}`;
    taken.add(name);
    named.set(route.id, name);
  }

  return named;
}

/** The words in a biome's names, for a test to check the names belong to their biome. */
export function placeWords(biome: string): Words {
  return WORDS[biome] ?? FALLBACK;
}
