"use client";

import { CaretDownIcon, CheckIcon } from "@phosphor-icons/react";
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
        className="focus-ring flex w-full items-center gap-2 rounded-lg border border-white/10 bg-[#081219] px-3 py-2 text-left text-sm text-white transition-colors duration-150 hover:border-white/25"
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <CaretDownIcon
          size={14}
          weight="bold"
          className="shrink-0 text-[#7f959d] transition-transform duration-150"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>
      {open && (
        <div className="animate-pop-in absolute z-20 mt-1.5 max-h-72 w-full origin-top overflow-y-auto rounded-lg border border-white/10 bg-[#0e1c26] shadow-2xl shadow-black/40">
          <div className="sticky top-0 bg-[#0e1c26] p-2">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Search ${placeholder.toLowerCase()}…`}
              className="focus-ring w-full rounded-md border border-white/10 bg-[#081219] px-2.5 py-1.5 text-sm text-white transition-colors duration-150 focus:border-[#6ae499]"
            />
          </div>
          {allowNone && (
            <button
              type="button"
              onClick={() => {
                if (selected.length) selected.forEach((s) => onToggle(s));
                setOpen(false);
              }}
              className="focus-ring block w-full px-3 py-2 text-left text-sm text-[#7f959d] transition-colors duration-100 hover:bg-white/5 hover:text-[#c2d1d5]"
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
                className={`focus-ring flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors duration-100 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent ${
                  isSel ? "text-[#6ae499]" : "text-[#c2d1d5]"
                }`}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                  {isSel && <CheckIcon size={13} weight="bold" className="animate-check-pop" />}
                </span>
                <span className="min-w-0 flex-1 truncate">{i.uiName}</span>
                <span className="shrink-0 text-xs text-[#7f959d]">{i.category}</span>
              </button>
            );
          })}
          {filtered.length === 0 && <div className="px-3 py-3 text-sm text-[#7f959d]">No matches</div>}
        </div>
      )}
    </div>
  );
}
