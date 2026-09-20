import { describe, expect, it } from "vitest";
import {
  AUCTION_KEEN,
  AUCTION_LOTS,
  AUCTION_OPEN,
  AUCTION_OPENING,
  AUCTION_RAISE,
  AUCTION_STEP,
  AUCTION_TICK,
  askingPrice,
  board,
  keenness,
  lot,
} from "@/engine/auction";
import { baseFormOf, species as speciesById } from "@/engine/dex";
import { applyInput, bidRefusal, closedBids, currentAsk, outbid, collectRefusalAuction, initialState, type GameState } from "@/engine/engine";
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
  });

  it("AU3: a bid is paid now, and settling after the close gives the creature or the money back", () => {
    const rich = atBoard({ ...base, money: 1_000_000 });
    const target = board(world.seed, 0)[0];
    const ask = currentAsk(world, rich, target.n);
    const bid = applyInput(world, rich, { t: "bid", n: target.n });
    expect(bid.money).toBe(1_000_000 - ask);
    expect(bidRefusal(world, bid, target.n)).toContain("on the table");
    expect(collectRefusalAuction(world, bid)).toContain("closed");

    const closed = { ...bid, stepsTaken: target.closesAt };
    expect(bidRefusal(world, closed, target.n)).toContain("not on the board");
    const won = closedBids(world, closed)[0].won;
    const settled = applyInput(world, closed, { t: "collectBids" });
    expect(settled.bids).toEqual([]);
    if (won) {
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
    expect(bidRefusal(world, poor, board(world.seed, 0)[2].n)).toContain("going for");
  });

  it("AU4b: the room bids against you, and you can go again at the new price or take the money back", () => {
    const rich = atBoard({ ...base, money: 1_000_000 });
    const target = board(world.seed, 0).find((one) => one.closesAt >= 5000)!;

    // Bid the moment it opens, then walk far enough for the room to notice.
    const early = applyInput(world, rich, { t: "bid", n: target.n });
    const later = { ...early, stepsTaken: target.closesAt - AUCTION_TICK };
    expect(outbid(world, later, target.n), "nobody wanted it in six thousand steps").toBe(true);
    expect(currentAsk(world, later, target.n)).toBeGreaterThan(early.bids[0].price);

    // Going again costs only the difference, and puts you back on top.
    const again = applyInput(world, later, { t: "bid", n: target.n });
    expect(again.money).toBe(1_000_000 - currentAsk(world, later, target.n));
    expect(outbid(world, again, target.n)).toBe(false);
    expect(again.bids).toHaveLength(1);

    // Left outbid, the lot closes against you and every coin comes back.
    const lost = { ...later, stepsTaken: target.closesAt };
    expect(closedBids(world, lost)[0].won).toBe(false);
    expect(applyInput(world, lost, { t: "collectBids" }).money).toBe(1_000_000);
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

describe("the room", () => {
  it("AU7: a lot opens at a third and creeps up 70/30 of a percent of its worth per tick", () => {
    const world = testWorld("PKMFEVER1");
    expect(AUCTION_OPENING).toBe(30);
    expect(AUCTION_TICK).toBe(200);
    expect(AUCTION_RAISE).toBe(10);

    // The shape of it: the chance of a raise falls as the ask rises, so the
    // expected gain per tick is flat — keenness x raise x ask, and the ask
    // cancels. A third of a percent at the open, a fifth at the close.
    expect(keenness(10_000, 3_000)).toBe(776);
    expect(keenness(10_000, 10_000)).toBe(233);
    for (const ask of [3_000, 4_000, 5_000, 6_000]) {
      const gain = (keenness(10_000, ask) / 1000) * (AUCTION_RAISE / 100) * ask;
      expect(Math.round(gain)).toBe(Math.round((AUCTION_KEEN / 1000) * (AUCTION_RAISE / 100) * 10_000));
    }

    // And the walk itself, over a thousand lots: 30% at the open, and about
    // the whole price by the hammer.
    const opening = board(world.seed, 0).map((one) => askingPrice(world.seed, one.n, 0) / one.price);
    for (const share of opening) expect(share).toBeCloseTo(0.3, 5);

    let total = 0;
    let most = 0;
    for (let n = 0; n < 1000; n++) {
      const spec = lot(world.seed, n);
      const end = askingPrice(world.seed, n, spec.closesAt) / spec.price;
      total += end;
      most = Math.max(most, end);
      expect(end).toBeGreaterThanOrEqual(0.3);
    }
    expect(total / 1000).toBeGreaterThan(0.95);
    expect(total / 1000).toBeLessThan(1.05);
    expect(most).toBeLessThan(2);
  });

  it("AU8: it only moves while the lot is on the board, and never afterwards", () => {
    const world = testWorld("PKMFEVER1");
    const spec = lot(world.seed, 20);
    const open = Math.max(0, spec.closesAt - AUCTION_OPEN);
    expect(askingPrice(world.seed, 20, open)).toBe(Math.round((spec.price * AUCTION_OPENING) / 100));
    const atClose = askingPrice(world.seed, 20, spec.closesAt);
    expect(askingPrice(world.seed, 20, spec.closesAt + 50_000)).toBe(atClose);
    // It never falls.
    let last = 0;
    for (let steps = open; steps <= spec.closesAt; steps += AUCTION_TICK) {
      const ask = askingPrice(world.seed, 20, steps);
      expect(ask).toBeGreaterThanOrEqual(last);
      last = ask;
    }
  });
});
