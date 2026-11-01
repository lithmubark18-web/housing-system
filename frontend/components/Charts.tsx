"use client";

import { useId, useMemo } from "react";
import { formatNumber, formatPercent } from "@/lib/format";

export type Slice = { label: string; value: number; color?: string };

const PALETTE = ["#1769e0", "#0f9d68", "#e6a700", "#dc3e55", "#7c5cff", "#0aa5c2", "#f0782a", "#5b6b7c"];

function colorOf(index: number, explicit?: string): string {
  return explicit || PALETTE[index % PALETTE.length];
}

/* --------------------------------- أشرطة أفقية -------------------------------- */

export function BarList({ data, max, valueSuffix }: { data: Slice[]; max?: number; valueSuffix?: string }) {
  const total = max ?? Math.max(...data.map((item) => item.value), 1);
  if (!data.length) return <div className="chart-empty">لا توجد بيانات لعرضها</div>;
  return (
    <div className="bar-list">
      {data.map((item, index) => (
        <div className="bar-row" key={`${item.label}-${index}`}>
          <span className="bar-label" title={item.label}>
            {item.label || "غير محدد"}
          </span>
          <div className="bar-track">
            <span
              className="bar-fill"
              style={{ width: `${Math.max(2, (item.value / total) * 100)}%`, background: colorOf(index, item.color) }}
            />
          </div>
          <strong className="bar-value">
            {formatNumber(item.value)}
            {valueSuffix || ""}
          </strong>
        </div>
      ))}
    </div>
  );
}

/* ----------------------------------- دائري ----------------------------------- */

export function DonutChart({
  data,
  size = 190,
  thickness = 22,
  centerLabel,
  centerValue,
}: {
  data: Slice[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string;
}) {
  const gradientId = useId();
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  const segments = useMemo(() => {
    return data.map((item, index) => {
      const fraction = total ? item.value / total : 0;
      const dash = fraction * circumference;
      const segment = {
        ...item,
        color: colorOf(index, item.color),
        dashArray: `${dash} ${circumference - dash}`,
        dashOffset: -offset,
        percent: fraction * 100,
      };
      offset += dash;
      return segment;
    });
  }, [data, total, circumference, offset]);

  return (
    <div className="donut-wrap">
      <svg viewBox={`0 0 ${size} ${size}`} className="donut" role="img" aria-label={centerLabel || "مخطط دائري"}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#eef2f7" />
            <stop offset="100%" stopColor="#f8fafc" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={`url(#${gradientId})`} strokeWidth={thickness} />
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {segments.map((segment, index) => (
            <circle
              key={`${segment.label}-${index}`}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={segment.color}
              strokeWidth={thickness}
              strokeDasharray={segment.dashArray}
              strokeDashoffset={segment.dashOffset}
              strokeLinecap="butt"
            />
          ))}
        </g>
        <text x="50%" y="47%" textAnchor="middle" className="donut-value">
          {centerValue ?? formatNumber(total)}
        </text>
        {centerLabel && (
          <text x="50%" y="60%" textAnchor="middle" className="donut-label">
            {centerLabel}
          </text>
        )}
      </svg>
      <ul className="donut-legend">
        {segments.map((segment, index) => (
          <li key={`${segment.label}-legend-${index}`}>
            <i style={{ background: segment.color }} />
            <span>{segment.label || "غير محدد"}</span>
            <strong>{formatNumber(segment.value)}</strong>
            <small>{formatPercent(segment.percent)}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------------------------------- خط بياني --------------------------------- */

export function AreaChart({
  points,
  height = 180,
  color = "#1769e0",
  label,
}: {
  points: Array<{ label: string; value: number }>;
  height?: number;
  color?: string;
  label?: string;
}) {
  const gradientId = useId();
  if (!points.length) return <div className="chart-empty">لا توجد بيانات لعرضها</div>;
  const width = Math.max(360, points.length * 58);
  const padding = { top: 16, right: 14, bottom: 28, left: 34 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(...points.map((point) => point.value), 1);
  const stepX = points.length > 1 ? chartWidth / (points.length - 1) : 0;

  const coords = points.map((point, index) => ({
    x: padding.left + index * stepX,
    y: padding.top + chartHeight - (point.value / maxValue) * chartHeight,
    ...point,
  }));

  const line = coords.map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`).join(" ");
  const area = `${line} L${coords[coords.length - 1].x},${padding.top + chartHeight} L${coords[0].x},${padding.top + chartHeight} Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="chart-scroll">
      <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg" role="img" aria-label={label || "مخطط خطي"}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.26" />
            <stop offset="100%" stopColor={color} stopOpacity="0.01" />
          </linearGradient>
        </defs>
        {ticks.map((tick) => {
          const y = padding.top + chartHeight - tick * chartHeight;
          return (
            <g key={tick}>
              <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="#e8eef5" strokeWidth="1" />
              <text x={padding.left - 8} y={y + 4} textAnchor="end" className="axis-label">
                {Math.round(maxValue * tick)}
              </text>
            </g>
          );
        })}
        <path d={area} fill={`url(#${gradientId})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {coords.map((point, index) => (
          <g key={`${point.label}-${index}`}>
            <circle cx={point.x} cy={point.y} r="4" fill="#fff" stroke={color} strokeWidth="2" />
            <text x={point.x} y={height - 8} textAnchor="middle" className="axis-label">
              {point.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

/* --------------------------------- أعمدة رأسية ------------------------------- */

export function StackedBars({
  rows,
  height = 220,
  legend,
}: {
  rows: Array<{ label: string; segments: Slice[] }>;
  height?: number;
  legend?: string[];
}) {
  if (!rows.length) return <div className="chart-empty">لا توجد بيانات لعرضها</div>;
  const totals = rows.map((row) => row.segments.reduce((sum, segment) => sum + segment.value, 0));
  const max = Math.max(...totals, 1);
  return (
    <div>
      <div className="stacked-chart" style={{ height }}>
        {rows.map((row, rowIndex) => {
          const total = totals[rowIndex];
          return (
            <div className="stacked-col" key={`${row.label}-${rowIndex}`} title={`${row.label}: ${total}`}>
              <div className="stacked-bar">
                {row.segments
                  .filter((segment) => segment.value > 0)
                  .map((segment, index) => (
                    <span
                      key={`${segment.label}-${index}`}
                      style={{
                        height: `${(segment.value / max) * 100}%`,
                        background: colorOf(index, segment.color),
                      }}
                      title={`${segment.label}: ${segment.value}`}
                    />
                  ))}
              </div>
              <small>{row.label}</small>
            </div>
          );
        })}
      </div>
      {legend && (
        <div className="chart-legend">
          {legend.map((item, index) => (
            <span key={item}>
              <i style={{ background: colorOf(index) }} />
              {item}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------- تقدم دائري ------------------------------- */

export function Gauge({ percent, label, size = 118 }: { percent: number; label?: string; size?: number }) {
  const clamped = Math.max(0, Math.min(100, percent || 0));
  const radius = (size - 14) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = (clamped / 100) * circumference;
  const color = clamped >= 95 ? "#dc3e55" : clamped >= 80 ? "#e6a700" : "#0f9d68";
  return (
    <div className="gauge">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={label || "نسبة"}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#eef2f7" strokeWidth="10" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text x="50%" y="52%" textAnchor="middle" className="gauge-value">
          {formatPercent(clamped)}
        </text>
      </svg>
      {label && <small>{label}</small>}
    </div>
  );
}
