import type { Bounds } from "../cad/cadFormat";

export const API_BASE = "http://localhost:8001/api/v1";

export interface LayerCatalogItem {
  id: number;
  name: string;
  color: string;
  isLocked: boolean;
  isVisible: boolean;
  count: number;
}

export interface CategoryItem {
  id: number;
  key: string;
  name: string;
  icon: string;
  description: string;
  count: number;
}

export interface ComponentRecord {
  id: string;
  category: string;
  categoryId: number;
  name: string;
  layer: string;
  layerId: number;
  color: string;
  anchor: [number, number];
  bbox: [number, number, number, number];
  tags: Record<string, string>;
  grips: Array<[number, number]>;
}

export interface ComponentsResponse {
  layers: LayerCatalogItem[];
  categories: CategoryItem[];
  components: ComponentRecord[];
  totalComponents: number;
}

export interface LayoutInfo {
  id: number;
  name: string;
  isModel: boolean;
  entityCount: number;
  bounds: Bounds | null;
  renderUrl: string;
}

export interface CadDocument {
  id: string;
  fileName: string;
  fileSize: number;
  bounds: Bounds | null;
  renderUrl: string;
  defaultLayout: number;
  layouts: LayoutInfo[];
  warnings: string[];
  converter: string;
  categories: CategoryItem[];
  cadLayers: LayerCatalogItem[];
  isFromTables?: boolean;
}

export interface JobInfo {
  jobId: string;
  fileName: string;
  status: string;
  progress: number;
  stage: string;
  error: string | null;
}

export interface StationMeta {
  station_name: string;
  station_id: string;
  station_code: string;
  section: string;
  division: string;
  chainage_km: number;
  sip_no: string;
  toc_no: string;
  rfid_layout_no: string;
  version: string;
}

export interface TableOfControlRow {
  s_no: number;
  entry_signal: string;
  exit_signal: string;
  section_type: string;
  line: string;
  signal_type: string;
  aspect_entry_signal: string;
  requires_aspect_exit_signal: string;
  points_normal: string;
  points_reverse: string;
  requires_track_ckt_up: string;
  tins_requires_free: string;
  tins_requires_free_overlap: string;
  entry_signal_foot_tag: string;
  rfid_sequence_str: string;
  distance_between_signals_m: number;
  movement_authority: string;
  authorized_speed_os: string;
}

export interface BlockSectionDetailsRow {
  last_stop_signal: string;
  distance_to_next_stop_signal_m: number;
  block_section_tin: string;
  movement_direction: string;
  adjacent_line_tins: string;
  next_station_id: string;
  next_station_border_rfid_location: string;
  authorised_speed: string;
  start_dist_abs_loc_reset_m: number;
  abs_loc_correction_m: number;
  loco_direction_after_adj: string;
}

export interface ShuntingLimitRow {
  adjacent_station_name: string;
  direction: string;
  rfid_tag_no: string;
  tin: string;
  absolute_location_m: number;
}

export interface TrackProfileRow {
  s_no: number;
  entry_signal: string;
  exit_signal: string;
  line: string;
  turnout_speed_kmph: string;
  turnout_start_dist_m: string;
  turnout_length_m: string;
  psr_str: string;
  engineering_gradients_str: string;
  average_gradient_value: string;
  gradient_length_m: string;
  lc_distance_m: string;
  lc_id: string;
  lc_manning_type: string;
  lc_class: string;
  lc_auto_whistling: string;
  track_condition_type: string;
  track_condition_start_m: string;
  track_condition_length_m: string;
}

export interface TsrRouteRow {
  s_no: number;
  entry_signal: string;
  exit_signal: string;
  ohe_line: string;
  ohe_line_start_rfid_tag: string;
  tsr_route_id: string;
  entry_signal_dist_from_ohe_start_m: number;
  last_pole_dist_from_exit_signal_m: number;
  ohe_pole_km_data: string;
}

export interface TslWorkingRow {
  tsl_entry_signal: string;
  tsl_exit_signal: string;
  signal_type: string;
  aspect_entry_signal: string;
  requires_aspect_exit_signal: string;
  required_route_command: string;
  points_normal: string;
  points_reverse: string;
  requires_track_ckt_up: string;
  tins_requires_free: string;
  entry_signal_foot_tag: string;
  rfid_sequence_str: string;
}

export interface FullKavachExport {
  station_meta: StationMeta;
  table_of_control: TableOfControlRow[];
  block_section_details: BlockSectionDetailsRow[];
  shunting_limits: ShuntingLimitRow[];
  track_profiles: TrackProfileRow[];
  tsr_routes: TsrRouteRow[];
  tsl_routes: TslWorkingRow[];
  summary: Record<string, any>;
}

// ---------------------------------------------------------------------------
// Native Fetch API Methods
// ---------------------------------------------------------------------------

export async function uploadCadFile(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${API_BASE}/cad/upload`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`CAD upload failed (${res.status}): ${errText || res.statusText}`);
  }

  const data = (await res.json()) as { jobId: string };
  return data.jobId;
}

export async function getJobStatus(jobId: string): Promise<JobInfo> {
  const res = await fetch(`${API_BASE}/cad/jobs/${jobId}`);
  if (!res.ok) throw new Error(`Failed to fetch job ${jobId}`);
  return (await res.json()) as JobInfo;
}

export async function pollCadJob(
  jobId: string,
  onProgress?: (info: JobInfo) => void,
  maxWaitMs = 180000,
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const job = await getJobStatus(jobId);
    onProgress?.(job);

    if (job.status === "completed") {
      return job.jobId;
    }
    if (job.status === "failed") {
      throw new Error(job.error || `CAD processing failed in stage: ${job.stage}`);
    }

    await new Promise((r) => setTimeout(r, 800));
  }
  throw new Error("CAD processing timed out.");
}

export async function getCadDocument(docId: string): Promise<CadDocument> {
  const res = await fetch(`${API_BASE}/cad/${docId}`);
  if (!res.ok) throw new Error(`Failed to fetch CAD document ${docId}`);
  const doc = (await res.json()) as CadDocument;
  doc.categories = doc.categories || [];
  doc.cadLayers = doc.cadLayers || [];

  const modelLayouts = doc.layouts?.filter((l) => l.isModel) || [];
  if (modelLayouts.length > 0) {
    doc.defaultLayout = modelLayouts[0].id;
    doc.renderUrl = modelLayouts[0].renderUrl;
  }
  return doc;
}

export async function getCadComponents(docId: string): Promise<ComponentsResponse> {
  const res = await fetch(`${API_BASE}/cad/${docId}/components`);
  if (!res.ok) throw new Error(`Failed to fetch components for ${docId}`);
  return (await res.json()) as ComponentsResponse;
}

export async function getXTractorData(docId: string): Promise<FullKavachExport> {
  const res = await fetch(`${API_BASE}/cad/${docId}/x-tractor`);
  if (!res.ok) throw new Error(`Failed to fetch X-Tractor KAVACH data for ${docId}`);
  return (await res.json()) as FullKavachExport;
}

export function getCadRenderUrl(docId: string, layout = 0): string {
  return `${API_BASE}/cad/${docId}/render?layout=${layout}`;
}

export function getXTractorExcelUrl(docId: string): string {
  return `${API_BASE}/cad/${docId}/x-tractor/excel`;
}

export function getXTractorCsvUrl(docId: string, tableName: string): string {
  return `${API_BASE}/cad/${docId}/x-tractor/export/${tableName}`;
}
