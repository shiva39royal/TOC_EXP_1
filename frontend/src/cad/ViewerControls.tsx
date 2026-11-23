import AddIcon from "@mui/icons-material/Add";
import BorderAllIcon from "@mui/icons-material/BorderAll";
import ContrastIcon from "@mui/icons-material/Contrast";
import DownloadIcon from "@mui/icons-material/Download";
import FactCheckIcon from "@mui/icons-material/FactCheck";
import FitScreenIcon from "@mui/icons-material/FitScreen";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import FullscreenExitIcon from "@mui/icons-material/FullscreenExit";
import FullscreenIcon from "@mui/icons-material/Fullscreen";
import ImageIcon from "@mui/icons-material/Image";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import LineWeightIcon from "@mui/icons-material/LineWeight";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import PanToolIcon from "@mui/icons-material/PanTool";
import RemoveIcon from "@mui/icons-material/Remove";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import NearMeIcon from "@mui/icons-material/NearMe";
import OpenWithIcon from "@mui/icons-material/OpenWith";
import UndoIcon from "@mui/icons-material/Undo";
import RedoIcon from "@mui/icons-material/Redo";
import SaveIcon from "@mui/icons-material/Save";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ContentPasteIcon from "@mui/icons-material/ContentPaste";
import ControlPointDuplicateIcon from "@mui/icons-material/ControlPointDuplicate";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import MapIcon from "@mui/icons-material/Map";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import {
  AppBar,
  Badge,
  Box,
  Button,
  CircularProgress,
  Divider,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { exportDxfUrl, modifyDrawing, originalUrl, getXTractorTables } from "../services/cadApi";
import { openDwg } from "../store/session";
import { useViewerStore } from "../store/viewerStore";
import type { CadViewerHandle } from "./CadViewer";

interface Props {
  viewer: React.RefObject<CadViewerHandle>;
  fullscreen: boolean;
  onFullscreen(): void;
  onInfo(el: HTMLElement): void;
  onValidate(): void;
}

export default function ViewerControls({ viewer, fullscreen, onFullscreen, onInfo, onValidate }: Props) {
  const {
    selectedTool,
    backgroundMode,
    showGrid,
    showLineweights,
    documentId,
    fileName,
    history,
    historyIndex,
    movedComponents,
    selectedComponentId,
    selectedComponentIds,
    stagedAdditions,
    clipboard,
    activeView,
    kavachData,
    setActiveView,
    setKavachData,
    patch,
    undo,
    redo,
    copySelected,
    paste,
    duplicateSelected,
    deleteSelected,
    setComponents,
    clearSavedModifications,
  } = useViewerStore();

  const input = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const close = () => setMenu(null);

  const handleStartXtract = async () => {
    if (!documentId) return;
    setExtracting(true);
    patch({ xtractorLoading: true });
    try {
      const data = await getXTractorTables(documentId);
      setKavachData(data);
      setActiveView("preview");
    } catch (err) {
      console.error("X-Tractor extraction failed:", err);
    } finally {
      setExtracting(false);
      patch({ xtractorLoading: false });
    }
  };

  const hasSelection = (selectedComponentIds && selectedComponentIds.size > 0) || !!selectedComponentId;
  const unsavedCount = Object.keys(movedComponents).length + Object.keys(stagedAdditions).length;

  const handleSaveAll = async () => {
    if (!documentId || unsavedCount === 0) return;
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
      viewer.current?.reload();
    } catch (e) {
      console.error("Failed to save changes", e);
    } finally {
      setSaving(false);
    }
  };

  // Keyboard shortcuts for Undo/Redo/Delete/Copy/Paste/Duplicate/Save
  useEffect(() => {
    const handleKeys = (e: KeyboardEvent) => {
      if (["INPUT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
        e.preventDefault();
        copySelected();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
        e.preventDefault();
        paste();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicateSelected();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void handleSaveAll();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (hasSelection) {
          e.preventDefault();
          deleteSelected();
        }
      }
    };
    window.addEventListener("keydown", handleKeys);
    return () => window.removeEventListener("keydown", handleKeys);
  }, [hasSelection, clipboard, movedComponents, stagedAdditions, historyIndex]);

  const exportPng = async () => {
    close();
    const blob = await viewer.current?.exportPng();
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (fileName ?? "drawing").replace(/\.dwg$/i, "") + ".png";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const tip = (
    label: string,
    icon: React.ReactNode,
    onClick: (e: React.MouseEvent<HTMLElement>) => void,
    active = false,
    disabled = false
  ) => (
    <Tooltip title={label}>
      <span>
        <IconButton
          aria-label={label}
          onClick={onClick}
          disabled={disabled}
          color={active ? "primary" : "default"}
          sx={active ? { bgcolor: "action.selected" } : undefined}
        >
          {icon}
        </IconButton>
      </span>
    </Tooltip>
  );

  return (
    <AppBar position="static" sx={{ borderBottom: 1, borderColor: "divider", bgcolor: "background.paper", backgroundImage: "none" }}>
      <Toolbar variant="dense" disableGutters sx={{ minHeight: 40, px: 1, gap: 0.25 }}>
        <Typography sx={{ fontWeight: 600, mr: 1.5, letterSpacing: "-0.01em" }}>CAD Fast Viewer</Typography>
        <input ref={input} type="file" accept=".dwg" hidden
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void openDwg(f); }} />
        <Button startIcon={<FolderOpenIcon fontSize="small" />} onClick={() => input.current?.click()}>Open DWG</Button>
        <Button startIcon={<RestartAltIcon fontSize="small" />} color="inherit" onClick={() => {
          const docId = useViewerStore.getState().documentId;
          if (docId) {
            fetch(`/api/v1/cad/${docId}`, { method: "DELETE" }).catch(() => {});
          }
          useViewerStore.getState().reset();
        }}>Close</Button>
        <Divider orientation="vertical" flexItem sx={{ mx: 0.75, my: 1 }} />

        {/* CAD Tools */}
        {tip("Select Component / Grips", <NearMeIcon fontSize="small" />, () => patch({ selectedTool: "select" }), selectedTool === "select")}
        {tip("Pan canvas (Hold Space)", <PanToolIcon fontSize="small" />, () => patch({ selectedTool: "pan" }), selectedTool === "pan")}
        {tip("Move Tool", <OpenWithIcon fontSize="small" />, () => patch({ selectedTool: "select" }), selectedTool === "move")}
        {tip("Undo (Ctrl+Z)", <UndoIcon fontSize="small" />, () => undo(), false, historyIndex < 0)}
        {tip("Redo (Ctrl+Y)", <RedoIcon fontSize="small" />, () => redo(), false, historyIndex >= history.length - 1)}
        <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 1 }} />
        {tip("Copy Component (Ctrl+C)", <ContentCopyIcon fontSize="small" />, () => copySelected(), false, !hasSelection)}
        {tip("Paste Component (Ctrl+V)", <ContentPasteIcon fontSize="small" />, () => paste(), false, clipboard.length === 0)}
        {tip("Duplicate Component (Ctrl+D)", <ControlPointDuplicateIcon fontSize="small" />, () => duplicateSelected(), false, !hasSelection)}
        {tip("Delete Component (Del)", <DeleteOutlineIcon fontSize="small" />, () => deleteSelected(), false, !hasSelection)}

        <Divider orientation="vertical" flexItem sx={{ mx: 0.75, my: 1 }} />
        {tip("Fit drawing (F)", <FitScreenIcon fontSize="small" />, () => viewer.current?.fit())}
        {tip("Zoom in (+)", <AddIcon fontSize="small" />, () => viewer.current?.zoomIn())}
        {tip("Zoom out (−)", <RemoveIcon fontSize="small" />, () => viewer.current?.zoomOut())}
        {tip("Reset view", <RestartAltIcon fontSize="small" />, () => { patch({ selectedTool: "select" }); viewer.current?.fit(); })}
        {tip(fullscreen ? "Exit fullscreen" : "Fullscreen", fullscreen ? <FullscreenExitIcon fontSize="small" /> : <FullscreenIcon fontSize="small" />, onFullscreen)}

        <Box sx={{ flex: 1 }} />

        {/* View Switcher: Layout View | Preview & Export */}
        {documentId && (
          <Box sx={{ display: "flex", alignItems: "center", bgcolor: "action.hover", borderRadius: 1, p: 0.25, gap: 0.5, mr: 1.5 }}>
            <Button
              size="small"
              startIcon={<MapIcon fontSize="small" />}
              variant={activeView === "layout" ? "contained" : "text"}
              color={activeView === "layout" ? "primary" : "inherit"}
              onClick={() => setActiveView("layout")}
              sx={{ height: 28, textTransform: "none", fontSize: "0.75rem", fontWeight: 600, px: 1.5 }}
            >
              Layout View
            </Button>
            <Button
              size="small"
              startIcon={<PictureAsPdfIcon fontSize="small" />}
              variant={activeView === "preview" ? "contained" : "text"}
              color={activeView === "preview" ? "primary" : "inherit"}
              disabled={!kavachData && !extracting}
              onClick={() => setActiveView("preview")}
              sx={{ height: 28, textTransform: "none", fontSize: "0.75rem", fontWeight: 600, px: 1.5 }}
            >
              Preview & Export
            </Button>
          </Box>
        )}

        {/* Prominent Start X-Tract Button */}
        {documentId && (
          <Button
            variant="contained"
            size="small"
            disabled={extracting}
            startIcon={extracting ? <CircularProgress size={14} color="inherit" /> : <PlayArrowIcon />}
            onClick={handleStartXtract}
            sx={{
              mr: 1.5,
              height: 28,
              textTransform: "none",
              fontWeight: 700,
              fontSize: "0.78rem",
              bgcolor: kavachData ? "#0284c7" : "#059669",
              color: "#ffffff",
              "&:hover": {
                bgcolor: kavachData ? "#0369a1" : "#047857",
              },
            }}
          >
            {extracting ? "Extracting..." : kavachData ? "⚡ Re-Extract" : "▶ Start X-Tract"}
          </Button>
        )}

        {/* Save button with modification counter */}
        {documentId && (
          <Tooltip title={unsavedCount > 0 ? `Save ${unsavedCount} CAD modification(s) to DXF` : "All changes saved"}>
            <span>
              <Button
                variant={unsavedCount > 0 ? "contained" : "outlined"}
                size="small"
                color="primary"
                disabled={unsavedCount === 0 || saving}
                startIcon={
                  <Badge badgeContent={unsavedCount} color="error" invisible={unsavedCount === 0}>
                    <SaveIcon fontSize="small" />
                  </Badge>
                }
                onClick={handleSaveAll}
                sx={{ mr: 1, height: 28, fontSize: "0.75rem" }}
              >
                {saving ? "Saving..." : "Save DXF"}
              </Button>
            </span>
          </Tooltip>
        )}

        {tip("File information", <InfoOutlinedIcon fontSize="small" />, (e) => onInfo(e.currentTarget))}
        {tip("More", <MoreVertIcon fontSize="small" />, (e) => setMenu(e.currentTarget))}

        <Menu anchorEl={menu} open={!!menu} onClose={close} slotProps={{ paper: { sx: { minWidth: 230 } } }}>
          <MenuItem onClick={() => { patch({ backgroundMode: backgroundMode === "dark" ? "light" : "dark" }); close(); }}>
            <ListItemIcon><ContrastIcon fontSize="small" /></ListItemIcon>
            <ListItemText>Background: {backgroundMode === "dark" ? "Dark → Light" : "Light → Dark"}</ListItemText>
          </MenuItem>
          <MenuItem onClick={() => { patch({ showGrid: !showGrid }); close(); }}>
            <ListItemIcon><BorderAllIcon fontSize="small" /></ListItemIcon>
            <ListItemText>{showGrid ? "Hide grid" : "Show grid"}</ListItemText>
          </MenuItem>
          <MenuItem onClick={() => { patch({ showLineweights: !showLineweights }); close(); }}>
            <ListItemIcon><LineWeightIcon fontSize="small" /></ListItemIcon>
            <ListItemText>{showLineweights ? "Hide lineweights" : "Show lineweights"}</ListItemText>
          </MenuItem>
          <Divider />
          <MenuItem onClick={exportPng}>
            <ListItemIcon><ImageIcon fontSize="small" /></ListItemIcon>
            <ListItemText>Export view as PNG</ListItemText>
          </MenuItem>
          {documentId && (
            <MenuItem component="a" href={exportDxfUrl(documentId)} download onClick={close}>
              <ListItemIcon><DownloadIcon fontSize="small" /></ListItemIcon>
              <ListItemText>Export Modified DXF</ListItemText>
            </MenuItem>
          )}
          <MenuItem component="a" href={documentId ? originalUrl(documentId) : undefined} download onClick={close}>
            <ListItemIcon><DownloadIcon fontSize="small" /></ListItemIcon>
            <ListItemText>Download original DWG</ListItemText>
          </MenuItem>
          <Divider />
          <MenuItem onClick={() => { close(); onValidate(); }}>
            <ListItemIcon><FactCheckIcon fontSize="small" /></ListItemIcon>
            <ListItemText>Validation view (developer)</ListItemText>
          </MenuItem>
        </Menu>
      </Toolbar>
    </AppBar>
  );
}
