# GA4 Simply Layer

A simpler reporting layer on top of Google Analytics 4 — built for clients and internal teams who just want to *see the numbers*.

## What it does

- **Reports** — each report has two sections: a **Graph view** (line / area / bar / horizontal bar / pie / donut, switchable live) and a **Numbers view** (KPI cards + full comparison table with Δ%).
- **Before / after comparison** — every report has two date ranges (current + comparison) changeable via selectors; charts and numbers re-render as you play with the dates.
- **Presets** — build a report once, save it. Saved reports become templates.
- **View mode** — toggle the editor off for a clean, read-only visualization mode (append `?mode=view` to a report URL for a locked client link).
- **Mega dashboard** — all saved reports on one screen with a global date override; click any report to zoom into the full graph + numbers detail.
- **Multi-property** — auto-discovers every GA4 property the service account can access.
- **Password gate** — one shared dashboard password keeps client data off the open internet.

## Stack

Next.js (App Router) · Recharts · Tailwind · GA4 Data + Admin APIs (REST, service-account JWT) · Vercel Blob for preset storage in production (local JSON file in dev).

## Environment variables

| Var | Purpose |
|-----|---------|
| `GA_SA_KEY_B64` | Base64 of the Google service-account JSON key (analytics.readonly scope; grant the SA Viewer on each GA4 property) |
| `DASHBOARD_PASSWORD` | Shared password for the login gate |
| `DEFAULT_GA4_PROPERTY` | e.g. `properties/413595793` — pre-selected property for new reports |
| `BLOB_READ_WRITE_TOKEN` | Auto-provisioned by Vercel Blob; enables persistent presets in production |

Create `.env.local` with the first three for local dev:

```bash
GA_SA_KEY_B64=<base64 of sa-key.json>
DASHBOARD_PASSWORD=<password>
DEFAULT_GA4_PROPERTY=properties/413595793
```

## Run locally

```bash
npm install
npm run dev
```

Presets are stored in `data/presets.json` locally (gitignored) and in Vercel Blob when deployed.
