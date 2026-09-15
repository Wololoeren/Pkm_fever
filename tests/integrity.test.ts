import { describe, expect, it } from "vitest";
import { anyFlags, flagsText, readFlags, teamFlags } from "@/engine/integrity";
import { TourneySession, type TourneyMessage } from "@/engine/tourney";
import { creature } from "./helpers";

describe("warning about creatures a save cannot vouch for", () => {
  it("IN1: counts cheated, vault, traded and prize creatures, and says so", () => {
    const team = [
      creature("pikachu", { uid: 1 }),
      { ...creature("eevee", { uid: 2 }), cheat: true },
      { ...creature("dratini", { uid: 3 }), vault: true },
      { ...creature("abra", { uid: 4 }), traded: true, prize: true },
    ];
    const flags = teamFlags(team);
    expect(flags).toEqual({ cheat: 1, vault: 1, traded: 1, prize: 1 });
    expect(anyFlags(flags)).toBe(true);
    expect(flagsText(flags)).toBe("1 cheated, 1 from the vault, 1 traded in, 1 won as a prize");
    expect(flagsText(teamFlags([creature("pikachu", { uid: 1 })]))).toBeNull();
  });

  it("IN2: another client's flags are read defensively", () => {
    expect(readFlags({ cheat: 2, vault: -1, traded: "lots", prize: 99 })).toEqual({ cheat: 2, vault: 0, traded: 0, prize: 0 });
    expect(readFlags("nope")).toBeUndefined();
  });

  it("IN3: a tournament lobby shows each player's flags before the bracket starts", () => {
    const sent: { from: string; message: TourneyMessage }[] = [];
    const make = (self: string, host: boolean, team: ReturnType<typeof creature>[]) =>
      new TourneySession({ self, name: self, code: "ROOM", host, seed: "W", team, send: (message) => sent.push({ from: self, message }) });
    const host = make("host", true, [creature("pikachu", { uid: 1 })]);
    const guest = make("guest", false, [{ ...creature("eevee", { uid: 2 }), vault: true }]);
    guest.announce();
    for (const { from, message } of sent.splice(0)) if (from === "guest") host.receive(message, from);
    const seen = host.roster().find((one) => one.id === "guest")!;
    expect(seen.flags).toEqual({ cheat: 0, vault: 1, traded: 0, prize: 0 });
    expect(host.roster().find((one) => one.id === "host")!.flags).toEqual({ cheat: 0, vault: 0, traded: 0, prize: 0 });
  });
});
