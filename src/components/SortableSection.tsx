"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { DotsSixVerticalIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

interface Props {
  id: string; // block key ("section:numbers", "float-2", …) — see blockKey() in lib/types
  draggable: boolean; // false in client-share / lockView mode
  className?: string;
  children: ReactNode;
}

/** Drag-to-reorder wrapper for a top-level block (a named section or a
 *  floating card group). Adds a grip handle in the corner, and while another
 *  block hovers over this one, a brand-green ring marks it as the swap
 *  target — "this is where it lands if released". */
export default function SortableSection({ id, draggable, className, children }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver, active } = useSortable({
    id,
    disabled: !draggable,
    data: { type: "section" },
  });

  const isDropTarget = isOver && !isDragging && active?.data.current?.type === "section";

  return (
    <section
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      className={`animate-rise-in relative rounded-2xl border p-4 ${
        isDropTarget ? "border-[#6ae499] ring-2 ring-[#6ae499]/50" : "border-white/10"
      } ${className ?? ""}`}
    >
      {draggable && (
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder section"
          className="focus-ring touch-none absolute right-3 top-3 z-10 flex h-6 w-6 cursor-grab items-center justify-center rounded-md text-[#7f959d] transition-colors duration-150 hover:bg-white/5 hover:text-white active:cursor-grabbing"
        >
          <DotsSixVerticalIcon size={15} weight="bold" />
        </button>
      )}
      {children}
    </section>
  );
}
