<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.

<!-- LOVABLE:END -->

## SignalTOC architecture

- The workbench UI (`src/components/SignalTocApp.tsx`) renders client-only from `/` because pdfjs, OCR, and the DWG decoder are browser-only libraries. Projects persist locally in IndexedDB.
- Offline extraction is the default and never leaves the browser: `src/utils/offlineOcr.ts` renders the drawing at ~9000px long side, reads overlapping tiles (as drawn, cleaned of long lines, and rotated for vertical labels) with bundled Tesseract workers, and detects running-line bands and signal-head circles (`src/engine/drawingSymbols.ts`); `src/engine/offlineExtractor.ts` links tokens using distances measured in label-text heights so it works at any drawing scale.
- DWG/DXF decoding runs in the browser (`src/utils/cadParser.ts`, WASM served from `public/libredwg/`). Its positioned annotations feed the same offline extractor.
- AI extraction is opt-in only after the user selects Google, OpenAI, or Anthropic and supplies a key. That explicit request uses one synchronous POST to `/api/analyze-layout`; provider adapters live in `src/server/extractionProviders.server.ts` and keys are never persisted.
- Fonts, OCR language data/worker/core, and CAD assets are bundled. The generated PWA service worker is registered only by `src/lib/registerOfflineApp.ts` on eligible production hosts, never in development or Lovable previews.
- Ported legacy files carry `// @ts-nocheck` because they were written for a looser TS config; remove it per-file when touching them substantively.
