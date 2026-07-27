"use client";

import { useEffect, useRef, useState } from "react";

interface MonthlyRow {
  month: string;
  homes_licensed: number;
  homes_exited: number;
  homes_active_eom: number;
}

/**
 * Fixed categorical order/hues (validated: node scripts/validate_palette.js
 * "#2a78d6,#eb6834,#1baf7a" --mode light — all-pairs safe for exactly 3
 * series). Identity, not sentiment — a status palette would be the wrong
 * tool for "which count is which," even though one of these is a loss metric.
 */
const SERIES = [
  { key: "homes_active_eom" as const, label: "Active homes", color: "#2a78d6" },
  { key: "homes_licensed" as const, label: "New licenses", color: "#eb6834" },
  { key: "homes_exited" as const, label: "Exits", color: "#1baf7a" },
];

const MARGIN = { top: 20, right: 24, bottom: 36, left: 56 };
const HEIGHT = 340;
const MIN_LABEL_GAP = 14;

function niceScale(maxValue: number): { max: number; step: number } {
  const rough = Math.max(maxValue, 1) / 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / magnitude;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * magnitude;
  return { max: Math.ceil(maxValue / step) * step, step };
}

const fmtMonth = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
const fmtMonthFull = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "long", year: "numeric" });

export function TrendChart({ data }: { data: MonthlyRow[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const plotW = Math.max(width - MARGIN.left - MARGIN.right, 100);
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const n = data.length;

  const maxVal = data.reduce(
    (m, d) => Math.max(m, d.homes_active_eom, d.homes_licensed, d.homes_exited),
    0,
  );
  const { max: yMax, step: yStep } = niceScale(maxVal);
  const yTicks: number[] = [];
  for (let v = 0; v <= yMax; v += yStep) yTicks.push(v);

  const xPos = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * plotW);
  const yPos = (v: number) => plotH - (v / yMax) * plotH;

  const pathFor = (key: (typeof SERIES)[number]["key"]) =>
    data.map((d, i) => `${i === 0 ? "M" : "L"} ${xPos(i).toFixed(1)} ${yPos(d[key]).toFixed(1)}`).join(" ");

  // End-of-line direct labels: nudge apart if two series land within
  // MIN_LABEL_GAP px of each other so they don't overlap.
  const last = data[n - 1];
  const endLabels = last
    ? SERIES.map((s) => ({ ...s, value: last[s.key], y: yPos(last[s.key]) }))
        .sort((a, b) => a.y - b.y)
        .reduce<{ key: string; label: string; color: string; value: number; y: number }[]>(
          (acc, cur) => {
            const prev = acc[acc.length - 1];
            const y = prev && cur.y - prev.y < MIN_LABEL_GAP ? prev.y + MIN_LABEL_GAP : cur.y;
            acc.push({ ...cur, y });
            return acc;
          },
          [],
        )
    : [];

  const labelEvery = Math.max(1, Math.round(n / 8));

  function handlePointerMove(e: React.PointerEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const idx = Math.round((relX / plotW) * (n - 1));
    setHoverIdx(Math.min(n - 1, Math.max(0, idx)));
  }

  const hovered = hoverIdx !== null ? data[hoverIdx] : null;
  const crosshairX = hoverIdx !== null ? xPos(hoverIdx) : 0;
  const tooltipOnLeft = crosshairX > plotW - 170;

  return (
    <div className="chart-card">
      <div className="chart-legend">
        {SERIES.map((s) => (
          <span key={s.key} className="chart-legend-item">
            <span className="chart-legend-key" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <div ref={containerRef} style={{ position: "relative" }}>
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label="Monthly active homes, new licenses, and exits over time"
        >
          <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
            {yTicks.map((v) => (
              <g key={v}>
                <line x1={0} x2={plotW} y1={yPos(v)} y2={yPos(v)} className="chart-gridline" />
                <text x={-10} y={yPos(v)} textAnchor="end" dominantBaseline="middle" className="chart-axis-label">
                  {v.toLocaleString()}
                </text>
              </g>
            ))}

            {data.map((d, i) =>
              i % labelEvery === 0 ? (
                <text
                  key={d.month}
                  x={xPos(i)}
                  y={plotH + 22}
                  textAnchor="middle"
                  className="chart-axis-label"
                >
                  {fmtMonth(d.month)}
                </text>
              ) : null,
            )}

            {SERIES.map((s) => (
              <path
                key={s.key}
                d={pathFor(s.key)}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}

            {last &&
              SERIES.map((s) => (
                <circle
                  key={s.key}
                  cx={xPos(n - 1)}
                  cy={yPos(last[s.key])}
                  r={4}
                  fill={s.color}
                  stroke="#fff"
                  strokeWidth={2}
                />
              ))}
            {endLabels.map((s) => (
              <text
                key={s.key}
                x={xPos(n - 1) + 10}
                y={s.y}
                dominantBaseline="middle"
                className="chart-end-label"
              >
                {s.value.toLocaleString()}
              </text>
            ))}

            {hoverIdx !== null && (
              <line x1={crosshairX} x2={crosshairX} y1={0} y2={plotH} className="chart-crosshair" />
            )}

            <rect
              x={0}
              y={0}
              width={plotW}
              height={plotH}
              fill="transparent"
              onPointerMove={handlePointerMove}
              onPointerLeave={() => setHoverIdx(null)}
            />
          </g>
        </svg>

        {hovered && (
          <div
            className="chart-tooltip"
            style={{
              left: MARGIN.left + crosshairX + (tooltipOnLeft ? -170 : 14),
              top: MARGIN.top + 4,
            }}
          >
            <div className="chart-tooltip-header">{fmtMonthFull(hovered.month)}</div>
            {SERIES.map((s) => (
              <div key={s.key} className="chart-tooltip-row">
                <span className="chart-tooltip-key" style={{ background: s.color }} />
                <span className="chart-tooltip-value">{hovered[s.key].toLocaleString()}</span>
                <span className="chart-tooltip-label">{s.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
