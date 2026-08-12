"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatMoneyCompact } from "@/lib/format/currency";

/**
 * Chart wrappers.
 *
 * Colours come from the CSS custom properties, read at render time, so charts
 * follow the light/dark theme instead of hardcoding hexes that go unreadable
 * in one of the two. Recharts needs concrete colour strings, so `var(--x)` is
 * passed through directly — supported for SVG fill/stroke in every target
 * browser.
 */

const AXIS = {
  stroke: "var(--text-light)",
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

const GRID = "var(--border)";

function TooltipBox({
  active,
  payload,
  label,
  formatter,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number | string; color?: string }[];
  label?: string;
  formatter?: (value: number) => string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 shadow-md">
      {label && <p className="text-xs font-semibold text-text">{label}</p>}
      {payload.map((entry, i) => (
        <p key={i} className="tnum mt-0.5 text-xs text-text-secondary">
          <span
            aria-hidden
            className="mr-1.5 inline-block size-2 rounded-full align-middle"
            style={{ background: entry.color }}
          />
          {entry.name} :{" "}
          <span className="font-semibold text-text">
            {formatter && typeof entry.value === "number"
              ? formatter(entry.value)
              : String(entry.value)}
          </span>
        </p>
      ))}
    </div>
  );
}

export function SalesLineChart({
  data,
  xKey,
  yKey,
  label,
}: {
  data: Record<string, string | number>[];
  xKey: string;
  yKey: string;
  label: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey={xKey} {...AXIS} />
        <YAxis {...AXIS} tickFormatter={(v: number) => formatMoneyCompact(v, "XAF").split(" ")[0]} />
        <Tooltip content={<TooltipBox formatter={(v) => formatMoneyCompact(v)} />} />
        <Line
          type="monotone"
          dataKey={yKey}
          name={label}
          stroke="var(--primary)"
          strokeWidth={2.5}
          dot={{ r: 3, fill: "var(--primary)" }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function VolumeBarChart({
  data,
  xKey,
  yKey,
  label,
  money = false,
}: {
  data: Record<string, string | number>[];
  xKey: string;
  yKey: string;
  label: string;
  money?: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey={xKey} {...AXIS} />
        <YAxis {...AXIS} />
        <Tooltip
          cursor={{ fill: "var(--surface-2)" }}
          content={
            <TooltipBox formatter={money ? (v) => formatMoneyCompact(v) : undefined} />
          }
        />
        <Bar dataKey={yKey} name={label} fill="var(--primary)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * Categorical colours. Six hues drawn from the palette rather than a rainbow —
 * the point is to tell three or four slices apart, not to be maximally varied.
 */
const SLICE_COLOURS = [
  "var(--primary)",
  "var(--accent)",
  "var(--info)",
  "var(--success)",
  "var(--warning)",
  "var(--text-light)",
];

export function MixPieChart({
  data,
  nameKey,
  valueKey,
}: {
  data: Record<string, string | number>[];
  nameKey: string;
  valueKey: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-6">
      <div className="min-w-[180px] flex-1">
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Pie
              data={data}
              dataKey={valueKey}
              nameKey={nameKey}
              innerRadius={50}
              outerRadius={80}
              paddingAngle={2}
              stroke="var(--surface)"
              strokeWidth={2}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={SLICE_COLOURS[i % SLICE_COLOURS.length]} />
              ))}
            </Pie>
            <Tooltip content={<TooltipBox formatter={(v) => `${v} %`} />} />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Legend as text — a colour-only key is unreadable for anyone with a
          colour vision deficiency. */}
      <ul className="flex flex-col gap-2">
        {data.map((entry, i) => (
          <li key={i} className="flex items-center gap-2 text-sm">
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: SLICE_COLOURS[i % SLICE_COLOURS.length] }}
            />
            <span className="text-text-secondary">{entry[nameKey]}</span>
            <span className="tnum ml-auto font-semibold">{entry[valueKey]} %</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
