import type { Individual } from "./types";

/**
 * How many creatures on a team a save cannot vouch for, by why.
 *
 * - **cheat**: a testing shortcut made or altered it.
 * - **vault**: a run began with it, copied out of the player's vault.
 * - **traded**: it came from somebody else's world.
 * - **prize**: it was won in a bracket rather than raised.
 *
 * Read off the flags each creature carries. A player's own client sends
 * those, so a modified client could strip them: this is a warning between
 * honest clients, not a proof. The proof is the verify page, which replays a
 * save and reads the flags off what the log produced.
 */
export interface TeamFlags {
  cheat: number;
  vault: number;
  traded: number;
  prize: number;
}

export const NO_FLAGS: TeamFlags = { cheat: 0, vault: 0, traded: 0, prize: 0 };

export function teamFlags(team: readonly Individual[]): TeamFlags {
  return {
    cheat: team.filter((one) => one.cheat).length,
    vault: team.filter((one) => one.vault).length,
    // Therapy changes how a creature behaves, not where it came from.
    traded: team.filter((one) => one.traded || one.rehabilitated).length,
    prize: team.filter((one) => one.prize || one.redeemed).length,
  };
}

export function anyFlags(flags: TeamFlags | undefined): boolean {
  return Boolean(flags && (flags.cheat || flags.vault || flags.traded || flags.prize));
}

/** "2 cheated, 1 from the vault", or null when there is nothing to say. */
export function flagsText(flags: TeamFlags | undefined): string | null {
  if (!flags) return null;
  const parts = [
    flags.cheat ? `${flags.cheat} cheated` : "",
    flags.vault ? `${flags.vault} from the vault` : "",
    flags.traded ? `${flags.traded} traded in` : "",
    flags.prize ? `${flags.prize} won as a prize` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/** Flags as another client sent them, or undefined when they did not make sense. */
export function readFlags(raw: unknown): TeamFlags | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const count = (value: unknown) => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 6 ? value : 0);
  const source = raw as Record<string, unknown>;
  return { cheat: count(source.cheat), vault: count(source.vault), traded: count(source.traded), prize: count(source.prize) };
}
