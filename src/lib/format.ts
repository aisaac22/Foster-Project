/** Formatting helpers. Postgres numeric/bigint come back as strings, so coerce. */

const toNum = (n: unknown): number | null => {
  if (n === null || n === undefined || n === "") return null;
  const v = typeof n === "number" ? n : Number(n);
  return Number.isNaN(v) ? null : v;
};

export const pct = (n: unknown): string => {
  const v = toNum(n);
  return v === null ? "—" : `${Math.round(v * 100)}%`;
};

export const num = (n: unknown): string => {
  const v = toNum(n);
  return v === null ? "—" : v.toLocaleString();
};

export const oneDp = (n: unknown): string => {
  const v = toNum(n);
  return v === null ? "—" : v.toFixed(1);
};

/** Bucket a 0-100 risk score into a label + color for the UI. */
export function riskLevel(score: unknown): { label: string; color: string } {
  const s = toNum(score) ?? 0;
  if (s >= 65) return { label: "High", color: "#b91c1c" };
  if (s >= 45) return { label: "Elevated", color: "#c2410c" };
  if (s >= 25) return { label: "Watch", color: "#a16207" };
  return { label: "Stable", color: "#15803d" };
}
