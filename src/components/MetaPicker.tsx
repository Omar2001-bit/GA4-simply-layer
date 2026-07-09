"use client";

import { useMemo, useState } from "react";
import type { MetaItem } from "@/lib/types";

interface Props {
  items: MetaItem[];
  selected: string[]; // apiNames
  onToggle: (apiName: string) => void;
  max?: number; // max selectable (1 = radio behavior)
  placeholder: string;
  allowNone?: boolean;
}

/** Searchable multi/single select over GA4 metadata items. */
export default function MetaPicker({ items, selected, onToggle, max = 1, placeholder, allowNone }: Props) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    const needle = q.toLowerCase();
    const match = needle
      ? items.filter(
          (i) =>
            i.uiName.toLowerCase().includes(needle) ||
            i.apiName.toLowerCase().includes(needle) ||
            i.category.toLowerCase().includes(needle)
        )
      : items;
    return match.slice(0, 60);
  }, [items, q]);

  const label =
    selected.length === 0
      ? allowNone
        ? "None (totals only)"
        : placeholder
      : selected
          .map((s) => items.find((i) => i.apiName === s)?.uiName ?? s)
          .join(", ");

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full truncate rounded-lg border border-white/10 bg-[#111110] px-3 py-2 text-left text-sm text-white hover:border-white/20"
      >
        {label}
        <span className="float-right text-[#898781]">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-white/10 bg-[#1a1a19] shadow-2xl">
          <div className="sticky top-0 bg-[#1a1a19] p-2">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Search ${placeholder.toLowerCase()}…`}
              className="w-full rounded-md border border-white/10 bg-[#111110] px-2.5 py-1.5 text-sm text-white outline-none focus:border-[#3987e5]"
            />
          </div>
          {allowNone && (
            <button
              type="button"
              onClick={() => {
                if (selected.length) selected.forEach((s) => onToggle(s));
                setOpen(false);
              }}
              className="block w-full px-3 py-2 text-left text-sm text-[#898781] hover:bg-white/5"
            >
              None (totals only)
            </button>
          )}
          {filtered.map((i) => {
            const isSel = selected.includes(i.apiName);
            const disabled = !isSel && max > 1 && selected.length >= max;
            return (
              <button
                key={i.apiName}
                type="button"
                disabled={disabled}
                onClick={() => {
                  if (max === 1) {
                    // radio: clear others first
                    selected.filter((s) => s !== i.apiName).forEach((s) => onToggle(s));
                    if (!isSel) onToggle(i.apiName);
                    setOpen(false);
                  } else {
                    onToggle(i.apiName);
                  }
                }}
                className={`block w-full px-3 py-2 text-left text-sm hover:bg-white/5 disabled:opacity-40 ${
                  isSel ? "text-[#3987e5]" : "text-[#c3c2b7]"
                }`}
              >
                <span className="mr-2 inline-block w-4">{isSel ? "✓" : ""}</span>
                {i.uiName}
                <span className="ml-2 text-xs text-[#898781]">{i.category}</span>
              </button>
            );
          })}
          {filtered.length === 0 && <div className="px-3 py-3 text-sm text-[#898781]">No matches</div>}
        </div>
      )}
    </div>
  );
}
