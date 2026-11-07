"use client";
// Single-series projected balance with a dashed buffer reference line.
// One series, so the card title names it and the buffer line is labelled directly.
import { useState } from "react";

export interface Point { date: string; label: string; value: number }

const fmt = (minor: number) => Math.round(minor / 100).toLocaleString("en-US");
const compact = (minor: number) => {
  const v = minor / 100;
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}m`;
  if (Math.abs(v) >= 1_000) return `${Math.round(v / 1_000)}k`;
  return `${Math.round(v)}`;
};

export function ForecastChart({ points, buffer, currency }: { points: Point[]; buffer: number; currency: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 680, H = 210, L = 44, R = 12, T = 14, B = 28;
  const values = points.map((p) => p.value);
  const max = Math.max(...values, buffer) * 1.08 || 1;
  const min = Math.min(0, ...values);
  const x = (i: number) => L + (i * (W - L - R)) / Math.max(1, points.length - 1);
  const y = (v: number) => T + ((max - v) * (H - T - B)) / (max - min || 1);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const ticks = [0, 0.5, 1].map((f) => min + (max - min) * f);
  const labelEvery = Math.ceil(points.length / 5);

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        tabIndex={0}
        aria-label={`Projected balance over ${points.length} days. Use the left and right arrow keys to read each day.`}
        onMouseLeave={() => setHover(null)}
        onBlur={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
            e.preventDefault();
            const step = e.key === "ArrowRight" ? 1 : -1;
            setHover((h) => Math.max(0, Math.min(points.length - 1, (h ?? (step > 0 ? -1 : points.length)) + step)));
          }
        }}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          const i = Math.round(((px - L) / (W - L - R)) * (points.length - 1));
          setHover(Math.max(0, Math.min(points.length - 1, i)));
        }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="stroke-line" />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" className="fill-faint font-mono text-[10px]">{compact(t)}</text>
          </g>
        ))}
        <line x1={L} x2={W - R} y1={y(buffer)} y2={y(buffer)} className="stroke-amber-dot" strokeDasharray="4 4" strokeWidth={1.25} />
        <text x={W - R} y={y(buffer) - 6} textAnchor="end" className="fill-amber text-[11px]">Buffer</text>
        <path d={`${path} L${x(points.length - 1)},${y(min)} L${x(0)},${y(min)} Z`} fillOpacity={0.08} className="animate-fade fill-teal" style={{ animationDelay: "500ms" }} />
        <path d={path} fill="none" strokeWidth={2} strokeLinejoin="round" pathLength={1} className="animate-draw stroke-teal" style={{ strokeDasharray: 1, ["--len" as string]: 1 }} />
        {points.map((p, i) =>
          (i % labelEvery === 0 && points.length - 1 - i >= labelEvery / 2) || i === points.length - 1 ? (
            <text key={p.date} x={x(i)} y={H - 8} textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"} className="fill-muted text-[11px]">
              {p.label}
            </text>
          ) : null,
        )}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="stroke-strong" strokeWidth={1} />
            <circle cx={x(hover)} cy={y(points[hover].value)} r={4.5} className="fill-teal stroke-surface" strokeWidth={2} />
          </g>
        )}
      </svg>
      {hover !== null && (
        <div
          aria-hidden
          className="animate-pop pointer-events-none absolute top-0 rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-md"
          style={{ left: `${(x(hover) / W) * 100}%`, transform: hover > points.length / 2 ? "translateX(calc(-100% - 10px))" : "translateX(10px)" }}
        >
          <div className="text-muted">{points[hover].label}</div>
          <div className="num font-medium text-ink">{currency} {fmt(points[hover].value)}</div>
        </div>
      )}
      <div aria-live="polite" className="sr-only">{hover !== null ? `${points[hover].label}: ${currency} ${fmt(points[hover].value)}` : ""}</div>
      <table className="sr-only">
        <caption>Projected balance by day</caption>
        <thead><tr><th scope="col">Day</th><th scope="col">Balance ({currency})</th></tr></thead>
        <tbody>{points.map((p) => <tr key={p.date}><td>{p.label}</td><td>{fmt(p.value)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
