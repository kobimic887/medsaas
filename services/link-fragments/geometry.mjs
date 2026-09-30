export const add = (a, b) => a.map((v, i) => v + b[i]);
export const sub = (a, b) => a.map((v, i) => v - b[i]);
export const scale = (a, s) => a.map((v) => v * s);
export const dot = (a, b) => a.reduce((v, x, i) => v + x * b[i], 0);
export const norm = (a) => Math.sqrt(dot(a, a));
export const unit = (a) => (norm(a) > 1e-9 ? scale(a, 1 / norm(a)) : null);
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const distance = (a, b) => norm(sub(a, b));
export const angle = (a, b) =>
  (Math.acos(Math.max(-1, Math.min(1, dot(unit(a), unit(b))))) * 180) / Math.PI;
export function rotateAround(v, axis, radians) {
  return add(
    add(scale(v, Math.cos(radians)), scale(cross(axis, v), Math.sin(radians))),
    scale(axis, dot(axis, v) * (1 - Math.cos(radians))),
  );
}
/** Proper rigid alignment of two points, with a deterministic torsion about their axis. */
export function twoAnchorTransform(source, target, torsion = 0) {
  const u = unit(sub(source[1], source[0])),
    v = unit(sub(target[1], target[0]));
  if (!u || !v) return null;
  const c = Math.max(-1, Math.min(1, dot(u, v)));
  let axis = unit(cross(u, v));
  if (!axis)
    axis = unit(cross(u, Math.abs(u[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0]));
  const radians = Math.acos(c),
    sm = scale(add(...source), 0.5),
    tm = scale(add(...target), 0.5);
  return (point) =>
    add(
      tm,
      rotateAround(rotateAround(sub(point, sm), axis, radians), v, torsion),
    );
}
