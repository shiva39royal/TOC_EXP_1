import { useState } from "react";
import {
  Box,
  Paper,
  Typography,
  TextField,
  IconButton,
  Button,
  Divider,
  Chip,
  Tooltip,
  Collapse,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import RepeatIcon from "@mui/icons-material/Repeat";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import SaveIcon from "@mui/icons-material/Save";
import { useViewerStore } from "../store/viewerStore";
import { modifyDrawing } from "../services/cadApi";

import type { CadViewerHandle } from "./CadViewer";

interface Props {
  viewer?: React.RefObject<CadViewerHandle>;
}

export default function PropertyInspector({ viewer }: Props) {
  const {
    documentId,
    components,
    selectedComponentId,
    selectedComponentIds,
    movedComponents,
    stagedAdditions,
    selectComponent,
    moveComponent,
    updateComponent,
    deleteComponent,
    duplicateSelected,
    deleteSelected,
    repeatSelected,
    setComponents,
    clearSavedModifications,
  } = useViewerStore();

  const [expanded, setExpanded] = useState(true);
  const [stepSize, setStepSize] = useState<number>(5.0);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [saving, setSaving] = useState(false);
  const [repeatOpen, setRepeatOpen] = useState(false);
  const [repeatCount, setRepeatCount] = useState(3);
  const [repeatDeltaX, setRepeatDeltaX] = useState(20);
  const [repeatDeltaY, setRepeatDeltaY] = useState(0);

  const handleSaveToDxf = async () => {
    if (!documentId) return;
    setSaving(true);
    try {
      const moves = Object.entries(movedComponents)
        .filter(([id, m]) => !m.isDeleted && !id.startsWith("add_") && (m.dx !== 0 || m.dy !== 0))
        .map(([id, m]) => ({ id, dx: m.dx, dy: m.dy }));

      const updates = Object.entries(movedComponents)
        .filter(([id, m]) => !m.isDeleted && !id.startsWith("add_") && m.tags)
        .map(([id, m]) => ({ id, tags: m.tags, layer: m.layer }));

      const deletions = Object.entries(movedComponents)
        .filter(([_, m]) => m.isDeleted)
        .map(([id]) => id);

      const additions = Object.values(stagedAdditions).map((a) => {
        const mut = movedComponents[a.temp_id];
        const dx = mut ? mut.dx : 0;
        const dy = mut ? mut.dy : 0;
        return {
          ...a,
          insert_pos: [a.insert_pos[0] + dx, a.insert_pos[1] + dy] as [number, number],
          tags: { ...(a.tags || {}), ...(mut?.tags || {}) },
          layer: mut?.layer ?? a.layer,
        };
      });

      const res = await modifyDrawing(documentId, { moves, updates, deletions, additions });
      if (res?.components?.components) {
        setComponents(res.components.components);
      }
      clearSavedModifications();
      viewer?.current?.reload();
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    } catch (e) {
      console.error("Failed to save CAD modifications", e);
    } finally {
      setSaving(false);
    }
  };

  // Multi-selection UI
  if (selectedComponentIds && selectedComponentIds.size > 1) {
    const count = selectedComponentIds.size;
    return (
      <Paper
        elevation={8}
        sx={{
          position: "absolute",
          bottom: 36,
          left: 12,
          width: 320,
          maxHeight: "calc(100vh - 120px)",
          display: "flex",
          flexDirection: "column",
          bgcolor: "rgba(20, 24, 30, 0.95)",
          backdropFilter: "blur(12px)",
          border: "1px solid rgba(255, 255, 255, 0.15)",
          borderRadius: 2,
          color: "#f0f2f5",
          zIndex: 20,
          overflow: "hidden",
          boxShadow: "0 12px 32px rgba(0,0,0,0.6)",
        }}
      >
        <Box
          sx={{
            px: 1.5,
            py: 0.75,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
            bgcolor: "rgba(35, 42, 54, 0.9)",
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
            <Chip
              size="small"
              label="MULTI-SELECT"
              sx={{
                height: 18,
                fontSize: "0.65rem",
                fontWeight: 700,
                bgcolor: "#ff9800",
                color: "#000",
              }}
            />
            <Typography variant="caption" sx={{ fontWeight: 600, fontSize: "0.8rem" }}>
              {count} Components Selected
            </Typography>
          </Box>
          <Box sx={{ display: "flex", alignItems: "center" }}>
            <IconButton size="small" onClick={() => selectComponent(null)} sx={{ color: "#aaa" }}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
        </Box>

        <Box sx={{ p: 1.5, display: "flex", flexDirection: "column", gap: 1.2, overflowY: "auto", maxHeight: 380 }}>
          <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.6)", fontSize: "0.72rem" }}>
            Hold Shift to add/remove components from selection.
          </Typography>

          {/* Batch Nudge Controls */}
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mt: 0.5 }}>
            <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.5)" }}>
              Step: {stepSize}m
            </Typography>
            <Box sx={{ display: "flex", gap: 0.5 }}>
              {[1, 5, 10].map((s) => (
                <Chip
                  key={s}
                  size="small"
                  label={`${s}m`}
                  clickable
                  variant={stepSize === s ? "filled" : "outlined"}
                  color={stepSize === s ? "primary" : "default"}
                  onClick={() => setStepSize(s)}
                  sx={{ height: 20, fontSize: "0.65rem" }}
                />
              ))}
            </Box>
          </Box>
          <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 1 }}>
            <IconButton size="small" onClick={() => {
              if (selectedComponentId) moveComponent(selectedComponentId, (movedComponents[selectedComponentId]?.dx ?? 0) - stepSize, movedComponents[selectedComponentId]?.dy ?? 0, true);
            }} sx={{ border: "1px solid rgba(255,255,255,0.2)" }}>
              <ArrowBackIcon fontSize="small" />
            </IconButton>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
              <IconButton size="small" onClick={() => {
                if (selectedComponentId) moveComponent(selectedComponentId, movedComponents[selectedComponentId]?.dx ?? 0, (movedComponents[selectedComponentId]?.dy ?? 0) + stepSize, true);
              }} sx={{ border: "1px solid rgba(255,255,255,0.2)" }}>
                <ArrowUpwardIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" onClick={() => {
                if (selectedComponentId) moveComponent(selectedComponentId, movedComponents[selectedComponentId]?.dx ?? 0, (movedComponents[selectedComponentId]?.dy ?? 0) - stepSize, true);
              }} sx={{ border: "1px solid rgba(255,255,255,0.2)" }}>
                <ArrowDownwardIcon fontSize="small" />
              </IconButton>
            </Box>
            <IconButton size="small" onClick={() => {
              if (selectedComponentId) moveComponent(selectedComponentId, (movedComponents[selectedComponentId]?.dx ?? 0) + stepSize, movedComponents[selectedComponentId]?.dy ?? 0, true);
            }} sx={{ border: "1px solid rgba(255,255,255,0.2)" }}>
              <ArrowForwardIcon fontSize="small" />
            </IconButton>
          </Box>

          <Divider sx={{ borderColor: "rgba(255, 255, 255, 0.08)" }} />

          {/* Action buttons */}
          <Box sx={{ display: "flex", gap: 1 }}>
            <Button
              size="small"
              variant="outlined"
              startIcon={<ContentCopyIcon fontSize="small" />}
              onClick={() => duplicateSelected()}
              sx={{ fontSize: "0.7rem", py: 0.4, flex: 1 }}
            >
              Duplicate
            </Button>
            <Button
              size="small"
              variant={repeatOpen ? "contained" : "outlined"}
              startIcon={<RepeatIcon fontSize="small" />}
              onClick={() => setRepeatOpen(!repeatOpen)}
              sx={{ fontSize: "0.7rem", py: 0.4, flex: 1 }}
            >
              Repeat
            </Button>
          </Box>

          <Collapse in={repeatOpen} timeout="auto">
            <Box sx={{ p: 1, bgcolor: "rgba(255,255,255,0.04)", borderRadius: 1, display: "flex", flexDirection: "column", gap: 1 }}>
              <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.7)", fontWeight: 600 }}>
                REPEAT / LINEAR ARRAY
              </Typography>
              <Box sx={{ display: "flex", gap: 1 }}>
                <TextField
                  size="small"
                  label="Count"
                  type="number"
                  value={repeatCount}
                  onChange={(e) => setRepeatCount(Math.max(1, parseInt(e.target.value) || 1))}
                  sx={{ width: 80, "& input": { fontSize: "0.75rem", py: 0.5 } }}
                />
                <TextField
                  size="small"
                  label="ΔX (m)"
                  type="number"
                  value={repeatDeltaX}
                  onChange={(e) => setRepeatDeltaX(parseFloat(e.target.value) || 0)}
                  sx={{ "& input": { fontSize: "0.75rem", py: 0.5 } }}
                />
                <TextField
                  size="small"
                  label="ΔY (m)"
                  type="number"
                  value={repeatDeltaY}
                  onChange={(e) => setRepeatDeltaY(parseFloat(e.target.value) || 0)}
                  sx={{ "& input": { fontSize: "0.75rem", py: 0.5 } }}
                />
              </Box>
              <Button
                size="small"
                variant="contained"
                color="secondary"
                onClick={() => {
                  repeatSelected(repeatCount, repeatDeltaX, repeatDeltaY);
                  setRepeatOpen(false);
                }}
                sx={{ fontSize: "0.7rem", py: 0.4 }}
              >
                Generate Copies
              </Button>
            </Box>
          </Collapse>

          <Button
            size="small"
            variant="outlined"
            color="error"
            startIcon={<DeleteOutlineIcon fontSize="small" />}
            onClick={() => deleteSelected()}
            sx={{ fontSize: "0.7rem", py: 0.4 }}
          >
            Delete {count} Components
          </Button>

          {/* Save to DXF */}
          <Button
            size="small"
            variant="contained"
            color={savedSuccess ? "success" : "primary"}
            startIcon={savedSuccess ? <CheckCircleOutlineIcon fontSize="small" /> : <SaveIcon fontSize="small" />}
            onClick={handleSaveToDxf}
            disabled={saving}
            sx={{ mt: 0.5, fontSize: "0.75rem", fontWeight: 600 }}
          >
            {saving ? "Saving DXF..." : savedSuccess ? "Saved to DXF!" : "Save Changes to DXF"}
          </Button>
        </Box>
      </Paper>
    );
  }

  if (!selectedComponentId) return null;

  const comp = components.find((c) => c.id === selectedComponentId);
  if (!comp) return null;

  const mut = movedComponents[selectedComponentId];
  if (mut?.isDeleted) return null;

  const curDx = mut?.dx ?? 0;
  const curDy = mut?.dy ?? 0;
  const currentX = (comp.anchor[0] + curDx).toFixed(3);
  const currentY = (comp.anchor[1] + curDy).toFixed(3);

  const tags = { ...(comp.tags || {}), ...(mut?.tags || {}) };
  const tagKeys = Object.keys(tags);

  const currentName =
    mut?.tags?.NAME ??
    mut?.tags?.TEXT ??
    mut?.tags?.["RFID_TAG_NO."] ??
    mut?.tags?.["FM_NO."] ??
    mut?.tags?.["LOCATION_(M)"] ??
    mut?.tags?.POINT_NO ??
    mut?.tags?.TRACK_NO ??
    mut?.tags?.TIN_NO ??
    (comp.name.includes(":") ? comp.name.split(":")[1].trim() : comp.name);

  const handleNameChange = (val: string) => {
    const updatedTags: Record<string, string> = { NAME: val, TEXT: val };
    if ("RFID_TAG_NO." in tags) updatedTags["RFID_TAG_NO."] = val;
    if ("FM_NO." in tags) updatedTags["FM_NO."] = val;
    if ("LOCATION_(M)" in tags) updatedTags["LOCATION_(M)"] = val;
    if ("POINT_NO" in tags) updatedTags["POINT_NO"] = val;
    if ("TRACK_NO" in tags) updatedTags["TRACK_NO"] = val;
    if ("TIN_NO" in tags) updatedTags["TIN_NO"] = val;
    if ("A_END_POINT_NO." in tags) updatedTags["A_END_POINT_NO."] = val;
    if ("B_END_POINT_NO." in tags) updatedTags["B_END_POINT_NO."] = val;
    updateComponent(comp.id, { tags: updatedTags }, true);
  };

  const handleTagChange = (k: string, val: string) => {
    updateComponent(
      comp.id,
      {
        tags: {
          [k]: val,
          ...(k === "TEXT" || k === "NAME" || k === "RFID_TAG_NO." || k === "FM_NO." || k === "LOCATION_(M)" || k === "POINT_NO" || k === "TRACK_NO" || k === "TIN_NO"
            ? { NAME: val, TEXT: val }
            : {}),
        },
      },
      true
    );
  };

  const handleNudge = (dx: number, dy: number) => {
    moveComponent(comp.id, curDx + dx, curDy + dy, true);
  };

  const handleReset = () => {
    moveComponent(comp.id, 0, 0, true);
  };

  const handleDelete = () => {
    deleteComponent(comp.id, true);
  };

  return (
    <Paper
      elevation={8}
      sx={{
        position: "absolute",
        bottom: 36,
        left: 12,
        width: 320,
        maxHeight: "calc(100vh - 120px)",
        display: "flex",
        flexDirection: "column",
        bgcolor: "rgba(20, 24, 30, 0.95)",
        backdropFilter: "blur(12px)",
        border: "1px solid rgba(255, 255, 255, 0.15)",
        borderRadius: 2,
        color: "#f0f2f5",
        zIndex: 20,
        overflow: "hidden",
        boxShadow: "0 12px 32px rgba(0,0,0,0.6)",
      }}
    >
      {/* Header bar */}
      <Box
        sx={{
          px: 1.5,
          py: 0.75,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
          bgcolor: "rgba(35, 42, 54, 0.9)",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
          <Chip
            size="small"
            label={comp.category.toUpperCase()}
            sx={{
              height: 18,
              fontSize: "0.65rem",
              fontWeight: 700,
              bgcolor: "primary.main",
              color: "#fff",
            }}
          />
          <Typography
            variant="caption"
            sx={{
              fontWeight: 600,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: "0.8rem",
            }}
          >
            {comp.name}
          </Typography>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center" }}>
          <IconButton size="small" onClick={() => setExpanded(!expanded)} sx={{ color: "#aaa" }}>
            {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
          </IconButton>
          <IconButton size="small" onClick={() => selectComponent(null)} sx={{ color: "#aaa" }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      </Box>

      {/* Body content */}
      <Collapse in={expanded} timeout="auto">
        <Box sx={{ p: 1.5, display: "flex", flexDirection: "column", gap: 1.2, overflowY: "auto", maxHeight: 380 }}>
          {/* Label / Identifier Input */}
          <Box>
            <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.6)", fontWeight: 600 }}>
              LABEL / IDENTIFIER
            </Typography>
            <TextField
              fullWidth
              size="small"
              value={currentName}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Enter name or label..."
              sx={{
                mt: 0.5,
                "& input": { fontSize: "0.8rem", py: 0.7, fontWeight: 600, color: "#fff" },
                "& .MuiOutlinedInput-root": { bgcolor: "rgba(255,255,255,0.05)" },
              }}
            />
          </Box>

          {/* Metadata */}
          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, fontSize: "0.75rem" }}>
            <Box>
              <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.5)" }}>Layer</Typography>
              <Typography variant="body2" sx={{ fontWeight: 500, fontSize: "0.75rem" }}>{comp.layer}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.5)" }}>Color</Typography>
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: comp.color, border: "1px solid #fff" }} />
                <Typography variant="body2" sx={{ fontSize: "0.75rem" }}>{comp.color}</Typography>
              </Box>
            </Box>
          </Box>

          {/* Coordinates & Nudge Controls */}
          <Divider sx={{ borderColor: "rgba(255, 255, 255, 0.08)" }} />
          <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.5)", fontWeight: 600 }}>
            COORDINATES (CAD World)
          </Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1 }}>
            <TextField
              size="small"
              label="X"
              value={currentX}
              InputProps={{ readOnly: true }}
              sx={{ "& input": { fontSize: "0.75rem", py: 0.6 } }}
            />
            <TextField
              size="small"
              label="Y"
              value={currentY}
              InputProps={{ readOnly: true }}
              sx={{ "& input": { fontSize: "0.75rem", py: 0.6 } }}
            />
          </Box>

          {/* Nudge / Move Controls */}
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mt: 0.5 }}>
            <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.5)" }}>
              Step: {stepSize}m
            </Typography>
            <Box sx={{ display: "flex", gap: 0.5 }}>
              {[1, 5, 10].map((s) => (
                <Chip
                  key={s}
                  size="small"
                  label={`${s}m`}
                  clickable
                  variant={stepSize === s ? "filled" : "outlined"}
                  color={stepSize === s ? "primary" : "default"}
                  onClick={() => setStepSize(s)}
                  sx={{ height: 20, fontSize: "0.65rem" }}
                />
              ))}
            </Box>
          </Box>
          <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 1 }}>
            <IconButton size="small" onClick={() => handleNudge(-stepSize, 0)} sx={{ border: "1px solid rgba(255,255,255,0.2)" }}>
              <ArrowBackIcon fontSize="small" />
            </IconButton>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
              <IconButton size="small" onClick={() => handleNudge(0, stepSize)} sx={{ border: "1px solid rgba(255,255,255,0.2)" }}>
                <ArrowUpwardIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" onClick={() => handleNudge(0, -stepSize)} sx={{ border: "1px solid rgba(255,255,255,0.2)" }}>
                <ArrowDownwardIcon fontSize="small" />
              </IconButton>
            </Box>
            <IconButton size="small" onClick={() => handleNudge(stepSize, 0)} sx={{ border: "1px solid rgba(255,255,255,0.2)" }}>
              <ArrowForwardIcon fontSize="small" />
            </IconButton>
          </Box>

          {/* Tags / Attributes Editor */}
          {tagKeys.length > 0 && (
            <>
              <Divider sx={{ borderColor: "rgba(255, 255, 255, 0.08)" }} />
              <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.5)", fontWeight: 600 }}>
                TAGS & ATTRIBUTES
              </Typography>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {tagKeys.map((k) => (
                  <TextField
                    key={k}
                    size="small"
                    label={k}
                    value={tags[k]}
                    onChange={(e) => handleTagChange(k, e.target.value)}
                    sx={{
                      "& input": { fontSize: "0.75rem", py: 0.6 },
                      "& label": { fontSize: "0.75rem" },
                    }}
                  />
                ))}
              </Box>
            </>
          )}

          {/* Component Authoring Tools: Duplicate & Repeat Array */}
          <Divider sx={{ borderColor: "rgba(255, 255, 255, 0.08)" }} />
          <Box sx={{ display: "flex", gap: 1 }}>
            <Tooltip title="Duplicate component (Ctrl+D)">
              <Button
                size="small"
                variant="outlined"
                startIcon={<ContentCopyIcon fontSize="small" />}
                onClick={() => duplicateSelected()}
                sx={{ fontSize: "0.7rem", py: 0.4, flex: 1 }}
              >
                Duplicate
              </Button>
            </Tooltip>
            <Tooltip title="Repeat along axis (Linear Array)">
              <Button
                size="small"
                variant={repeatOpen ? "contained" : "outlined"}
                startIcon={<RepeatIcon fontSize="small" />}
                onClick={() => setRepeatOpen(!repeatOpen)}
                sx={{ fontSize: "0.7rem", py: 0.4, flex: 1 }}
              >
                Repeat
              </Button>
            </Tooltip>
          </Box>

          <Collapse in={repeatOpen} timeout="auto">
            <Box sx={{ p: 1, bgcolor: "rgba(255,255,255,0.04)", borderRadius: 1, display: "flex", flexDirection: "column", gap: 1 }}>
              <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.7)", fontWeight: 600 }}>
                REPEAT / LINEAR ARRAY
              </Typography>
              <Box sx={{ display: "flex", gap: 1 }}>
                <TextField
                  size="small"
                  label="Count"
                  type="number"
                  value={repeatCount}
                  onChange={(e) => setRepeatCount(Math.max(1, parseInt(e.target.value) || 1))}
                  sx={{ width: 80, "& input": { fontSize: "0.75rem", py: 0.5 } }}
                />
                <TextField
                  size="small"
                  label="ΔX (m)"
                  type="number"
                  value={repeatDeltaX}
                  onChange={(e) => setRepeatDeltaX(parseFloat(e.target.value) || 0)}
                  sx={{ "& input": { fontSize: "0.75rem", py: 0.5 } }}
                />
                <TextField
                  size="small"
                  label="ΔY (m)"
                  type="number"
                  value={repeatDeltaY}
                  onChange={(e) => setRepeatDeltaY(parseFloat(e.target.value) || 0)}
                  sx={{ "& input": { fontSize: "0.75rem", py: 0.5 } }}
                />
              </Box>
              <Button
                size="small"
                variant="contained"
                color="secondary"
                onClick={() => {
                  repeatSelected(repeatCount, repeatDeltaX, repeatDeltaY);
                  setRepeatOpen(false);
                }}
                sx={{ fontSize: "0.7rem", py: 0.4 }}
              >
                Generate {repeatCount} Copies
              </Button>
            </Box>
          </Collapse>

          {/* Action buttons */}
          <Divider sx={{ borderColor: "rgba(255, 255, 255, 0.08)" }} />
          <Box sx={{ display: "flex", gap: 1, justifyContent: "space-between" }}>
            <Tooltip title="Reset to original CAD position">
              <Button
                size="small"
                variant="outlined"
                startIcon={<RestartAltIcon fontSize="small" />}
                onClick={handleReset}
                disabled={curDx === 0 && curDy === 0}
                sx={{ fontSize: "0.7rem", py: 0.4 }}
              >
                Reset
              </Button>
            </Tooltip>
            <Tooltip title="Delete component from drawing">
              <Button
                size="small"
                variant="outlined"
                color="error"
                startIcon={<DeleteOutlineIcon fontSize="small" />}
                onClick={handleDelete}
                sx={{ fontSize: "0.7rem", py: 0.4 }}
              >
                Delete
              </Button>
            </Tooltip>
          </Box>

          {/* Save to DXF */}
          <Button
            size="small"
            variant="contained"
            color={savedSuccess ? "success" : "primary"}
            startIcon={savedSuccess ? <CheckCircleOutlineIcon fontSize="small" /> : <SaveIcon fontSize="small" />}
            onClick={handleSaveToDxf}
            disabled={saving}
            sx={{ mt: 0.5, fontSize: "0.75rem", fontWeight: 600 }}
          >
            {saving ? "Saving DXF..." : savedSuccess ? "Saved to DXF!" : "Save Changes to DXF"}
          </Button>
        </Box>
      </Collapse>
    </Paper>
  );
}
