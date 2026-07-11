/**
 * The CLI version, single-sourced from package.json at build time via tsup's
 * `define`. When the code runs un-bundled (vitest, tsx) the define is absent
 * and the dev placeholder applies.
 */

declare const __BEACON_VERSION__: string;

export const VERSION =
  typeof __BEACON_VERSION__ !== "undefined" ? __BEACON_VERSION__ : "0.0.0-dev";
