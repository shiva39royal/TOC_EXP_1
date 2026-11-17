// @ts-nocheck -- ported from the original app (written for a looser TS config)
import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, FileCode2, KeyRound, Loader2, Upload, X } from 'lucide-react';
import type { StationProject } from '../types/signalling';
import { EXTRACTION_PROVIDERS, type ExtractionProvider } from '../types/extractionProvider';
import { analyzeUploadedLayouts } from '../utils/layoutAnalysisClient';

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProjectCreated: (project: StationProject) => void;
}

export interface QueuedCadFile {
  name: string;
  size: number;
  mimeType: string;
  base64Data: string;
}

export function validateCadFileExtension(fileName: string): string | null {
  const lower = fileName.trim().toLowerCase();
  if (lower.endsWith('.dwg') || lower.endsWith('.dxf') || lower.endsWith('.pdf')) {
    return null;
  }
  const ext = lower.includes('.') ? `.${lower.split('.').pop()}` : 'unknown';
  return `Unsupported file format "${fileName}" (${ext}). Supported layout formats are .dwg, .dxf, and .pdf.`;
}

export const UploadModal: React.FC<UploadModalProps> = ({ isOpen, onClose, onProjectCreated }) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [queuedFiles, setQueuedFiles] = useState<QueuedCadFile[]>([]);
  const [provider, setProvider] = useState<ExtractionProvider>('offline');
  const [apiKey, setApiKey] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [stepLabel, setStepLabel] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) setApiKey('');
  }, [isOpen]);

  if (!isOpen) return null;

  const selectedProvider = EXTRACTION_PROVIDERS.find((item) => item.value === provider)!;

  const readFileAsBase64 = (file: File): Promise<QueuedCadFile> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const base64 = result.includes(',') ? result.split(',')[1] : result;
        resolve({
          name: file.name,
          size: file.size,
          mimeType: file.type || 'application/octet-stream',
          base64Data: base64,
        });
      };
      reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
      reader.readAsDataURL(file);
    });

  const handleFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setErrorMsg(null);
    const selected = Array.from(fileList);
    if (selected.length > 1) {
      setErrorMsg('Upload one layout file at a time.');
      return;
    }

    const file = selected[0];
    const extErr = validateCadFileExtension(file.name);
    if (extErr) {
      setErrorMsg(extErr);
      return;
    }

    try {
      const loaded = await readFileAsBase64(file);
      setQueuedFiles([loaded]);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to read uploaded CAD file.');
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    void handleFilesSelected(e.dataTransfer.files);
  };

  const handleAnalyze = async () => {
    if (queuedFiles.length === 0) {
      setErrorMsg('Please select a valid layout file (.dwg, .dxf, or .pdf).');
      return;
    }
    if (provider !== 'offline' && !apiKey.trim()) {
      setErrorMsg(`Enter your ${selectedProvider.label} API key, or choose Offline (no AI).`);
      return;
    }

    setIsAnalyzing(true);
    setErrorMsg(null);
    setStepLabel('1/3 Decoding the layout and rendering high-resolution drawing sections...');

    try {
      const validatedProject = await analyzeUploadedLayouts({
        files: queuedFiles.map((f) => ({
          name: f.name,
          mimeType: f.mimeType,
          base64Data: f.base64Data,
        })),
        provider,
        apiKey: apiKey.trim() || undefined,
        onProgress: (label) => setStepLabel(label),
      });

      onProjectCreated(validatedProject);
      setQueuedFiles([]);
      setApiKey('');
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unexpected layout analysis error.');
    } finally {
      setIsAnalyzing(false);
      setStepLabel('');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="upload-modal-title"
    >
      <div className="bg-white border border-slate-200 rounded-lg max-w-2xl w-full p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-200">
          <div>
            <h2 id="upload-modal-title" className="text-lg font-display font-semibold text-slate-900">
              Upload RFID Layout (.dwg / .dxf / .pdf)
            </h2>
            <p className="text-sm text-slate-600 mt-1">
              Upload one drawing. Extraction uses only evidence visible in that file.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isAnalyzing}
            className="p-1.5 text-slate-500 hover:text-slate-900 rounded hover:bg-slate-100 cursor-pointer"
            aria-label="Close upload dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-5 space-y-5">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className="border border-dashed border-slate-300 hover:border-blue-600 bg-slate-50 hover:bg-blue-50/30 rounded-lg p-6 text-center transition-colors cursor-pointer"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".dwg,.dxf,.pdf"
              className="hidden"
              aria-label="Layout file"
              onChange={(e) => void handleFilesSelected(e.target.files)}
            />
            <Upload className="w-7 h-7 text-blue-700 mx-auto mb-2" aria-hidden="true" />
            <p className="text-sm font-medium text-slate-900">
              Click to browse or drop one layout file (.dwg, .dxf, or .pdf) <span className="text-red-700">*</span>
            </p>
            <p className="text-xs text-slate-500 mt-1">Required · Supported formats: .DWG · .DXF · .PDF</p>
          </div>

          {queuedFiles.length > 0 && (
            <div className="border border-slate-200 rounded-md divide-y divide-slate-200">
              {queuedFiles.map((file, idx) => (
                <div key={`${file.name}-${idx}`} className="flex items-center justify-between px-3 py-2 text-sm">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <FileCode2 className="w-4 h-4 text-blue-700 shrink-0" aria-hidden="true" />
                    <span className="font-medium text-slate-800 truncate">{file.name}</span>
                    <span className="text-xs font-mono tabular-nums text-slate-500 shrink-0">
                      {(file.size / 1024).toFixed(1)} KB
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setQueuedFiles([])}
                    disabled={isAnalyzing}
                    className="text-xs text-slate-500 hover:text-red-700 px-2 py-1 cursor-pointer"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="extraction-provider" className="block text-xs font-medium text-slate-700 mb-1.5">
                Extraction Provider
              </label>
              <select
                id="extraction-provider"
                value={provider}
                disabled={isAnalyzing}
                onChange={(e) => {
                  setProvider(e.target.value as ExtractionProvider);
                  setApiKey('');
                  setErrorMsg(null);
                }}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white text-slate-900 focus:outline-none focus:border-blue-600"
              >
                {EXTRACTION_PROVIDERS.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="provider-api-key" className="block text-xs font-medium text-slate-700 mb-1.5">
                API Key <span className="font-normal text-slate-500">(only for online AI)</span>
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
                <input
                  id="provider-api-key"
                  type="password"
                  value={apiKey}
                  disabled={isAnalyzing || provider === 'offline'}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={selectedProvider.keyPlaceholder}
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={512}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600 disabled:bg-slate-50 disabled:text-slate-500"
                />
              </div>
            </div>
          </div>

          <p className="text-xs text-slate-500 -mt-2">
            Offline is the default: no key, AI, upload or internet is used. An online key is sent only with that request and is never saved.
          </p>

          {errorMsg && (
            <div className="flex items-start gap-2.5 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-800" role="alert">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-700" aria-hidden="true" />
              <span>{errorMsg}</span>
            </div>
          )}

          {isAnalyzing && (
            <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-md text-sm text-blue-900" role="status">
              <Loader2 className="w-4 h-4 animate-spin text-blue-700 shrink-0" aria-hidden="true" />
              <span>{stepLabel}</span>
            </div>
          )}
        </div>

        <div className="mt-6 pt-4 border-t border-slate-200 flex items-center justify-between gap-4">
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <CheckCircle2 className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
            <span>Only source-backed drawing data is added to the workbench</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isAnalyzing}
              className="px-4 py-2 text-xs font-medium text-slate-700 hover:text-slate-900 border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer whitespace-nowrap"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleAnalyze()}
              disabled={isAnalyzing || queuedFiles.length === 0}
              className="px-5 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-md transition-colors cursor-pointer whitespace-nowrap"
            >
              {isAnalyzing ? 'Processing...' : 'Proceed'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
