/**
 * Tiny, dependency-free geometry for the Overview's hand-built SVG charts —
 * a linear scale, a monotone curve and a "nice" domain. Pulling in d3 for
 * these three functions would cost more than it saves; everything here is
 * pure and deterministic (rounded to 2dp) so server and client renders can
 * never disagree in the last float digit.
 */

export const r2 = (n: number) => Math.round(n * 100) / 100;

export function linearScale(d0: number, d1: number, r0: number, r1: number) {
  const span = d1 - d0 || 1;
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0);
}

/** Domain padded around the data and snapped to `step`, clamped to
 *  [floor, ceil] — so a score series that moves 52 -> 58 isn't drawn as a
 *  flat line on a 0-100 axis, but also never runs past the scale's real
 *  bounds. */
export function niceDomain(
  values: number[],
  { step = 10, floor = -Infinity, ceil = Infinity, minSpan }: { step?: number; floor?: number; ceil?: number; minSpan?: number } = {},
): [number, number] {
  minSpan ??= step * 2;
  if (values.length === 0) return [Math.max(0, floor), Math.min(100, ceil)];
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const pad = Math.max((hi - lo) * 0.25, step / 2);
  lo = Math.floor((lo - pad) / step) * step;
  hi = Math.ceil((hi + pad) / step) * step;
  if (hi - lo < minSpan) {
    const mid = (hi + lo) / 2;
    lo = Math.floor((mid - minSpan / 2) / step) * step;
    hi = lo + minSpan;
  }
  return [Math.max(lo, floor), Math.min(hi, ceil)];
}

export function ticks(lo: number, hi: number, count = 4): number[] {
  const out: number[] = [];
  for (let i = 0; i <= count; i++) out.push(r2(lo + ((hi - lo) * i) / count));
  return out;
}

/**
 * Monotone cubic interpolation (Fritsch–Carlson) as an SVG path. Smooth
 * like a spline, but never overshoots between points — a curve that dips
 * below the lowest real score would draw a value that never happened.
 */
export function monotonePath(pts: [number, number][]): string {
  const n = pts.length;
  if (n === 0) return "";
  if (n === 1) return `M${r2(pts[0]![0])} ${r2(pts[0]![1])}`;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const h = pts[i + 1]![0] - pts[i]![0] || 1e-6;
    dx.push(h);
    slope.push((pts[i + 1]![1] - pts[i]![1]) / h);
  }
  const m: number[] = [slope[0]!];
  for (let i = 1; i < n - 1; i++) {
    const a = slope[i - 1]!;
    const b = slope[i]!;
    m.push(a * b <= 0 ? 0 : (3 * (dx[i - 1]! + dx[i]!)) / ((2 * dx[i]! + dx[i - 1]!) / a + (dx[i]! + 2 * dx[i - 1]!) / b));
  }
  m.push(slope[n - 2]!);

  let d = `M${r2(pts[0]![0])} ${r2(pts[0]![1])}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i]!;
    const [x1, y1] = pts[i + 1]!;
    const h = dx[i]! / 3;
    d += ` C${r2(x0 + h)} ${r2(y0 + m[i]! * h)}, ${r2(x1 - h)} ${r2(y1 - m[i + 1]! * h)}, ${r2(x1)} ${r2(y1)}`;
  }
  return d;
}

/** Point on a circle, angle in degrees clockwise from 12 o'clock. */
export function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [r2(cx + Math.cos(a) * r), r2(cy + Math.sin(a) * r)];
}

export const SHORT_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
