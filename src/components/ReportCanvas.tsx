"use client";

import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Icon } from "./Icon";
import Link from "next/link";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { buildInsights } from "./AnalyticsView";
import type { GraphViewMode } from "./ChartView";
import DateControls from "./DateControls";
import EntryCard from "./EntryCard";
import FunnelView from "./FunnelView";
import MetricCarousel from "./MetricCarousel";
import ReportEditor from "./ReportEditor";
import SortableMetricCard from "./SortableMetricCard";
import SortableSection from "./SortableSection";
import { detectGranularity } from "@/lib/dates";
import { useMetricOverrides, useReport } from "@/lib/useReport";
import {
  blockKey,
  CHART_TYPES,
  configDimensions,
  entryKey,
  nextFloatId,
  reconcileLayout,
  reportFilters,
  segmentConditions,
  SECTION_TITLES,
  type ChartType,
  type EntryRef,
  type LayoutBlock,
  type MetadataResponse,
  type MetricDateOverride,
  type PropertySummary,
  type ReportConfig,
  type ReportLayout,
  type ReportResponse,
  type SectionId,
} from "@/lib/types";

interface Props {
  initial: ReportConfig;
  startEditing?: boolean; // client-share mode: never show edit affordances
  lockView?: boolean; // client-share mode: never show edit affordances
  isNew?: boolean; // builder flow: no delete button
  backHref?: string; // where the back button leads
}

const ZONE_PREFIX = "zone:";
const GAP_PREFIX = "gap:";
const GRAPH_ANCHOR_ID = "graph-view-anchor";

/** Section header that folds its content — count badge keeps the collapsed
 *  state informative ("Insights · 14") so clients know something's inside. */
function CollapsibleHeader({
  id,
  icon,
  title,
  count,
  collapsed,
  onToggle,
}: {
  id: SectionId;
  icon?: ReactNode;
  title: string;
  count: number;
  collapsed: boolean;
  onToggle: (id: SectionId) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(id)}
      aria-expanded={!collapsed}
      className={`focus-ring flex items-center gap-1.5 pr-8 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7f959d] transition-colors duration-150 hover:text-white ${
        collapsed ? "" : "mb-2"
      }`}
    >
      <Icon
        name="chevron-right"
        size={11}
        className="shrink-0 transition-transform duration-150"
        style={{ transform: collapsed ? "rotate(0deg)" : "rotate(90deg)" } as React.CSSProperties}
      />
      {icon}
      {title}
      {count > 0 && <span className="font-normal normal-case tracking-normal text-[#7f959d]">· {count}</span>}
    </button>
  );
}

/** Makes an otherwise-empty area of a card container a valid drop target,
 *  and tints it green while a card hovers over it. */
function DroppableZone({ id, children }: { id: string; children: ReactNode }) {
  const { setNodeRef, isOver, active } = useDroppable({ id, data: { type: "zone" } });
  const hot = isOver && active?.data.current?.type === "card";
  return (
    <div ref={setNodeRef} className={`rounded-xl ${hot ? "bg-[#6ae499]/10 ring-1 ring-[#6ae499]/40" : ""}`}>
      {children}
    </div>
  );
}

/** The slot between two top-level blocks. Only rendered while a card drag is
 *  in progress — dropping here pulls the card out of its container into a
 *  new free-floating group at this exact spot (e.g. above the graph). */
function GapZone({ index }: { index: number }) {
  const { setNodeRef, isOver, active } = useDroppable({ id: `${GAP_PREFIX}${index}`, data: { type: "gap" } });
  const hot = isOver && active?.data.current?.type === "card";
  return (
    <div
      ref={setNodeRef}
      className={`rounded-lg border border-dashed transition-all duration-100 ${
        hot ? "h-14 border-[#6ae499] bg-[#6ae499]/15" : "h-7 border-[#6ae499]/25 bg-[#6ae499]/[0.03]"
      }`}
      aria-label="Drop here to place the card between sections"
    />
  );
}

/** closestCenter alone is unreliable when huge section blocks and small
 *  metric cards share one DndContext — a corner grip handle on a tall
 *  section can be closer (by center distance) to an unrelated card than to
 *  any other section, silently resolving `over` to the wrong kind of thing.
 *  Filter candidates to the active item's own kind before running it. */
const collisionDetection: CollisionDetection = (args) => {
  const activeType = args.active.data.current?.type;
  const relevant = args.droppableContainers.filter((c) => {
    const t = c.data.current?.type;
    return activeType === "section" ? t === "section" : t === "card" || t === "zone" || t === "gap";
  });
  return closestCenter({ ...args, droppableContainers: relevant });
};

function swap<T>(arr: T[], i: number, j: number): T[] {
  const copy = [...arr];
  [copy[i], copy[j]] = [copy[j], copy[i]];
  return copy;
}

/** Which metric a card corresponds to, for click-to-jump — metric cards map
 *  directly; insight sentences map through their id prefix ("delta:sessions"
 *  → "sessions"); the cross-metric "fastest-mover" insight maps to nothing. */
function entryMetric(entry: EntryRef): string | null {
  if (entry.kind !== "insight") return entry.id;
  const i = entry.id.indexOf(":");
  return i === -1 ? null : entry.id.slice(i + 1);
}

type ActiveDrag = { kind: "section"; key: string; title: string } | { kind: "card"; entry: EntryRef };

export default function ReportCanvas({
  initial,
  startEditing = false,
  lockView = false,
  isNew = false,
  backHref = "/",
}: Props) {
  const router = useRouter();
  const [config, setConfig] = useState<ReportConfig>(initial);
  const [editing, setEditing] = useState(startEditing && !lockView);
  const [chartType, setChartType] = useState<ChartType>(initial.chartType);
  // keep the quick chart-type toggle in sync when the editor panel's own
  // chart-type dropdown changes config.chartType directly — adjusted during
  // render (React's documented pattern) instead of an effect, since an
  // effect here would setState synchronously and cascade an extra render.
  const [syncedChartType, setSyncedChartType] = useState(config.chartType);
  if (config.chartType !== syncedChartType) {
    setSyncedChartType(config.chartType);
    setChartType(config.chartType);
  }
  // Pie/donut can't represent a date-bucketed series (the data is a trend,
  // not a one-time composition) — hidden from the picker below, and if a
  // report was saved with one selected while its default breakdown is a
  // time series, fall back to a line chart instead of rendering nonsense.
  const isTimeSeriesDefault = detectGranularity(configDimensions(config)) !== null;
  if (isTimeSeriesDefault && (chartType === "pie" || chartType === "donut")) {
    setChartType("line");
  }
  // Every accordion section starts folded — a client opens what they want
  // the detail on, instead of scrolling past everything expanded by default.
  const [collapsed, setCollapsed] = useState<Partial<Record<SectionId, boolean>>>({
    numbers: true,
    insights: true,
    funnels: true,
  });
  const toggleCollapsed = (id: SectionId) => setCollapsed((c) => ({ ...c, [id]: !c[id] }));
  // "overlay": x-axis is the current period, previous drawn on top aligned.
  // "timeline": one chronological axis from previous-period start through
  // current-period end, dashed phase flowing into solid.
  const [graphView, setGraphView] = useState<GraphViewMode>("overlay");
  const [properties, setProperties] = useState<PropertySummary[]>([]);
  const [metadata, setMetadata] = useState<MetadataResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  // "Saved" flash next to the date controls — same timer pattern ReportEditor
  // uses for its own Save button, kept separate since this one lives outside
  // the editor panel and is visible even in plain view mode.
  const [showDateSaved, setShowDateSaved] = useState(false);
  useEffect(() => {
    if (!savedAt) return;
    setShowDateSaved(true);
    const t = setTimeout(() => setShowDateSaved(false), 4000);
    return () => clearTimeout(t);
  }, [savedAt]);
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);
  const [graphIndex, setGraphIndex] = useState(0);
  // a click event fires on the card right after a drop lands on it — this
  // flag eats that one so releasing a drag never also jumps the graph
  const suppressClick = useRef(false);
  // Numbers view still shows every selected metric side by side (unrelated to
  // how the graph section visualizes them), so it keeps the one full-config fetch.
  const { data, error, loading } = useReport(config);
  // one small single-metric fetch per metricDateOverrides entry — lets a KPI
  // tile/compare row for an overridden metric show ITS OWN dates' numbers
  // instead of the report's global range, same as its graph already does
  const overrideData = useMetricOverrides(config);
  const hasMetrics = config.metrics.length > 0;
  const insights = data ? buildInsights(data, metadata?.metrics, config.colorPeriods) : [];
  const insightsById = new Map(insights.map((i) => [i.id, i]));
  const layout = reconcileLayout(
    config.layout,
    config.metrics,
    insights.map((i) => i.id)
  );
  const draggable = !lockView;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    fetch("/api/properties")
      .then((r) => r.json())
      .then((j) => setProperties(j.properties ?? []))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!config.property) return;
    fetch(`/api/metadata?property=${config.property}`)
      .then((r) => r.json())
      .then((j) => setMetadata(j.dimensions ? j : null))
      .catch(() => {});
  }, [config.property]);

  const persist = async (next: ReportConfig) => {
    setSaving(true);
    try {
      const res = await fetch("/api/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (res.ok) setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  };

  const save = () => persist({ ...config, chartType });

  // Per-graph date override (MetricCarousel) — kept in config so it saves
  // via the same "Save dates" flow and every card for that metric, not just
  // its graph, can read it (see useMetricOverrides below). Deletes the key
  // entirely rather than storing undefined, matching how an object with no
  // entry for a metric is read (?? falls through to the report's own dates).
  const setMetricDateOverride = (metric: string, override: MetricDateOverride | undefined) => {
    setConfig((c) => {
      const next = { ...(c.metricDateOverrides ?? {}) };
      if (override) next[metric] = override;
      else delete next[metric];
      return { ...c, metricDateOverrides: next };
    });
  };

  // Date changes (report-level or per-graph override) autosave — same
  // "viewing choice, not a report-definition edit" logic as layout drags
  // below, so neither needs an explicit Save click. Debounced so typing a
  // multiplier or clicking through the calendar doesn't fire a write per
  // keystroke; skips the very first render so loading a report doesn't
  // immediately re-save it right back.
  const skipFirstAutosave = useRef(true);
  useEffect(() => {
    if (skipFirstAutosave.current) {
      skipFirstAutosave.current = false;
      return;
    }
    if (config.metrics.length === 0) return;
    const t = setTimeout(() => persist({ ...config, chartType }), 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(config.rangeA), JSON.stringify(config.rangeB), JSON.stringify(config.metricDateOverrides)]);

  // Layout changes (drag) persist immediately — rearranging is a viewing
  // preference, not a report-definition edit, so it shouldn't require
  // opening the editor panel and clicking Save first.
  const updateLayout = (next: ReportLayout) => {
    const nextConfig = { ...config, layout: next };
    setConfig(nextConfig);
    persist({ ...nextConfig, chartType });
  };

  const del = async () => {
    if (!confirm(`Delete report "${config.name}"?`)) return;
    await fetch(`/api/presets?id=${config.id}`, { method: "DELETE" });
    router.push("/");
  };

  const jumpToMetric = (entry: EntryRef) => {
    if (suppressClick.current) return;
    const metric = entryMetric(entry);
    if (!metric) return;
    const i = config.metrics.indexOf(metric);
    if (i === -1) return;
    setGraphIndex(i);
    document.getElementById(GRAPH_ANCHOR_ID)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  function onDragStart(event: DragStartEvent) {
    const t = event.active.data.current?.type;
    if (t === "section") {
      const key = String(event.active.id);
      const block = layout.blocks.find((b) => blockKey(b) === key);
      const title = block?.kind === "section" ? SECTION_TITLES[block.id] : "Card group";
      setActiveDrag({ kind: "section", key, title });
    } else if (t === "card") {
      setActiveDrag({ kind: "card", entry: event.active.data.current!.entry as EntryRef });
    }
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveDrag(null);
    suppressClick.current = true;
    setTimeout(() => (suppressClick.current = false), 0);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeType = active.data.current?.type;

    // Block reorder: dropping onto another block's slot swaps the two —
    // no shifting of the blocks in between.
    if (activeType === "section") {
      const keys = layout.blocks.map(blockKey);
      const oldIndex = keys.indexOf(String(active.id));
      const newIndex = keys.indexOf(String(over.id));
      if (oldIndex === -1 || newIndex === -1) return;
      updateLayout({ blocks: swap(layout.blocks, oldIndex, newIndex) });
      return;
    }

    if (activeType !== "card") return;
    const fromEntry = active.data.current?.entry as EntryRef | undefined;
    const fromContainer = active.data.current?.container as string | undefined;
    if (!fromEntry || !fromContainer) return;

    // deep-ish copy so block entry arrays can be mutated safely
    const blocks: LayoutBlock[] = layout.blocks.map((b) => (b.entries ? { ...b, entries: [...b.entries] } : { ...b }));
    const srcBlock = blocks.find((b) => blockKey(b) === fromContainer);
    if (!srcBlock?.entries) return;
    const srcIndex = srcBlock.entries.findIndex((e) => entryKey(e) === entryKey(fromEntry));
    if (srcIndex === -1) return;

    const finish = () => {
      updateLayout({ blocks: blocks.filter((b) => b.kind !== "float" || b.entries.length > 0) });
    };

    const overId = String(over.id);
    const overData = over.data.current;

    // dropped into the gap between two blocks → new floating group there
    if (overData?.type === "gap") {
      const gapIndex = Number(overId.slice(GAP_PREFIX.length));
      if (!Number.isFinite(gapIndex)) return;
      srcBlock.entries.splice(srcIndex, 1);
      blocks.splice(Math.max(0, Math.min(blocks.length, gapIndex)), 0, {
        kind: "float",
        id: nextFloatId(blocks),
        entries: [fromEntry],
      });
      finish();
      return;
    }

    // dropped on a container's empty area → append to that container
    if (overData?.type === "zone") {
      const destKey = overId.slice(ZONE_PREFIX.length);
      const destBlock = blocks.find((b) => blockKey(b) === destKey);
      if (!destBlock?.entries) return;
      if (destBlock === srcBlock) {
        srcBlock.entries.splice(srcIndex, 1);
        srcBlock.entries.push(fromEntry);
      } else {
        srcBlock.entries.splice(srcIndex, 1);
        if (!destBlock.entries.some((e) => entryKey(e) === entryKey(fromEntry))) destBlock.entries.push(fromEntry);
      }
      finish();
      return;
    }

    // dropped on another card → inserted at that position, shifting the rest
    // along — a true reorder, not a swap, so no other card gets displaced
    if (overData?.type === "card") {
      const overEntry = overData.entry as EntryRef;
      const overContainer = overData.container as string;
      const destBlock = blocks.find((b) => blockKey(b) === overContainer);
      if (!destBlock?.entries) return;
      const destIndex = destBlock.entries.findIndex((e) => entryKey(e) === entryKey(overEntry));
      if (destIndex === -1) return;
      if (destBlock === srcBlock) {
        if (destIndex === srcIndex) return;
        destBlock.entries = arrayMove(destBlock.entries, srcIndex, destIndex);
      } else {
        srcBlock.entries.splice(srcIndex, 1);
        if (!destBlock.entries.some((e) => entryKey(e) === entryKey(fromEntry))) {
          destBlock.entries.splice(destIndex, 0, fromEntry);
        }
      }
      finish();
    }
  }

  /** Any block's card list — entry sections and floating groups render
   *  through the same path: the container supplies the grid, each entry
   *  supplies its own content shape. */
  function renderEntries(reportData: ReportResponse, block: LayoutBlock, shape: "tile" | "row", containerClass: string) {
    const items = block.entries ?? [];
    const container = blockKey(block);
    return (
      <DroppableZone id={ZONE_PREFIX + container}>
        <SortableContext items={items.map(entryKey)} strategy={verticalListSortingStrategy}>
          <div className={containerClass}>
            {items.map((entry) => (
              <SortableMetricCard
                key={entryKey(entry)}
                id={entryKey(entry)}
                data={{ type: "card", container, entry }}
                draggable={draggable}
                onClick={() => jumpToMetric(entry)}
              >
                <EntryCard
                  entry={entry}
                  data={reportData}
                  overrideData={overrideData}
                  metricsMeta={metadata?.metrics}
                  insightsById={insightsById}
                  shape={entry.kind === "insight" ? "row" : shape}
                />
              </SortableMetricCard>
            ))}
          </div>
        </SortableContext>
      </DroppableZone>
    );
  }

  function renderSectionContent(block: LayoutBlock): ReactNode {
    if (block.kind === "float") {
      return data ? (
        renderEntries(data, block, "tile", "grid grid-cols-2 md:grid-cols-4 gap-3")
      ) : (
        <div className="h-24" />
      );
    }
    switch (block.id) {
      case "graph":
        return (
          <div id={GRAPH_ANCHOR_ID} className="scroll-mt-20">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 pr-8">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7f959d]">Graph view</h2>
              <div className="flex max-w-full flex-wrap items-center gap-2 overflow-x-auto">
                {config.rangeB.preset !== "none" && (
                  <div className="flex w-max overflow-hidden rounded-lg border border-white/10">
                    {(
                      [
                        { value: "overlay", label: "Overlay" },
                        { value: "timeline", label: "Timeline" },
                      ] as { value: GraphViewMode; label: string }[]
                    ).map((v) => (
                      <button
                        key={v.value}
                        type="button"
                        onClick={() => setGraphView(v.value)}
                        aria-pressed={graphView === v.value}
                        title={
                          v.value === "overlay"
                            ? "Current period on the x-axis, previous period drawn on top"
                            : "One continuous axis from the previous period into the current one"
                        }
                        className={`focus-ring whitespace-nowrap px-2.5 py-1.5 text-xs transition-colors duration-150 ${
                          graphView === v.value
                            ? "bg-[#6ae499] text-[#020202]"
                            : "text-[#7f959d] hover:bg-white/5 hover:text-[#c2d1d5]"
                        }`}
                      >
                        {v.label}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex w-max overflow-hidden rounded-lg border border-white/10">
                  {CHART_TYPES.filter(
                    (c) =>
                      c.value !== "table" &&
                      c.value !== "scorecard" &&
                      !(isTimeSeriesDefault && (c.value === "pie" || c.value === "donut"))
                  ).map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setChartType(c.value)}
                      aria-pressed={chartType === c.value}
                      className={`focus-ring whitespace-nowrap px-2.5 py-1.5 text-xs transition-colors duration-150 ${
                        chartType === c.value
                          ? "bg-[#6ae499] text-[#020202]"
                          : "text-[#7f959d] hover:bg-white/5 hover:text-[#c2d1d5]"
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <MetricCarousel
              metrics={config.metrics}
              property={config.property}
              rangeA={config.rangeA}
              rangeB={config.rangeB}
              filters={reportFilters(config)}
              limit={config.limit}
              chartType={chartType}
              viewMode={graphView}
              defaultDims={configDimensions(config)}
              colorPeriods={config.colorPeriods}
              metadata={metadata}
              metricsMeta={metadata?.metrics}
              activeIndex={graphIndex}
              onActiveIndexChange={setGraphIndex}
              metricDateOverrides={config.metricDateOverrides}
              onMetricDateOverrideChange={setMetricDateOverride}
              saving={saving}
              showDateSaved={showDateSaved}
            />
          </div>
        );
      case "numbers":
        return (
          <>
            <CollapsibleHeader
              id="numbers"
              title="Numbers view"
              count={block.entries?.length ?? 0}
              collapsed={!!collapsed.numbers}
              onToggle={toggleCollapsed}
            />
            {!collapsed.numbers && (
              <>
                {error ? (
                  <div className="flex h-24 items-center justify-center text-sm text-[#e66767]">{error}</div>
                ) : data ? (
                  (block.entries?.length ?? 0) === 0 ? (
                    <DroppableZone id={ZONE_PREFIX + blockKey(block)}>
                      <p className="rounded-xl px-1 py-3 text-xs text-[#7f959d]">Drag cards here.</p>
                    </DroppableZone>
                  ) : (
                    renderEntries(data, block, "tile", "grid grid-cols-2 md:grid-cols-4 gap-3")
                  )
                ) : (
                  <div className="h-24" />
                )}
                {loading && data && <p className="mt-2 text-center text-xs text-[#7f959d]">Refreshing…</p>}
              </>
            )}
          </>
        );
      case "insights":
        return (
          <>
            <CollapsibleHeader
              id="insights"
              icon={<Icon name="lightbulb" size={13} />}
              title="Insights"
              count={block.entries?.length ?? 0}
              collapsed={!!collapsed.insights}
              onToggle={toggleCollapsed}
            />
            {!collapsed.insights &&
              (data ? (
                (block.entries?.length ?? 0) === 0 ? (
                  <DroppableZone id={ZONE_PREFIX + blockKey(block)}>
                    <p className="rounded-xl px-1 py-3 text-xs text-[#7f959d]">
                      Nothing here — auto-written observations appear once you add a comparison period or a highlight
                      period, or drag a card in from another section.
                    </p>
                  </DroppableZone>
                ) : (
                  renderEntries(data, block, "row", "space-y-1.5")
                )
              ) : (
                <div className="h-24" />
              ))}
          </>
        );
      case "funnels":
        return (
          <>
            <CollapsibleHeader
              id="funnels"
              icon={<Icon name="filter" size={13} />}
              title="Funnels"
              count={config.funnels?.length ?? 0}
              collapsed={!!collapsed.funnels}
              onToggle={toggleCollapsed}
            />
            {!collapsed.funnels &&
              ((config.funnels?.length ?? 0) === 0 ? (
                <p className="text-xs text-[#7f959d]">
                  No funnels yet — define event steps in the editor and GA4&rsquo;s own funnel engine computes
                  who made it through each one.
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                  {config.funnels!.map((fn) => (
                    <FunnelView
                      key={fn.id}
                      property={config.property}
                      funnel={fn}
                      rangeA={config.rangeA}
                      rangeB={config.rangeB}
                      segment={segmentConditions(config.segment)}
                    />
                  ))}
                </div>
              ))}
          </>
        );
    }
  }

  const sectionBg = (block: LayoutBlock): string => {
    if (block.kind === "float") return "bg-[#020601]";
    return block.id === "numbers" ? "bg-[#020601]" : "bg-[#0e1c26]";
  };

  const showGaps = draggable && activeDrag?.kind === "card";

  return (
    <div className="animate-fade-in space-y-4">
      {/* header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {!lockView && (
            <Link
              href={backHref}
              aria-label="Back to dashboard"
              className="focus-ring flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 text-[#c2d1d5] transition-all duration-150 hover:border-[#6ae499]/50 hover:text-[#6ae499] active:scale-95"
            >
              <Icon name="arrow-left" size={16} />
            </Link>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-white">{config.name}</h1>
            {config.description && <p className="truncate text-sm text-[#7f959d]">{config.description}</p>}
            {segmentConditions(config.segment).length > 0 && (
              <p
                className="mt-1 inline-flex max-w-full items-center gap-1.5 truncate rounded-full border border-[#6ae499]/40 bg-[#6ae499]/10 px-2.5 py-0.5 text-xs text-[#6ae499]"
                title={segmentConditions(config.segment)
                  .map((c) => `${c.field} ${c.not ? "not " : ""}${c.match} "${c.value}"`)
                  .join(" AND ")}
              >
                <Icon name="filter" size={12} />
                Segment: {config.segment?.name || "Unnamed segment"}
              </p>
            )}
          </div>
        </div>
        {!lockView && (
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className={`focus-ring flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium transition-all duration-150 active:scale-[0.98] ${
              editing
                ? "bg-[#6ae499] text-[#020202] hover:bg-[#57cf86]"
                : "border border-white/10 text-[#c2d1d5] hover:border-white/25"
            }`}
          >
            <Icon name="edit-pencil" size={14} />
            {editing ? "Done, view mode" : "Edit report"}
          </button>
        )}
      </div>

      {/* date controls always live, even in view mode — relative+z-30 gives
          its own stacking context so the calendar popover always renders
          above the graph/chart section below it, regardless of DOM order */}
      <div className="relative z-30 rounded-2xl border border-white/10 bg-[#0e1c26] px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <DateControls
            rangeA={config.rangeA}
            rangeB={config.rangeB}
            onChange={(rangeA, rangeB) => setConfig((c) => ({ ...c, rangeA, rangeB }))}
          />
          {/* passive — date changes autosave (report-level and per-graph
              override alike), even in client-share (lockView) mode, so a
              client's date choice becomes the new default for anyone
              opening this same report link without any explicit save step */}
          <div className="flex shrink-0 items-center gap-1.5 text-xs" style={{ minHeight: "1.25rem" }}>
            {saving ? (
              <span className="text-[#7f959d]">Saving…</span>
            ) : (
              showDateSaved && (
                <span className="animate-pop-in flex items-center gap-1 font-medium text-[#6ae499]">
                  <Icon name="check" size={13} />
                  Saved
                </span>
              )
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row">
        {editing && (
          <ReportEditor
            config={config}
            onChange={setConfig}
            properties={properties}
            metadata={metadata}
            onSave={save}
            onDelete={isNew ? undefined : del}
            saving={saving}
            savedAt={savedAt}
          />
        )}

        <div className="min-w-0 flex-1 space-y-4">
          {!hasMetrics ? (
            /* blank slate: the report is an empty canvas waiting for its first metric */
            <section className="animate-rise-in flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/15 bg-[#0e1c26]/50 p-10 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#6ae499]/30 bg-[#6ae499]/10 text-[#6ae499]">
                <Icon name="plus" size={20} />
              </span>
              <p className="text-base font-medium text-white">Start with a metric</p>
              <p className="max-w-sm text-sm text-[#7f959d]">
                Pick one or more metrics{editing ? " in the panel" : " in the editor"}, then break them down by
                any dimension, event, or audience, and filter to exactly what you need.
              </p>
              {!editing && !lockView && (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="focus-ring mt-1 rounded-xl bg-[#6ae499] px-4 py-2 text-sm font-semibold text-[#020202] transition-all duration-150 hover:bg-[#57cf86] active:scale-[0.98]"
                >
                  Open editor
                </button>
              )}
            </section>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={collisionDetection}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDragCancel={() => setActiveDrag(null)}
            >
              <SortableContext items={layout.blocks.map(blockKey)} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                  {showGaps && <GapZone index={0} />}
                  {layout.blocks.map((block, i) => (
                    <div key={blockKey(block)} className="space-y-2">
                      <SortableSection id={blockKey(block)} draggable={draggable} className={sectionBg(block)}>
                        {renderSectionContent(block)}
                      </SortableSection>
                      {showGaps && <GapZone index={i + 1} />}
                    </div>
                  ))}
                </div>
              </SortableContext>
              <DragOverlay dropAnimation={{ duration: 150, easing: "ease-out" }}>
                {activeDrag?.kind === "section" && (
                  <div className="rounded-2xl border border-[#6ae499]/40 bg-[#0e1c26] px-4 py-3 text-sm font-semibold text-white shadow-2xl shadow-black/50">
                    {activeDrag.title}
                  </div>
                )}
                {activeDrag?.kind === "card" && data && (
                  <div className="rounded-xl shadow-2xl shadow-black/50">
                    <EntryCard
                      entry={activeDrag.entry}
                      data={data}
                      overrideData={overrideData}
                      metricsMeta={metadata?.metrics}
                      insightsById={insightsById}
                      shape={activeDrag.entry.kind === "kpi" ? "tile" : "row"}
                    />
                  </div>
                )}
              </DragOverlay>
            </DndContext>
          )}
        </div>
      </div>
    </div>
  );
}
