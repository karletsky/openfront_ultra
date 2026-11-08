/**
 * Pure (no WebGL) helpers that turn the `settings.fx` slice into per-spawn
 * FX parameters. Kept out of the passes so they can be unit-tested.
 */

import {
  UT_ATOM_BOMB,
  UT_DIRTY_BOMB,
  UT_EMP_BOMB,
  UT_HYDROGEN_BOMB,
  UT_MIRV_WARHEAD,
  UT_TACTICAL_NUKE,
} from "../../../types";
import type { RenderSettings } from "../../RenderSettings";

/**
 * Visual explosion radius (shockwave / debris scatter — not the gameplay
 * damage radius) for a detonating unit type, or undefined for non-nukes.
 */
export function nukeExplosionRadius(
  fx: RenderSettings["fx"],
  unitType: string,
): number | undefined {
  switch (unitType) {
    case UT_ATOM_BOMB:
      return fx.nukeRadiusAtom;
    case UT_HYDROGEN_BOMB:
      return fx.nukeRadiusHydro;
    case UT_MIRV_WARHEAD:
      return fx.nukeRadiusMirv;
    // Advanced warfare nukes, scaled from the atom bomb's look.
    case UT_TACTICAL_NUKE:
      return fx.nukeRadiusAtom * 0.5;
    case UT_DIRTY_BOMB:
      return fx.nukeRadiusAtom * 0.45;
    case UT_EMP_BOMB:
      return 70;
    default:
      return undefined;
  }
}
