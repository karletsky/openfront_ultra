import type { RenderSettings } from "../RenderSettings";
import type { HeightField } from "./HeightField";
import {
  buildView3D,
  type Footprint,
  groundFootprint,
  projectToScreen,
  rayToPlane,
  rayToTerrain,
  type View3D,
} from "./Projection3D";

/** A 2D camera as the input side sees it: look-at point + px per tile. */
export interface ScreenCamera {
  centerX: number;
  centerY: number;
  zoom: number;
  viewW: number;
  viewH: number;
}

/**
 * Screen ↔ world conversion for the tilted 3D view. The input handler
 * (TransformHandler) asks this whenever 3D is on, so clicks, hover and HUD
 * anchors follow the same projection the renderer draws with. Reads the live
 * settings object, so toggling 3D or changing the tilt applies immediately.
 */
export class View3DProjector {
  constructor(
    private settings: RenderSettings["view3d"],
    private heights: () => HeightField | null,
  ) {}

  isActive(): boolean {
    return this.settings.enabled;
  }

  heightScale(): number {
    return this.settings.heightScale;
  }

  view(cam: ScreenCamera): View3D {
    return buildView3D({
      ...cam,
      pitchDeg: this.settings.pitch,
      fovDeg: this.settings.fov,
    });
  }

  /** World elevation (tiles) at a world point. */
  elevation(x: number, y: number): number {
    const hf = this.heights();
    return hf ? hf.sample(x, y) * this.settings.heightScale : 0;
  }

  /**
   * World point under a screen pixel. `followTerrain` picks the visible
   * terrain surface (for clicks/hover); without it the ground plane is used
   * (for stable camera math such as zoom-to-cursor and drag panning).
   */
  screenToWorld(
    cam: ScreenCamera,
    sx: number,
    sy: number,
    followTerrain: boolean,
  ): { x: number; y: number } {
    const v = this.view(cam);
    const hf = this.heights();
    const hit =
      followTerrain && hf
        ? rayToTerrain(
            v,
            sx,
            sy,
            (x, y) => this.elevation(x, y),
            this.settings.heightScale,
          )
        : rayToPlane(v, sx, sy, 0);
    return hit ?? { x: cam.centerX, y: cam.centerY };
  }

  /** Screen pixel of a world point, standing on the terrain surface. */
  worldToScreen(
    cam: ScreenCamera,
    x: number,
    y: number,
  ): { x: number; y: number } {
    const p = projectToScreen(this.view(cam), x, y, this.elevation(x, y));
    return { x: p.x, y: p.y };
  }

  /** World bounding box of the visible ground. */
  footprint(cam: ScreenCamera): Footprint {
    return groundFootprint(this.view(cam), 0);
  }
}
