import { describe, expect, it } from "vitest";
import { AUCTION_LOTS, AUCTION_OPEN, AUCTION_STEP, bidWins, board, lot } from "@/engine/auction";
import { baseFormOf, species as speciesById } from "@/engine/dex";
import { applyInput, bidRefusal, collectRefusalAuction, initialState, type GameState } from "@/engine/engine";
import { testWorld } from "./helpers";

describe("the auction house", () => {
  const world = testWorld("PKMFEVER1");
  const base = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
  const [routeId, people] = [...world.npcs.entries()].find(([, list]) => list.some((one) => one.id === "auctioneer"))!;
  const auctioneer = people.find((one) => one.id === "auctioneer")!;
  const atBoard = (state: GameState): GameState => ({ ...state, route: routeId, x: auctioneer.x, y: auctioneer.y + 1, talking: "auctioneer" });

  it("AU1: six lots on the board, closing a thousand steps apart, and a new one at six thousand when one closes", () => {
    const now = board(world.seed, 0);
    expect(now).toHaveLength(AUCTION_LOTS);
    expect(now.map((one) => one.closesAt)).toEqual([1000, 2000, 3000, 4000, 5000, 6000]);

    const later = board(world.seed, 1000);
    expect(later[0].n).toBe(1);
    expect(later.at(-1)!.closesAt - 1000).toBe(AUCTION_OPEN);
    expect(board(world.seed, 2500).map((one) => one.closesAt - 2500)).toEqual([500, 1500, 2500, 3500, 4500, 5500]);
  });

  it("AU2: exotic, level 10 to 30, and very expensive", () => {
    for (let n = 0; n < 200; n++) {
      const one = lot(world.seed, n);
      expect(one.level).toBeGreaterThanOrEqual(10);
      expect(one.level).toBeLessThanOrEqual(30);
      expect(baseFormOf(one.speciesId)).toBe(one.speciesId);
      expect(one.price).toBeGreaterThanOrEqual(35000);
    }
    expect(lot(world.seed, 7)).toEqual(lot(world.seed, 7));
    const wins = Array.from({ length: 2000 }, (_, n) => bidWins(world.seed, n)).filter(Boolean).length;
    expect(wins / 2000).toBeGreaterThan(0.45);
    expect(wins / 2000).toBeLessThan(0.55);
  });

  it("AU3: a bid is paid now, and settling after the close gives the creature or the money back", () => {
    const rich = atBoard({ ...base, money: 1_000_000 });
    const target = board(world.seed, 0)[0];
    const bid = applyInput(world, rich, { t: "bid", n: target.n });
    expect(bid.money).toBe(1_000_000 - target.price);
    expect(bidRefusal(world, bid, target.n)).toContain("already");
    expect(collectRefusalAuction(world, bid)).toContain("closed");

    const closed = { ...bid, stepsTaken: target.closesAt };
    expect(bidRefusal(world, closed, target.n)).toContain("not on the board");
    const settled = applyInput(world, closed, { t: "collectBids" });
    expect(settled.bids).toEqual([]);
    if (bidWins(world.seed, target.n)) {
      expect(settled.party.at(-1)!.speciesId).toBe(target.speciesId);
      expect(settled.party.at(-1)!.level).toBe(target.level);
      expect(settled.money).toBe(bid.money);
    } else {
      expect(settled.money).toBe(1_000_000);
      expect(settled.party).toHaveLength(bid.party.length);
    }
  });

  it("AU4: no bid without the money", () => {
    const poor = atBoard({ ...base, money: 100 });
    expect(bidRefusal(world, poor, board(world.seed, 0)[2].n)).toContain("costs");
  });

  it("AU5: lots step along with real steps", () => {
    expect(AUCTION_STEP).toBe(1000);
    expect(board(world.seed, 999)[0].n).toBe(0);
    expect(board(world.seed, 1000)[0].n).toBe(1);
  });
});

describe("what goes up for auction", () => {
  it("AU6: about a third are legends, and a legend costs two and a half times as much", () => {
    const world = testWorld("PKMFEVER1");
    let legends = 0;
    for (let n = 0; n < 1000; n++) {
      const one = lot(world.seed, n);
      const legend = speciesById(one.speciesId).eggGroups.includes("Undiscovered");
      if (legend) legends++;
      const expected = Math.round(((20000 + one.level * 1500) * (legend ? 2.5 : 1)) / 500) * 500;
      expect(one.price).toBe(expected);
    }
    expect(legends / 1000).toBeGreaterThan(0.24);
    expect(legends / 1000).toBeLessThan(0.36);
  });
});
