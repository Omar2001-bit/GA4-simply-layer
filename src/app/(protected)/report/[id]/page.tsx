"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import ReportCanvas from "@/components/ReportCanvas";
import type { PresetsFile, ReportConfig } from "@/lib/types";

export default function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const lockView = search.get("mode") === "view";
  const [report, setReport] = useState<ReportConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/presets")
      .then(async (r) => {
        const j: PresetsFile = await r.json();
        if (!r.ok) throw new Error((j as { error?: string }).error || "Failed to load");
        const found = j.reports.find((x) => x.id === id);
        if (!found) throw new Error("Report not found");
        setReport(found);
      })
      .catch((e) => setError((e as Error).message));
  }, [id]);

  if (error) return <p className="text-sm text-[#e66767]">{error}</p>;
  if (!report) return <p className="text-sm text-[#898781]">Loading report…</p>;
  return <ReportCanvas initial={report} lockView={lockView} />;
}
