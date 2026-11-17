# SignalTOC — Complete Engineering Requirements & Reusable Master Blueprint

> **Purpose:** Complete functional, architectural, domain, UI/UX, and reliability requirements for **SignalTOC** (Indian Railways Signalling & KAVACH / TCAS Table of Control Workbench). This document serves both as the project's canonical specification and as a self-contained **Backup Master Prompt** at the bottom.

---

## 1. Core Non-Negotiable Principles

### 1.1 Zero Hardcoding & Strict Layout Fidelity
- **Never hardcode or fabricate station data:** Station Name, Alpha Code, Numeric Station/LCU ID, Division, Section, Adjacent Station IDs, Tracks, Loops, Points, Signals, RFID Tags, TINs, LC Gates, and Routes MUST come strictly from the uploaded drawing.
- **No hallucinated topology:**
  - Only create tracks, loops, crossovers, or connected lines that **genuinely exist** in the uploaded layout.
  - Example: If an uploaded automatic signalling / LC-gate layout (e.g., `LC-49`) has **only** `UP MAIN LINE` and `DN MAIN LINE` with zero points/switches, the application MUST show **0 points** and **0 loop lines** — never inject phantom Common Loops, UP/DOWN Loops, or station cross-overs.
  - Every extracted signal name (e.g., `S-1`, `S-2`, `A511`, `S11`) and RFID tag ID (e.g., `R-263`, `R-701`) must appear verbatim on the uploaded drawing.
- **No `"UNKNOWN"` spam:** Never leave raw `"UNKNOWN"` strings when title block, RFID allotment table, track banner, filename fallback, or metadata rescue pass can extract the real value; display clean `--` only for genuinely absent optional fields.

### 1.2 No Mandatory API Key & Offline-First CAD Parsing
- **Zero mandatory external API keys:** Uploading and inspecting CAD layouts (`.dwg`, `.dxf`) and vector `.pdf` files MUST work cleanly **without** requiring a paid or rate-limited external AI API key.
- **No API key input UI:** Never render API key text boxes, prompts, or key-management modals inside the browser UI. Server-side environment configuration (`Settings > Secrets` -> `GEMINI_API_KEY`) is strictly optional and used only when OCR vision assistance is needed for scanned raster-only PDFs.
- **Deterministic Local Extraction Engine:**
  - `.dwg` (converted via LibreDWG WASM + parsed via `dxf-parser`) and `.dxf` (ASCII & binary) and vector `.pdf` (`pdfjs-dist` text-coordinate extraction) MUST parse deterministically on the local engine (`buildDeterministicVectorExtraction`) when offline or when external OCR quota is unavailable.
- **Resilient Optional OCR / Quota Protection (Scanned Raster PDFs):**
  - Automatic failover across model quota buckets (`gemini-4-hydrogen` -> `gemini-3.1-flash-lite`) on `429 RESOURCE_EXHAUSTED` or `503 UNAVAILABLE`.
  - Never waste retry attempts on daily quota limits (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`).
  - SHA-256 hash-based in-memory result caching so re-uploading identical files costs zero quota.
  - Human-readable error notices — never dump raw upstream JSON error blobs to the user.

---

## 2. Supported File Inputs & Large-Sheet Processing Pipeline

### 2.1 Supported Layout Formats
- **AutoCAD `.dwg`**: Binary DWG signature verification (`AC10xx`) + LibreDWG WASM decoding + geometry/layer/block/text extraction.
- **AutoCAD `.dxf`**: ASCII and Binary DXF decoding + layer/block/text coordinate extraction.
- **Engineering `.pdf`**: Vector text-with-coordinates extraction AND high-DPI visual rendering for both vector and scanned plotter-roll sheets (including multi-page PDFs and ultra-wide single-sheet roll PDFs up to 70+ MB, such as 89-inch `LC-49` layouts).
- **Strict Format Validation:** Reject unsupported extensions (`.png`, `.jpg`, `.txt`, `.docx`, etc.) and mismatched magic headers with clear HTTP `400` messages.

### 2.2 Anti-Timeout & Anti-Payload-Limit Pipeline
- **Client-Side Pre-Processing (`pdfImageExtractor.ts` / `layoutAnalysisClient.ts`):**
  - Extract embedded PDF vector text + coordinates directly in the browser.
  - Auto-detect sideways/portrait plotter sheets and rotate them upright (`0°`/`90°`).
  - Render focused high-resolution JPEG crops (~2–3 MB total payload): full-sheet overview, overlapping horizontal strips across the track corridor, title block zoom crop, and RFID tag allotment table crop.
  - Keep raw `pdfBase64` locally in browser memory and reattach it after analysis so multi-megabyte PDFs are not echoed over Cloud Run reverse proxies.
- **Server-Side Fallback & Async Job Architecture (`server.ts`):**
  - Ghostscript (`/Install` + `-dFIXEDMEDIA`) clipped tiling fallback on backend when browser crops are omitted.
  - Non-blocking job pattern: `POST /api/analyze-layout/start` (`202 Accepted` + `jobId`) and polling `GET /api/analyze-layout/jobs/:jobId` so gateway timeouts never return HTML `<html>...` (`Unexpected token '<'`) instead of JSON.

---

## 3. UI / UX & Interactive CAD Visualization

### 3.1 Upload Workflow & Navigation
- **Top Navigation (`TopNav.tsx`):** Clean single-row sticky bar with brand title (`SignalTOC`) and 4 workspace tabs:
  1. `Track Schematic`
  2. `Extracted Data`
  3. `Validation`
  4. `TOC Output`
- **Centered Upload Layout Entry Point:**
  - Do **NOT** put an `Upload Layout` button in the top-right header corner.
  - Display a prominent centered **`Upload Layout`** CTA in the main workspace (`TrackSchematicView`), plus an **`Upload Another Layout`** button inside the loaded schematic toolbar.
  - Clicking **`Upload Layout`** opens the `UploadModal` dialog with:
    1. Layout file selector & drag-and-drop zone (`.dwg`, `.dxf`, `.pdf`).
    2. Target TOC Format (`Selection Table` vs `TCAS TOC`) and optional Direction/Station context input.
    3. **`Proceed`** button to start extraction.
  - No API key field is shown inside the modal.

### 3.2 Interactive CAD & PDF Viewer (`CadDrawingViewer.tsx`)
- **Smooth Pan & Zoom:**
  - Mouse-wheel zoom centered accurately at the cursor position (for both CAD canvas and PDF canvas, with zoom presets from `50%` up to `2000%`).
  - Smooth click-and-drag panning across the entire drawing plus directional pan controls.
  - Robust **Zoom-to-Fit** (`Maximize2` / Fit) that computes true content bounding-box dimensions (including rotated sheets and ultra-wide railway layouts) and centers cleanly with padding.
- **Engineering Toolbar Controls:**
  - Rotate (`0° / 90° / 180° / 270°`) for both CAD and PDF views.
  - Light / Dark drafting background toggle.
  - Crosshair toggle + live cursor world `(X, Y)` coordinate readout.
  - Layer visibility manager (for `.dwg` / `.dxf` drawings).
  - In-drawing text/entity search with Previous/Next match jumping.
  - Multi-page PDF navigation (`Prev / Next`).
  - High-DPI PNG snapshot export.
- **Render Stability:** Zero infinite React update loops (`Maximum update depth exceeded`) when resizing, zooming, rotating, or rebuilding PDF/CAD offscreen bitmaps.

### 3.3 Clean Production Interface
- No developer telemetry panels, raw backend log panes, or `window.alert` / `window.open` dialogs.

---

## 4. Indian Railways Signalling & KAVACH / TCAS Domain Extraction Rules

Every uploaded layout must extract structured, mutually consistent data matching real Indian Railways TOCs (verified against reference layouts and TOCs such as `LC-49`, `Chitgidda`, and `Jankampet Jn.`):

### 4.1 Station Metadata (`StationMetadata`)
- `stationName`, `stationCode` (2–5 uppercase alpha letters, e.g., `CTF`, `JKM`, `UJP`, `SPJ`), `stationId` (numeric TCAS/LCU ID, e.g., `47151`, `01014`), `division`, `section`, `refSip`, `refLayout`, `nextDownStationId`, `nextUpStationId`, `chainageDirection` (`LEFT_INCREASING` | `RIGHT_INCREASING`).
- Editable manually in the sidebar inspector with immediate re-validation and audit trail logging.

### 4.2 Physical Signalling Entities
- **Tracks (`TrackLine[]`):** Exact line names (`UP_MAIN`, `DN_MAIN`, `COMMON_LOOP`, `UP_LOOP`, `DN_LOOP`, `BRANCH`, `SIDING`), direction, track circuits (`513AXT`, `2T`, etc.), TIN lists (`N-46`, `N-222`), and accurate `ySlot` vertical ordering.
- **Signals (`SignalNode[]`):** Exact Signal ID (`S-1`, `S-2`, `A511`, `S11`, etc.), line, direction (`UP` | `DOWN` | `BIDIRECTIONAL`), type (`Home`, `Starter`, `Advanced Starter`, `Auto`, `Distant`, `Shunt`, `Gate`), chainage (m), foot RFID tag (`footTagId`), aspects, and track circuit.
- **RFID Tags (`RfidTag[]`):** Normalized Tag ID (`R-xxx`), chainage (m), line, TIN (`N-xxx`), tag type (`SIGNAL_FOOT`, `NORMAL`, `LOOP`, `GATE`, `BOUNDARY`, `DEAD_END`), and linked signal.
- **Points (`PointSwitch[]`):** Only extracted when switches/turnouts exist on the sheet — Point ID (`101`, `102`), chainage, Normal/Reverse lines, turnout speed (kmph), commencement & restriction lengths.
- **Level Crossings (`LevelCrossing[]`):** Gate name/number (`LC NO. 48`, `LC NO. 49`, `LC NO. 191`, `LC NO. 190A`), class (`SPL`, `B2`), chainage, manning & closing interlocking rules.

### 4.3 Compiled TOC Routes & Output Modes (`TocRouteRow[]`, `BlockSectionDetail[]`)
- **Route Fields:** `slNo`, `entrySignal`, `exitSignal`, `leadingToLine`, `direction`, `tsrmsRouteId`, `signalType`, `entryAspectSummary`, `exitAspectsSummary`, `requiredRouteLocking` (`S-2->S-4`), `pointsNormal[]`, `pointsReverse[]`, `trackCktUp`, `tinsRequiresFree[]`, `entryFootTag`, `linkingSequence` `[{ distanceM, tagId }]`, `enRouteTags[]`, `conflictingTurnoutTags[]`, `conflictingRouteTags[]`, `distanceBetweenSignalsM`, `movementAuthoritySections`, `movementAuthorityMeters`, `authorizedSpeedSr`, `authorizedSpeedOs`, `psrSegments[]`, `averageGradient`, `isTsl`, `sectionType`, `lcGateRequired`, `engineerStatus`.
- **Two Output Formats:**
  1. **`CHITGIDDA_SELECTION` (Selection Table):** Full route selection & interlocking matrix matching RDSO / Chitgidda-style Selection Tables.
  2. **`JANKAMPET_TOC` (TCAS TOC):** KAVACH RFID TOC route table + Block Section demarcation & reset sheet.
- **Exports (`exportToc.ts`):**
  - Multi-sheet Excel `.xlsx` workbook export, CSV/JSON export, and Print/PDF-ready formatted TOC sheets.

---

## 5. Deterministic Validation & Signalling Engineer Review (`validator.ts`)

Automatically validates all extracted & edited entities against RDSO SPN-196 rules:
1. **RFID Tag Uniqueness:** Flags duplicate physical RFID Tag IDs across lines/chainages.
2. **TIN Demarcation:** Flags missing TINs **only** when the uploaded layout uses TIN blocks (skipped cleanly on pure Automatic Section layouts that do not assign TINs).
3. **Foot Tag Linkage:** Verifies every main running signal has a valid linked Foot RFID Tag.
4. **Linking Distance Consistency:** Checks that `sum(linkingSequence.distanceM)` reconciles with `distanceBetweenSignalsM` / signal chainage deltas.
5. **Point Normal/Reverse Conflict Check:** Ensures no point appears simultaneously in Normal and Reverse lists for the same route.
6. **Ambiguity Review & Engineer Sign-Off:** Interactive issue resolution notes, inline verification flags across signals/tags/routes, immutable audit log, and Engineer Sign-Off lock gate.

---

## 6. Runtime, Server & Build Stability Requirements

- **Runtime Architecture:** React + TypeScript + Tailwind CSS frontend served by an Express + `vite` middleware server (`server.ts`) on port `3000`.
- **WebSocket / Reverse Proxy Safety:**
  - When `DISABLE_HMR=true`, set Vite `hmr: false, ws: false` and serve a WebSocket-free `/@vite/client` shim containing a `typeof HTMLElement !== 'undefined'` guard so browser Web Workers (e.g. `pdf.worker.min.mjs`) never throw `Uncaught ReferenceError: HTMLElement is not defined` or `WebSocket closed without opened`.
- **Verification & Hygiene:**
  - Zero TypeScript errors (`tsc --noEmit`) and clean production Vite bundle (`npm run build`).
  - No leftover temporary test PDFs, sample asset folders, or `/tmp` artifacts in the repository.

---

## 7. Backup Master Prompt (Copy-Paste Reference)

> **Use the prompt below whenever recreating, extending, or auditing this application:**
>
> Build **SignalTOC**, a full-stack Indian Railways Signalling & KAVACH/TCAS Workbench (React, TypeScript, Tailwind CSS, Express on port `3000`).
>
> **Strict Rules:**
> 1. **Zero Hardcoding:** Never hardcode station names, station codes, station IDs, tracks, loop lines, points, signals, RFID tags, TINs, or routes. Extract strictly and accurately only what exists in the user's uploaded layout (`.dwg`, `.dxf`, or `.pdf`). If an uploaded layout has only UP/DN main lines and no loops or points, render 0 loops and 0 points.
> 2. **No Mandatory API & No API Key UI:** Never create an API key input field in the UI and never require an external API key to use `.dwg`, `.dxf`, or vector `.pdf` extraction. Include a full local deterministic CAD/vector parser (`LibreDWG` WASM + `dxf-parser` + `pdfjs-dist` coordinate text extraction) that works completely offline with zero external API calls. Any optional cloud vision OCR for scanned raster PDFs must live strictly server-side (`process.env.GEMINI_API_KEY`), cache results by SHA-256 hash, fail over cleanly on `429` limits, and surface clear human-readable notices instead of raw JSON errors.
> 3. **Centered Upload Flow:** Do not place the `Upload Layout` button in the top-right header bar. Show a prominent centered `Upload Layout` CTA in the main workspace that opens an upload modal with layout selection (`.dwg`, `.dxf`, `.pdf`), TOC format option (`Selection Table` vs `TCAS TOC`), optional context hint, and a `Proceed` button.
> 4. **Interactive CAD & PDF Viewer:** Provide smooth cursor-centered zoom (presets up to `2000%`), drag panning + directional controls, accurate Zoom-to-Fit, sheet rotation (`0°/90°/180°/270°`), Dark/Light CAD background toggle, crosshair coordinates, DXF/DWG layer toggles, in-drawing text search, multi-page PDF navigation, and PNG snapshot download—with no infinite React render loops.
> 5. **Large-Sheet & Reverse-Proxy Resilience:** Pre-process large wide engineering PDFs into upright cropped overview/strip/title-block tiles client-side (~2–3 MB) with Ghostscript fallback on backend, process via async start/poll job routes (`/api/analyze-layout/start`, `/api/analyze-layout/jobs/:jobId`), and disable Vite WebSockets safely (`hmr: false, ws: false`, worker-safe `HTMLElement` shim) when `DISABLE_HMR=true`.
> 6. **Engineering Validation & Export:** Validate extracted data against RDSO SPN-196 rules (unique RFID tags, linking distance checks, point conflicts, TIN checks when applicable), allow inline editing + verification + audit logging, and export validated TOCs to multi-sheet Excel (`.xlsx`), CSV/JSON, and print layouts.
