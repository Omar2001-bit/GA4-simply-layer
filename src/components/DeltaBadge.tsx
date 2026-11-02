"use client";

import { Icon } from "./Icon";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { explainDelta } from "@/lib/deltaExplain";
import { fmtDelta } from "@/lib/format";
import { DELTA_DOWN, DELTA_UP, INK_MUTED, INK_SECONDARY } from "@/lib/theme";

interface Props {
  value: number | null;
  /** `invert` flips the good/bad coloring for metrics where more is worse
   *  (cart removals, refunds…): an increase reads red, a decrease green. The
   *  arrow still follows the sign — only the judgment color inverts. */
  invert?: boolean;
  /** GA4 metric apiName this delta belongs to — when set, hovering (or
   *  tapping, for touch) opens a tooltip explaining what the metric/event
   *  is, what triggers it, and why this direction reads as good or bad. */
  apiName?: string;
  /** Raw previous-period value this delta was computed from — lets the
   *  tooltip flag a huge swing off a near-zero base as noise rather than a
   *  real trend (e.g. 8 -> 319 reading as "explosive growth"). */
  prevValue?: number;
}

/** The shared up/down badge for every card that shows a period-over-period
 *  change (KPI tiles, compare rows, the numbers table, scorecards, carousel
 *  headlines, dashboard preview cards). When `apiName` is supplied, hovering
 *  it opens a tooltip: what the metric/event is, what specifically triggers
 *  it, why the observed direction reads as good or bad (matching the badge's
 *  own color), and the honest flip side of that same direction.
 *
 *  The tooltip renders through a portal into document.body at a fixed
 *  position computed from the trigger's own bounding rect — not nested
 *  absolutely inside the badge. Several places this renders (the day-by-day
 *  breakdown table in particular) sit inside an `overflow-x-auto` ancestor
 *  needed for horizontal scrolling, which clips an absolutely-positioned
 *  child regardless of z-index. A portal escapes that clipping entirely,
 *  and rendering at the very end of body guarantees it paints above
 *  everything else on the page. */
export function Delta({ value, invert, apiName, prevValue }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ bottom: number; right: number } | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);

  const updatePos = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // anchors the tooltip's bottom-right corner to the trigger's top-right —
    // same visual relationship the old absolute bottom-full/right-0 gave,
    // just computed in viewport coordinates instead of a local offset
    setPos({ bottom: window.innerHeight - r.top + 6, right: window.innerWidth - r.right });
  };

  useEffect(() => {
    if (!open) return;
    updatePos();
    window.addEventListener("scroll", updatePos, true);
    window.addEventListener("resize", updatePos);
    return () => {
      window.removeEventListener("scroll", updatePos, true);
      window.removeEventListener("resize", updatePos);
    };
  }, [open]);

  if (value === null) return <span className="text-[#7f959d]">–</span>;
  const good = invert ? value < 0 : value > 0;
  const color = value === 0 ? DELTA_UP : good ? DELTA_UP : DELTA_DOWN;

  const badge = (
    <span style={{ color }} className="inline-flex items-center gap-0.5 font-medium tabular-nums">
      {value !== 0 &&
        (value > 0 ? <Icon name="chevron-up" size={10} /> : <Icon name="chevron-down" size={10} />)}
      {fmtDelta(value)}
    </span>
  );

  if (!apiName) return badge;
  const explanation = explainDelta(apiName, value, prevValue);

  return (
    <span
      ref={triggerRef}
      tabIndex={0}
      className="inline-flex cursor-help outline-none"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOpen((v) => !v);
      }}
    >
      {badge}
      {open &&
        pos &&
        createPortal(
          <span
            role="tooltip"
            style={{ position: "fixed", bottom: pos.bottom, right: pos.right }}
            className="animate-pop-in pointer-events-none z-[9999] w-72 max-w-[calc(100vw-2rem)] origin-bottom-right rounded-lg border border-white/10 bg-[#0e1c26] p-3 text-left text-xs font-normal normal-case tracking-normal shadow-2xl shadow-black/40"
          >
            <span className="mb-1.5 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
              <span className="font-semibold text-white">
                {value === 0 ? "No change" : good ? "Good change" : "Worth a look"}
              </span>
            </span>

            <span className="block leading-snug" style={{ color: INK_SECONDARY }}>
              {explanation.what}
            </span>
            <span className="mt-1 block text-[11px] leading-snug" style={{ color: INK_MUTED }}>
              <span className="font-semibold" style={{ color: INK_SECONDARY }}>
                Fires when:{" "}
              </span>
              {explanation.trigger}
            </span>

            <span className="mt-2 flex items-start gap-1.5 border-t border-white/10 pt-2">
              <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
              <span className="leading-snug text-white">{explanation.primary}</span>
            </span>
            <span className="mt-1.5 block pl-3.5 text-[11px] leading-snug" style={{ color: INK_MUTED }}>
              <span className="font-semibold" style={{ color: INK_SECONDARY }}>
                Also worth knowing:{" "}
              </span>
              {explanation.caveat}
            </span>
          </span>,
          document.body
        )}
    </span>
  );
}
