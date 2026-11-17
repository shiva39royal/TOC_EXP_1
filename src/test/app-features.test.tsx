import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TrackSchematicView } from '@/components/TrackSchematicView';
import { TopNav } from '@/components/TopNav';
import { clearAllStoredData, clearLocalProjects } from '@/utils/projectStore';
import type { StationProject } from '@/types/signalling';

const mockProject: StationProject = {
  id: 'proj-1',
  metadata: {
    stationName: 'CHITGIDDA',
    stationCode: 'CTF',
    stationId: '520',
    chainageDirection: 'LEFT_INCREASING',
    nextUpStationId: '503',
    nextDownStationId: '521',
    refSip: 'SIP-520',
    refLayout: 'CTF-TOC-2024',
    tableFormatVersion: 'RDSO-SPN-196',
  },
  routes: [],
  signals: [],
  points: [],
  tracks: [],
  tags: [],
  levelCrossings: [{ id: 'lc-1', name: 'LC-49', chainageM: 1000 }],
  validationIssues: [],
  auditLog: [],
  sourceLayout: {
    kind: 'PDF',
    fileName: 'CTF_station.pdf',
    pageCount: 1,
    fileSize: 1024,
  },
  sourceSummary: 'Layout telemetry summary notes',
};

describe('CAD Metadata & Station Info UI display', () => {
  it('displays only the 7 allowed fields in CAD Metadata & Station Info area and no telemetry or summary', () => {
    render(
      <TrackSchematicView
        project={mockProject}
        selectedRouteSlNo={null}
        onSelectRoute={vi.fn()}
        onJumpToValidation={vi.fn()}
      />
    );

    // Verify allowed fields are visible
    expect(screen.getByText('CAD Metadata & Station Info')).toBeInTheDocument();
    expect(screen.getByText('Station Name')).toBeInTheDocument();
    expect(screen.getByText('CHITGIDDA')).toBeInTheDocument();
    expect(screen.getByText('Station Code')).toBeInTheDocument();
    expect(screen.getByText('CTF')).toBeInTheDocument();
    expect(screen.getByText('Station ID')).toBeInTheDocument();
    expect(screen.getByText('520')).toBeInTheDocument();
    expect(screen.getByText('Chainage Direction')).toBeInTheDocument();
    expect(screen.getByText('← Inc. Left')).toBeInTheDocument();
    expect(screen.getByText('Left Adjacent')).toBeInTheDocument();
    expect(screen.getByText('503')).toBeInTheDocument();
    expect(screen.getByText('Right Adjacent')).toBeInTheDocument();
    expect(screen.getByText('521')).toBeInTheDocument();
    expect(screen.getByText('Level Crossings')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();

    // Verify other fields and telemetry are NOT displayed in UI
    expect(screen.queryByText('Layout File Telemetry')).not.toBeInTheDocument();
    expect(screen.queryByText('Layout telemetry summary notes')).not.toBeInTheDocument();
    expect(screen.queryByText(/Rendered natively from uploaded/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Extracted directly from the uploaded/)).not.toBeInTheDocument();
    expect(screen.queryByText('Session Layout:')).not.toBeInTheDocument();
  });
});

describe('Zoom and TopNav UI features', () => {
  it('includes 3000% in zoom presets in CadDrawingViewer', () => {
    const { container } = render(
      <TrackSchematicView
        project={mockProject}
        selectedRouteSlNo={null}
        onSelectRoute={vi.fn()}
        onJumpToValidation={vi.fn()}
      />
    );

    const zoomSelect = container.querySelector('select[aria-label="Zoom Level Preset"]');
    expect(zoomSelect).toBeInTheDocument();
    const options = Array.from(zoomSelect?.querySelectorAll('option') ?? []).map((o) => o.textContent);
    expect(options).toContain('3000%');
  });

  it('triggers onResetApp when clicking the SignalTOC brand button', () => {
    const handleReset = vi.fn();
    render(<TopNav activeTab="schematic" onSelectTab={vi.fn()} onResetApp={handleReset} />);

    const brandBtn = screen.getByRole('button', { name: 'SignalTOC' });
    fireEvent.click(brandBtn);
    expect(handleReset).toHaveBeenCalledOnce();
  });
});

describe('Storage clear utility', () => {
  it('clearAllStoredData clears local data without throwing', async () => {
    await expect(clearAllStoredData()).resolves.toBeUndefined();
  });

  it('clearLocalProjects clears IDB without throwing', async () => {
    await expect(clearLocalProjects()).resolves.toBeUndefined();
  });
});
