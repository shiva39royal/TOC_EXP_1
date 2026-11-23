import { Box } from "@mui/material";
import { useEffect, useRef } from "react";
import { MONO } from "../theme/theme";
import { useViewerStore } from "../store/viewerStore";
import { cursorBus } from "./cursorBus";

const fmt = (v: number | null) => (v === null ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }));

/** Bottom status bar. Cursor text is written straight to the DOM (no React re-render per mouse move). */
export default function CoordinateDisplay() {
  const x = useRef<HTMLSpanElement>(null), y = useRef<HTMLSpanElement>(null);
  const { zoom, fileName, status } = useViewerStore();

  useEffect(() => cursorBus.subscribe((cx, cy) => {
    if (x.current) x.current.textContent = fmt(cx);
    if (y.current) y.current.textContent = fmt(cy);
  }), []);

  const cell = { px: 1.5, display: "flex", gap: 0.75, alignItems: "baseline" } as const;
  return (
    <Box sx={{ height: 26, display: "flex", alignItems: "center", px: 1, borderTop: 1, borderColor: "divider", bgcolor: "background.paper",
      fontFamily: MONO, fontSize: 12, color: "text.secondary", whiteSpace: "nowrap", overflow: "hidden" }}>
      <Box sx={{ ...cell, minWidth: 150 }}>X: <span ref={x}>—</span></Box>
      <Box sx={{ ...cell, minWidth: 150 }}>Y: <span ref={y}>—</span></Box>
      <Box sx={{ ...cell, minWidth: 110 }}>Zoom: {Math.round(zoom * 100)}%</Box>
      <Box sx={{ ...cell, flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{fileName}</Box>
      <Box sx={{ ...cell, color: status === "ready" ? "primary.main" : "text.secondary" }}>
        {status === "ready" ? "DWG Ready" : "Rendering…"}
      </Box>
    </Box>
  );
}
