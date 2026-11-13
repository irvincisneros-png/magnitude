/**
 * The person's pose in the scene: the constants of the baked figure (figure2/, mirrored from
 * public/assets/human/figure/figure.json and checked against it when the figure loads) and how the
 * figure is turned to stand on the Woonona foreshore. Pure maths, no Three.js.
 *
 * Frames: object units (1 unit = 1.7 m, origin = the skin point on the back of the right hand,
 * which rests on top of the sun hat) and "H metres" (the same origin and axes, in metres, after the
 * figure is turned by FIG_YAW about the vertical through the origin).
 */
export type V3 = [number, number, number];

export const UNIT = 1.7;

/** From figure.json: ground plane, feet [cx, cz, dx, dz] (L, R), anchor tangents and gaze, object units. */
export const FIG = {
  groundY: -1.04555,
  feet: [0.11553, 0.02314, 0.22349, 0.97471, -0.14916, 0.07798, -0.32415, 0.94601],
  tangentFingers: [0.86451, -0.00014, 0.50262] as V3,
  tangentAcross: [0.50262, -0.00161, -0.86451] as V3,
  gaze: [-0.24135, -0.02097, 0.97021] as V3,
};

/**
 * The figure looks along Woonona Beach towards the surf club and the rock pool (bearing ≈ 12°, just
 * east of north); the default camera (bearing 340°, from the south-south-east) then sees them
 * three-quarter from behind, right arm and hat towards the camera. Three.js rotation.y: an object
 * direction at angle atan2(x, z) turns to angle + yaw.
 */
const GAZE_BEARING = (12 * Math.PI) / 180;
export const FIG_YAW = Math.PI - GAZE_BEARING - Math.atan2(FIG.gaze[0], FIG.gaze[2]);
const C = Math.cos(FIG_YAW), S = Math.sin(FIG_YAW);
/** Object → H frame direction (rotation about +Y by FIG_YAW, Three.js convention). */
export const rotY = (v: V3): V3 => [v[0] * C + v[2] * S, v[1], -v[0] * S + v[2] * C];

/** Feet in H metres [cx, cz, dx, dz] × 2 (for contact shadows and keeping grass off the shoes). */
export const FEET_M = (() => {
  const out: number[] = [];
  for (let i = 0; i < 2; i++) {
    const c = rotY([FIG.feet[i * 4] * UNIT, 0, FIG.feet[i * 4 + 1] * UNIT]);
    const d = rotY([FIG.feet[i * 4 + 2], 0, FIG.feet[i * 4 + 3]]);
    out.push(c[0], c[2], d[0], d[2]);
  }
  return out;
})();
/** The standing spot (between the feet, on the ground) in H metres: the map origin of site.ts. */
export const FEET_H: V3 = [(FEET_M[0] + FEET_M[4]) / 2, FIG.groundY * UNIT, (FEET_M[1] + FEET_M[5]) / 2];

/**
 * Hand frame for the skin close-up: x along the fingers (rotated to the principal axis of the
 * fitted skin curvature, ≈ −5.6°), y the skin normal (+Y), z across the knuckles (sign chosen so
 * the frame is right-handed). Columns, H frame.
 */
export const HAND_FRAME = (() => {
  const a = (-5.6 * Math.PI) / 180;
  const tf = FIG.tangentFingers, ta: V3 = [-FIG.tangentAcross[0], -FIG.tangentAcross[1], -FIG.tangentAcross[2]];
  const x: V3 = [tf[0] * Math.cos(a) + ta[0] * Math.sin(a), 0, tf[2] * Math.cos(a) + ta[2] * Math.sin(a)];
  const lx = Math.hypot(x[0], x[2]); x[0] /= lx; x[2] /= lx;
  const zz: V3 = [-x[2], 0, x[0]]; // z = x × y (right-handed; = −tangentAcross)
  return { x: rotY(x), y: [0, 1, 0] as V3, z: rotY(zz) };
})();

/**
 * Skin surface around the anchor as an ellipsoid (semi-axes along the fingers, thickness, across):
 * matches the fitted radii of curvature (≈ 0.63–0.69 m along the fingers, ≈ 0.061 m across).
 */
export const PALM: V3 = [0.096, 0.0135, 0.0286];
/** Follicle grid spacing on the back of the hand (metres). Must match FOLLICLE in the skin GLSL. */
export const FOLLICLE = 0.0021;
