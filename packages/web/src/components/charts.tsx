/**
 * Charts.
 *
 * Hand-built SVG rather than a library, for three reasons: the palette had to be
 * validated against this exact background, every mark here needs a hover layer
 * and a table fallback, and a charting dependency would fight the design system
 * on every axis and gridline.
 *
 * Rules held throughout: one scale per chart and never two y-axes; thin marks
 * with a 2px surface gap between adjacent fills; recessive grid; a legend
 * whenever there is more than one series, with direct labels as well; and text
 * in text tokens rather than in the series colour.
 */

import { useState, type ReactNode } from 'react';
import { gbp, pct } from '../format';

export const SERIES = {
  specialty: 'var(--series-specialty)',
  commodity: 'var(--series-commodity)',
} as const;

export const SEQ = ['var(--seq-1)', 'var(--seq-2)', 'var(--seq-3)', 'var(--seq-4)', 'var(--seq-5)'];

export const STATUS_COLOUR: Record<string, string> = {
  good: 'var(--status-good)',
  warn: 'var(--status-warn)',
  critical: 'var(--status-critical)',
};

interface TooltipState {
  x: number;
  y: number;
  title: string;
  rows: Array<[string, string]>;
}

function Tooltip({ state, width }: { state: TooltipState | null; width: number }) {
  if (!state) return null;
  const flip = state.x > width * 0.6;
  return (
    <div
      className="tooltip"
      style={{
        left: flip ? undefined : `${state.x + 12}px`,
        right: flip ? `${width - state.x + 12}px` : undefined,
        top: `${state.y}px`,
      }}
    >
      <div className="t-title">{state.title}</div>
      {state.rows.map(([k, v]) => (
        <div className="t-row" key={k}>
          <span>{k}</span>
          <b>{v}</b>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Funnel                                                              */
/* ------------------------------------------------------------------ */

export interface FunnelBar {
  label: string;
  count: number;
  stepConversionBps: number | null;
  absoluteConversionBps: number | null;
  note: string;
}

/**
 * A funnel is a magnitude comparison down an ordered list, so it is a
 * horizontal bar chart, not a tapering trapezium. Every bar is directly
 * labelled, which is also the relief the sequential ramp needs.
 */
export function FunnelChart({ stages }: { stages: FunnelBar[] }) {
  const [tip, setTip] = useState<TooltipState | null>(null);
  const max = Math.max(1, ...stages.map((s) => s.count));
  const rowH = 34;
  const labelW = 108;
  const height = stages.length * rowH;
  const width = 620;
  const plotW = width - labelW - 60;

  if (stages.every((s) => s.count === 0)) {
    return (
      <div className="dim" style={{ fontSize: 13.5, padding: '10px 0' }}>
        No sessions recorded yet. Nothing has been sent to the intake endpoint, so this is an empty
        instrument rather than an empty funnel.
      </div>
    );
  }

  return (
    <div className="chart" onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Funnel by stage">
        {stages.map((s, i) => {
          const y = i * rowH;
          const w = Math.max(2, (s.count / max) * plotW);
          const colour = SEQ[Math.min(SEQ.length - 1, i)] ?? SEQ[0]!;
          return (
            <g
              key={s.label}
              onMouseMove={(e) => {
                const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                setTip({
                  x: ((e.clientX - box.left) / box.width) * width,
                  y: y + 4,
                  title: s.label,
                  rows: [
                    ['Sessions', String(s.count)],
                    ['From previous', s.stepConversionBps === null ? '—' : pct(s.stepConversionBps, 0)],
                    ['From arrival', s.absoluteConversionBps === null ? '—' : pct(s.absoluteConversionBps, 1)],
                  ],
                });
              }}
            >
              <rect x={0} y={y} width={width} height={rowH - 2} fill="transparent" />
              <text x={0} y={y + 17} className="axis" dominantBaseline="middle">
                {s.label}
              </text>
              <rect x={labelW} y={y + 5} width={w} height={rowH - 14} rx={4} fill={colour} />
              <text x={labelW + w + 8} y={y + 17} className="value" dominantBaseline="middle">
                {s.count}
                {s.stepConversionBps !== null && i > 0 && (
                  <tspan className="axis" dx="8">
                    {pct(s.stepConversionBps, 0)}
                  </tspan>
                )}
              </text>
            </g>
          );
        })}
      </svg>
      <Tooltip state={tip} width={width} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Mix: revenue against gross margin                                   */
/* ------------------------------------------------------------------ */

/**
 * Two stacked bars, one scale each expressed as a share of its own total, so
 * they can sit side by side without becoming a dual-axis chart. The whole point
 * of the picture is that the two bars do not look alike: commodity dominates
 * revenue and specialty dominates margin.
 */
export function MixBars({
  revenueShareBps,
  gmShareBps,
  targetBps,
}: {
  revenueShareBps: number;
  gmShareBps: number;
  targetBps: number;
}) {
  const [tip, setTip] = useState<TooltipState | null>(null);
  const width = 520;
  const barH = 30;
  const gap = 26;
  const labelW = 96;
  const plotW = width - labelW;
  const height = barH * 2 + gap + 26;

  const rows = [
    { label: 'Revenue', specialtyBps: revenueShareBps },
    { label: 'Gross margin', specialtyBps: gmShareBps },
  ];

  return (
    <div className="chart" onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Commodity and specialty share of revenue and gross margin">
        {rows.map((row, i) => {
          const y = i * (barH + gap);
          const specialtyW = (row.specialtyBps / 10_000) * plotW;
          const commodityW = plotW - specialtyW;
          const show = (label: string, bps: number) => (e: React.MouseEvent<SVGRectElement>) => {
            const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
            setTip({
              x: ((e.clientX - box.left) / box.width) * width,
              y,
              title: `${row.label}: ${label}`,
              rows: [['Share', pct(bps, 1)]],
            });
          };
          return (
            <g key={row.label}>
              <text x={0} y={y + barH / 2} className="axis" dominantBaseline="middle">
                {row.label}
              </text>
              {/* 2px surface gap between the two fills, per the mark spec. */}
              <rect
                x={labelW}
                y={y}
                width={Math.max(0, specialtyW - 1)}
                height={barH}
                rx={4}
                fill={SERIES.specialty}
                onMouseMove={show('specialty', row.specialtyBps)}
              />
              <rect
                x={labelW + specialtyW + 1}
                y={y}
                width={Math.max(0, commodityW - 1)}
                height={barH}
                rx={4}
                fill={SERIES.commodity}
                onMouseMove={show('commodity', 10_000 - row.specialtyBps)}
              />
              {specialtyW > 44 && (
                <text x={labelW + 9} y={y + barH / 2} className="value" dominantBaseline="middle">
                  {pct(row.specialtyBps, 0)}
                </text>
              )}
              {i === 1 && (
                <>
                  <line
                    x1={labelW + (targetBps / 10_000) * plotW}
                    x2={labelW + (targetBps / 10_000) * plotW}
                    y1={y - 7}
                    y2={y + barH + 7}
                    stroke="var(--lime)"
                    strokeWidth={1.5}
                    strokeDasharray="3 3"
                  />
                  <text
                    x={labelW + (targetBps / 10_000) * plotW}
                    y={y + barH + 20}
                    className="axis"
                    textAnchor="middle"
                  >
                    target {pct(targetBps, 0)}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>
      <div className="legend">
        <span className="legend-item">
          <span className="legend-swatch" style={{ background: SERIES.specialty }} /> Specialty
        </span>
        <span className="legend-item">
          <span className="legend-swatch" style={{ background: SERIES.commodity }} /> Commodity
        </span>
      </div>
      <Tooltip state={tip} width={width} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Scenario lines                                                      */
/* ------------------------------------------------------------------ */

/** Round a raw axis step up to 1, 2 or 5 times a power of ten. */
function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const normalised = raw / magnitude;
  const snapped = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return snapped * magnitude;
}

export interface ScenarioSeries {
  id: string;
  label: string;
  points: Array<{ month: number; commission: number }>;
}

/**
 * Three ordered scenarios, so a sequential ramp rather than categorical hues:
 * low, mid and high are the same quantity at three intensities, not three
 * different things.
 */
export function ScenarioChart({ series }: { series: ScenarioSeries[] }) {
  const [tip, setTip] = useState<TooltipState | null>(null);
  const width = 560;
  const height = 220;
  const pad = { top: 12, right: 74, bottom: 28, left: 52 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const maxY = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.commission)));
  // Round the axis up to a whole step so the gridline labels read as money
  // rather than as an arbitrary fraction of the largest value on the chart.
  const step = niceStep(maxY / 2);
  const axisTop = Math.max(step, Math.ceil(maxY / step) * step);
  const ticks = Array.from({ length: Math.round(axisTop / step) + 1 }, (_, i) => i * step);

  const months = series[0]?.points.length ?? 12;
  const x = (m: number) => pad.left + ((m - 1) / Math.max(1, months - 1)) * plotW;
  const y = (v: number) => pad.top + plotH - (v / axisTop) * plotH;
  const colours = [SEQ[1]!, SEQ[2]!, SEQ[4]!];

  return (
    <div className="chart" onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Monthly commission by scenario over twelve months">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={pad.left + plotW} y1={y(t)} y2={y(t)} className="grid-line" />
            <text x={pad.left - 8} y={y(t)} className="axis" textAnchor="end" dominantBaseline="middle">
              {gbp(t, true)}
            </text>
          </g>
        ))}
        {[1, 4, 8, 12].map((m) => (
          <text key={m} x={x(m)} y={height - 8} className="axis" textAnchor="middle">
            m{m}
          </text>
        ))}
        {series.map((s, i) => {
          const d = s.points.map((p, idx) => `${idx === 0 ? 'M' : 'L'}${x(p.month)},${y(p.commission)}`).join(' ');
          const last = s.points[s.points.length - 1]!;
          return (
            <g key={s.id}>
              <path d={d} fill="none" stroke={colours[i] ?? SEQ[2]} strokeWidth={2} strokeLinejoin="round" />
              {/* Direct label at the series end, so identity never depends on colour. */}
              <text x={x(last.month) + 8} y={y(last.commission)} className="value" dominantBaseline="middle">
                {s.label}
              </text>
            </g>
          );
        })}
        {Array.from({ length: months }, (_, i) => i + 1).map((m) => (
          <rect
            key={m}
            x={x(m) - plotW / months / 2}
            y={pad.top}
            width={plotW / months}
            height={plotH}
            fill="transparent"
            onMouseMove={(e) => {
              const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
              setTip({
                x: ((e.clientX - box.left) / box.width) * width,
                y: pad.top,
                title: `Month ${m}`,
                rows: series.map((s) => [
                  s.label,
                  gbp(s.points.find((p) => p.month === m)?.commission ?? 0),
                ]),
              });
            }}
          />
        ))}
      </svg>
      <Tooltip state={tip} width={width} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Concentration                                                       */
/* ------------------------------------------------------------------ */

/**
 * Share of gross margin by account, largest first. A single dominant bar is the
 * finding, so it gets the direct label and everything else stays quiet.
 */
export function ConcentrationChart({
  accounts,
}: {
  accounts: Array<{ accountName: string; grossMargin: number; shareBps: number; possibleDirectImporter: boolean }>;
}) {
  const [tip, setTip] = useState<TooltipState | null>(null);
  if (accounts.length === 0) return null;
  // This chart sits in a narrow column. A wide viewBox would scale the labels
  // down below legibility, so the geometry is sized close to its rendered width.
  const width = 340;
  const rowH = 26;
  const labelW = 120;
  const plotW = width - labelW - 48;
  const max = Math.max(...accounts.map((a) => a.shareBps));

  return (
    <div className="chart" onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${width} ${accounts.length * rowH}`} role="img" aria-label="Share of gross margin by account">
        {accounts.map((a, i) => {
          const y = i * rowH;
          const w = Math.max(2, (a.shareBps / max) * plotW);
          return (
            <g
              key={a.accountName}
              onMouseMove={(e) => {
                const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                setTip({
                  x: ((e.clientX - box.left) / box.width) * width,
                  y,
                  title: a.accountName,
                  rows: [
                    ['Gross margin', gbp(a.grossMargin)],
                    ['Share', pct(a.shareBps, 1)],
                    ...(a.possibleDirectImporter ? ([['Note', 'May import directly']] as Array<[string, string]>) : []),
                  ],
                });
              }}
            >
              <rect x={0} y={y} width={width} height={rowH} fill="transparent" />
              <text x={0} y={y + rowH / 2} className="axis" dominantBaseline="middle">
                {a.accountName.length > 17 ? `${a.accountName.slice(0, 16)}…` : a.accountName}
              </text>
              <rect
                x={labelW}
                y={y + 6}
                width={w}
                height={rowH - 14}
                rx={4}
                fill={a.shareBps >= 5000 ? 'var(--status-critical)' : SEQ[2]}
              />
              <text x={labelW + w + 8} y={y + rowH / 2} className="value" dominantBaseline="middle">
                {pct(a.shareBps, 0)}
              </text>
            </g>
          );
        })}
      </svg>
      <Tooltip state={tip} width={width} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Meter                                                               */
/* ------------------------------------------------------------------ */

export function Meter({
  valueBps,
  tone = 'good',
  label,
}: {
  valueBps: number;
  tone?: 'good' | 'warn' | 'critical';
  label?: ReactNode;
}) {
  const clamped = Math.max(0, Math.min(10_000, valueBps));
  return (
    <div>
      <div
        style={{
          height: 6,
          borderRadius: 999,
          background: 'rgba(244,239,226,0.1)',
          overflow: 'hidden',
        }}
        role="meter"
        aria-valuenow={Math.round(clamped / 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div style={{ width: `${clamped / 100}%`, height: '100%', background: STATUS_COLOUR[tone] }} />
      </div>
      {label && <div className="dim" style={{ fontSize: 11.5, marginTop: 5 }}>{label}</div>}
    </div>
  );
}
