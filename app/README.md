# App

Power Apps code app (React, TypeScript, Vite) for reviewing SOP analyses.

## Builds

| Command | Output |
|---|---|
| `npm run build` then `npx pa push` | Production app on SharePoint data, deployed to the Power Platform environment in `power.config.json` |
| `VITE_DEMO=1 npx vite build --base ./ --outDir dist-demo` | Static public demo over `src/demo/demo-data.json` (built by `scripts/build_demo_data.py`) |
| `VITE_DEMO=1 npx vite` | Demo with hot reload |

## Structure

| Path | Contents |
|---|---|
| `src/data.ts` | Data access used by every screen; selects the SharePoint or demo backend |
| `src/backend/sharepoint.ts` | SharePoint connector calls (generated services in `src/generated`) |
| `src/backend/demo.ts` | In-browser backend for the demo; changes persist in local storage |
| `src/components/` | Inbox, process map (swimlane and simple flow), risks, recommended changes, current vs. future, review log, Ask AI |

Calls to Claude go through Power Automate flows (`Ask SOP`, `Analyze SOP`); the app never holds the API key.
