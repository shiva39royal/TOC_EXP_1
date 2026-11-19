import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/analyze-layout")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid request body." }, { status: 400 });
        }
        if (
          !body ||
          typeof body !== "object" ||
          !Array.isArray((body as { files?: unknown }).files)
        ) {
          return Response.json(
            { error: "Please upload a layout file (.dwg, .dxf, or .pdf)." },
            { status: 400 },
          );
        }
        const files = (body as { files: unknown[] }).files;
        if (files.length !== 1) {
          return Response.json({ error: "Upload exactly one layout file." }, { status: 400 });
        }
        const { analyzeLayoutRequest } = await import("@/server/analyzeLayout.server");
        const result = await analyzeLayoutRequest(
          body as Parameters<typeof analyzeLayoutRequest>[0],
        );
        return Response.json(result.payload, { status: result.status });
      },
    },
  },
});
