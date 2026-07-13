"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { DotsSixVerticalIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

interface Props {
  id: string; // globally unique sortable id — see entryKey() in lib/types
  data: Record<string, unknown>; // opaque passthrough, read back in onDragEnd via active.data.current
  draggable: boolean; // false in client-share / lockView mode
  onClick?: () => void;
  className?: string;
  children: ReactNode;
}

/** Wrapper for a single entry card/row, used across every card container
 *  (entry sections and floating groups). The card body is a click target
 *  (jumps the graph to its metric) with a green hover outline; dragging
 *  happens from the grip icon that fades in on hover, so click and drag
 *  never fight over the same gesture. While another card hovers over this
 *  one mid-drag, a solid green ring marks it as the swap target. */
export default function SortableMetricCard({ id, data, draggable, onClick, className, children }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver, active } = useSortable({
    id,
    disabled: !draggable,
    data,
  });

  const isDropTarget = isOver && !isDragging && active?.data.current?.type === "card";

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      onClick={onClick}
      className={`group relative rounded-xl transition-shadow duration-100 ${
        isDropTarget ? "ring-2 ring-[#6ae499]" : "hover:ring-1 hover:ring-[#6ae499]/60"
      } ${className ?? ""} ${onClick ? "cursor-pointer" : ""}`}
    >
      {draggable && (
        <button
          type="button"
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          aria-label="Drag to move card"
          className="focus-ring touch-none absolute right-1 top-1 z-10 flex h-5 w-5 cursor-grab items-center justify-center rounded bg-[#0e1c26]/90 text-[#7f959d] opacity-0 transition-opacity duration-100 hover:text-white focus-visible:opacity-100 group-hover:opacity-100 active:cursor-grabbing"
        >
          <DotsSixVerticalIcon size={12} weight="bold" />
        </button>
      )}
      {children}
    </div>
  );
}
