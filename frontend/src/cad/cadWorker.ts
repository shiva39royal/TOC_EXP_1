/// <reference lib="webworker" />
import { buildChunks, parseCadr } from "./cadFormat";

export type WorkerRequest = { type: "load"; url: string; id: number };
export type WorkerResponse =
  | { type: "stage"; id: number; stage: string }
  | { type: "done"; id: number; origin: [number, number]; bounds: import("./cadFormat").Bounds; chunks: import("./cadFormat").Chunk[]; vertices: number }
  | { type: "error"; id: number; message: string };

const post = (m: WorkerResponse, t: Transferable[] = []) => (self as DedicatedWorkerGlobalScope).postMessage(m, t);

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const { url, id } = ev.data;
  try {
    post({ type: "stage", id, stage: "Downloading geometry" });
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    post({ type: "stage", id, stage: "Indexing geometry" });
    const parsed = parseCadr(buf);
    const chunks = buildChunks(parsed);
    const transfer: Transferable[] = [];
    for (const c of chunks) transfer.push(c.coords.buffer, c.lens.buffer, c.groups.buffer, c.segs.buffer);
    post({ type: "done", id, origin: parsed.origin, bounds: parsed.bounds, chunks, vertices: parsed.verts.length / 2 }, transfer);
  } catch (e) {
    post({ type: "error", id, message: e instanceof Error ? e.message : String(e) });
  }
};
