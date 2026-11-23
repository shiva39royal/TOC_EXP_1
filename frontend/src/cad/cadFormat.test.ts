import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildChunks, parseCadr } from "./cadFormat";
import { Scene, drawScene, fitCamera } from "./scene";

const FIXTURE = new URL("./__fixtures__/model.cadr.gz", import.meta.url);
const load = () => {
  const b = gunzipSync(readFileSync(FIXTURE));
  return parseCadr(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};

describe("cadr format", () => {
  it("parses header, keeps original coordinates, and conserves geometry when tiling", () => {
    const p = load();
    expect(p.bounds).toMatchObject({ minX: -50, minY: -200, maxX: 1100, maxY: 1050 });
    expect(p.meta.length / 5).toBeGreaterThan(50);
    const chunks = buildChunks(p);
    let v = 0;
    for (const c of chunks) v += c.coords.length / 2 + c.segs.length / 2;
    // polyline pieces overlap by one vertex, so tiled >= source, never fewer
    expect(v).toBeGreaterThanOrEqual(p.verts.length / 2);
    for (const c of chunks) {
      expect(c.bbox[0]).toBeGreaterThanOrEqual(p.bounds.minX - p.origin[0] - 1e-3);
      expect(c.bbox[2]).toBeLessThanOrEqual(p.bounds.maxX - p.origin[0] + 1e-3);
    }
  });

  it("rejects garbage", () => expect(() => parseCadr(new ArrayBuffer(32))).toThrow());

  it("rasterises with the real draw path (@napi-rs/canvas)", async () => {
    const napi = await import("@napi-rs/canvas");
    (globalThis as any).Path2D = napi.Path2D;
    const p = load();
    const scene = new Scene(p.origin, p.bounds, buildChunks(p));
    const W = 1000, H = 800;
    const cv = napi.createCanvas(W, H);
    const ctx = cv.getContext("2d") as unknown as CanvasRenderingContext2D;
    drawScene(ctx, scene, fitCamera(scene, W, H), W, H, 1, { dark: true, lineweights: true, grid: false, interacting: false });
    const png = cv.toBuffer("image/png");
    const tmpOut = process.env.CAD_TEST_OUT ?? (await import("node:os")).tmpdir() + "/frontend_render.png";
    writeFileSync(tmpOut, png);
    // not blank: some pixels differ from the background colour
    const data = ctx.getImageData(0, 0, W, H).data;
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] > 60 || data[i + 1] > 60 || data[i + 2] > 60) lit++;
    expect(lit).toBeGreaterThan(2000);
    expect(existsSync(tmpOut)).toBe(true);
  });
});
