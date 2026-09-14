"use client";

import type { CSSProperties } from "react";
import type { Field } from "@/engine/field";

/**
 * The weather, falling on the field.
 *
 * The badge above the field says which weather is up and for how long; this
 * says it without being read. Pure display, drawn from `battle.field` and
 * nothing else, so a save cannot depend on a raindrop.
 *
 * Everything moves in CSS. Each particle's column, delay and speed are worked
 * out from its index rather than rolled, so the same weather looks the same on
 * every render and nothing flickers when React draws the field again.
 *
 * It sits behind both creatures and inside a box that clips it, so it never
 * covers a nameplate and never cuts off a hover panel. Reduced motion stops
 * the particles and keeps the tint.
 */

/** How many particles each weather draws. */
const COUNT: Record<string, number> = { rain: 46, sand: 34, hail: 26, snow: 38 };

/**
 * A number in 0..1 for particle `at`, spread evenly rather than randomly.
 *
 * A different irrational step for each property. One shared step made the
 * column, the height and the delay move together, so sand blew in a single
 * diagonal line and snow fell in rows.
 */
const STEPS = [0.618034, 0.414214, 0.732051, 0.236068, 0.645751, 0.162278];
function spread(at: number, salt: number): number {
  return (((at + 1) * STEPS[salt % STEPS.length] + salt * 0.137) % 1 + 1) % 1;
}

function particles(kind: string): CSSProperties[] {
  const count = COUNT[kind] ?? 0;
  const base = kind === "rain" ? 0.8 : kind === "hail" ? 1.15 : kind === "sand" ? 2.2 : 6;
  return Array.from({ length: count }, (_, at) => ({
    // Sand blows across rather than down, so it moves along `left` itself.
    left: kind === "sand" ? undefined : `${(spread(at, 1) * 110 - 5).toFixed(2)}%`,
    top: kind === "sand" ? `${(spread(at, 2) * 100).toFixed(2)}%` : undefined,
    animationDelay: `-${(spread(at, 3) * base * 2).toFixed(2)}s`,
    animationDuration: `${(base * (0.75 + spread(at, 4) * 0.5)).toFixed(2)}s`,
    // Snow and sand vary in size; rain and hail barely do.
    ["--size" as string]: `${(kind === "snow" ? 3 + spread(at, 5) * 4 : kind === "sand" ? 2 + spread(at, 5) * 2 : 3).toFixed(1)}px`,
  }));
}

export function WeatherLayer({ field }: { field: Field | undefined }) {
  const weather = field?.weather?.id ?? null;
  const terrain = field?.terrain?.id ?? null;
  if (!weather && !terrain) return null;

  return (
    <div className="weatherLayer" aria-hidden="true">
      {terrain ? <div key={terrain} className={`terrainGlow terrain-${terrain}`} /> : null}
      {weather ? (
        <div key={weather} className={`weather weather-${weather}`}>
          {weather === "sun" ? (
            <>
              <span className="sunGlow" />
              <span className="sunRays" />
            </>
          ) : (
            particles(weather).map((style, at) => <span key={at} className="drop" style={style} />)
          )}
        </div>
      ) : null}
    </div>
  );
}
