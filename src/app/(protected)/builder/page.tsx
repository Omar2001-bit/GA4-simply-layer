"use client";

import { useEffect, useState } from "react";
import ReportCanvas from "@/components/ReportCanvas";
import { defaultReport } from "@/lib/useReport";
import type { ReportConfig } from "@/lib/types";

export default function BuilderPage() {
  const [initial, setInitial] = useState<ReportConfig | null>(null);

  useEffect(() => {
    fetch("/api/properties")
      .then((r) => r.json())
      .then((j) => setInitial(defaultReport(j.defaultProperty || j.properties?.[0]?.property || "")))
      .catch(() => setInitial(defaultReport("")));
  }, []);

  if (!initial) return <p className="text-sm text-[#7f959d]">Loading…</p>;
  return <ReportCanvas initial={initial} startEditing isNew />;
}
