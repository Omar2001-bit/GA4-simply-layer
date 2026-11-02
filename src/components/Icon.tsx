/** Optimizers brand icon set — stroke-only, 24x24, rounded caps/joins, per
 *  BRAND_IDENTITY.md §6 (PDF p.16). Color is inherited via currentColor so
 *  each call site keeps controlling color the same way it already did
 *  (text-* utility classes, inline style, delta-driven colors, etc.) —
 *  only the glyph shape changes to match the brand's icon style.
 *
 *  15 of these names mirror shapes shipped in the brand kit's
 *  assets/icons/*.svg 1:1. `chevron-left`, `chevron-right`, `lightbulb`,
 *  `drag-handle`, and `tray` have no brand-kit equivalent — they're
 *  extended to the same style spec per AGENTS.md ("extend the set to the
 *  same 24x24/stroke-only style, don't pull from an external icon library
 *  and call it on-brand"), not sourced from the kit itself. */

const PATHS: Record<string, React.ReactNode> = {
  plus: <path d="M12 5v14M5 12h14" />,
  "arrow-right": <path d="M4 12h16M13 5l7 7-7 7" />,
  "arrow-left": <path d="M20 12H4M11 5l-7 7 7 7" />,
  calendar: (
    <>
      <path d="M4 6h16v14H4z" />
      <path d="M4 10h16" />
      <path d="M8 3v5M16 3v5" />
    </>
  ),
  check: <path d="M4 12.5l5 5L20 6" />,
  trash: (
    <>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  warning: (
    <>
      <path d="M12 3l10 18H2L12 3z" />
      <path d="M12 10v4" />
      <circle cx="12" cy="17.3" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  filter: <path d="M4 5h16l-6 8v6l-4-2v-4L4 5z" />,
  "chevron-down": <path d="M6 9l6 6 6-6" />,
  "chevron-up": <path d="M6 15l6-6 6 6" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M20 20l-4.8-4.8" />
    </>
  ),
  "edit-pencil": (
    <>
      <path d="M4 20l1-4.5L15.5 5 19 8.5 8.5 19 4 20z" />
      <path d="M13 7l4 4" />
    </>
  ),
  "chart-growth": (
    <>
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M15 7h6v6" />
    </>
  ),

  // Extended beyond the brand kit's 40-icon set — same style spec, no source file.
  "chevron-left": <path d="M15 6l-6 6 6 6" />,
  "chevron-right": <path d="M9 6l6 6-6 6" />,
  lightbulb: (
    <>
      <path d="M12 3a6 6 0 0 0-3 11.2c.6.4 1 1.1 1 1.8v1h4v-1c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3z" />
      <path d="M10 20h4M10.5 22h3" />
    </>
  ),
  "drag-handle": (
    <>
      <circle cx="9" cy="6" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="18" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="6" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="18" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  tray: (
    <>
      <path d="M4 13l3-8h10l3 8" />
      <path d="M4 13v6h16v-6" />
      <path d="M4 13h5l1 2h4l1-2h5" />
    </>
  ),
};

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 16,
  className,
  style,
}: {
  name: IconName;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
