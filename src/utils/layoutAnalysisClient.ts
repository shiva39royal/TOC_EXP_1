// @ts-nocheck -- ported from the original app (written for a looser TS config)
import { runEngineeringValidation } from '../engine/validator';
import { extractOfflineProject, type LayoutToken } from '../engine/offlineExtractor';
import type { StationProject } from '../types/signalling';
import type { ExtractionProvider } from '../types/extractionProvider';
import { preparePdfUploadPackage, type PdfRenderedCrop, type PdfUploadPackage } from './pdfImageExtractor';
import { parseCadFileBuffer, isSupportedCadExtension } from './cadParser';
import { readPdfLocally } from './offlineOcr';

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface LocalFileInput {
  name: string;
  mimeType: string;
  base64Data: string;
}

async function safeParseJsonResponse(res: Response): Promise<Record<string, unknown>> {
  const rawText = await res.text();
  const trimmed = rawText.trim();
  if (!trimmed) throw new Error(`Server returned an empty response (HTTP ${res.status}).`);
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    if (res.status === 413) throw new Error('Layout upload exceeded the transport payload limit. Try a smaller file.');
    if (res.status === 502 || res.status === 504) throw new Error(`The online drawing reader took too long (HTTP ${res.status}). Retry, or use Offline (no AI).`);
    throw new Error(`Server returned non-JSON response (HTTP ${res.status}). Please retry.`);
  }
}

function ensureLocatedEvidence(project: StationProject): StationProject {
  const count = project.tags.length + project.signals.length;
  if (count === 0) {
    throw new Error('No RFID tags or signals could be located on this drawing locally. Nothing was invented. Try a clearer drawing or explicitly choose an online AI provider.');
  }
  return project;
}

async function analyzeOffline(params: {
  file: LocalFileInput;
  onProgress?: (label: string) => void;
}): Promise<StationProject> {
  const { file, onProgress } = params;
  const kind = isSupportedCadExtension(file.name);
  if (!kind) throw new Error(`Unsupported file format (${file.name}). Supported layout formats are .dwg, .dxf, and .pdf.`);

  let tokens: LayoutToken[];
  let sourceLayout: StationProject['sourceLayout'];
  let sourceSummary = '';

  if (kind === 'PDF') {
    onProgress?.('1/3 Opening the PDF locally…');
    const read = await readPdfLocally({ base64Pdf: file.base64Data, onProgress });
    tokens = read.tokens;
    sourceLayout = { kind, fileName: file.name, pdfBase64: file.base64Data, pageCount: read.pageCount };
    sourceSummary = read.summary;
  } else {
    onProgress?.(`1/3 Decoding ${file.name} locally…`);
    const parsedCad = await parseCadFileBuffer(base64ToBytes(file.base64Data), file.name, kind);
    tokens = parsedCad.layoutTokens as unknown as LayoutToken[];
    sourceSummary = parsedCad.summary;
    sourceLayout = {
      kind,
      fileName: file.name,
      dxfData: parsedCad.dxfData,
      layerCount: parsedCad.layerCount,
      blockCount: parsedCad.blockCount,
      entityCount: parsedCad.entityCount,
      cadVersion: parsedCad.cadVersion,
    };
  }

  onProgress?.('2/3 Linking labels, chainages, signals, tracks, tags and route distances locally…');
  const project = ensureLocatedEvidence(extractOfflineProject({
    fileName: file.name,
    tokens,
    sourceLayout,
    sourceSummary,
  }));
  onProgress?.('3/3 Running engineering validation locally…');
  return { ...project, validationIssues: runEngineeringValidation(project) };
}

export async function analyzeUploadedLayouts(params: {
  files: LocalFileInput[];
  provider?: ExtractionProvider;
  apiKey?: string;
  onProgress?: (label: string) => void;
}): Promise<StationProject> {
  const { files, provider = 'offline', apiKey, onProgress } = params;
  if (files.length !== 1) throw new Error('Upload exactly one layout file.');

  // Offline is deliberately a separate browser-only path: no fetch, project key, AI model,
  // remote font, OCR download or drawing upload is involved.
  if (provider === 'offline') return analyzeOffline({ file: files[0], onProgress });
  if (!apiKey?.trim()) throw new Error(`Enter your ${provider} API key, or choose Offline (no AI).`);

  onProgress?.(`1/3 Decoding ${files[0].name} and preparing drawing sections…`);
  let primaryLocalPdfBase64: string | undefined;
  const preparedFiles = await Promise.all(files.map(async (file) => {
    const isPdf = file.name.trim().toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      const kind = isSupportedCadExtension(file.name);
      if (kind !== 'DWG' && kind !== 'DXF') throw new Error(`Unsupported file format (${file.name}).`);
      const parsedCad = await parseCadFileBuffer(base64ToBytes(file.base64Data), file.name, kind);
      return { name: file.name, mimeType: file.mimeType, parsedCad };
    }
    primaryLocalPdfBase64 = file.base64Data;
    let crops: PdfRenderedCrop[] = [];
    let extractedText = '';
    let pageCount = 1;
    try {
      const pkg = await preparePdfUploadPackage(file.base64Data);
      crops = pkg.crops;
      extractedText = pkg.extractedText;
      pageCount = pkg.pageCount;
    } catch {
      crops = [];
    }
    const omitRawPdfBytes = crops.length >= 2;
    return {
      name: file.name,
      mimeType: file.mimeType,
      ...(omitRawPdfBytes ? {} : { base64Data: file.base64Data }),
      extractedText,
      pageCount,
      supplementaryImages: crops,
    };
  }));

  onProgress?.('2/3 Sending this drawing to your explicitly selected online AI provider…');
  const res = await fetch('/api/analyze-layout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      files: preparedFiles,
      provider,
      apiKey: apiKey.trim(),
      omitPdfResponse: true,
    }),
  });
  const json = await safeParseJsonResponse(res);
  if (!res.ok || !json.project) throw new Error(String(json.error || 'Layout extraction failed.'));
  let rawProject = json.project as unknown as StationProject;
  if (rawProject.sourceLayout?.kind === 'PDF' && !rawProject.sourceLayout.pdfBase64 && primaryLocalPdfBase64) {
    rawProject = { ...rawProject, sourceLayout: { ...rawProject.sourceLayout, pdfBase64: primaryLocalPdfBase64 } };
  }
  onProgress?.('3/3 Checking source references and running engineering validation…');
  return { ...rawProject, validationIssues: runEngineeringValidation(rawProject) };
}
