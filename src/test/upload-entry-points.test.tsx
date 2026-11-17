import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TrackSchematicView } from '@/components/TrackSchematicView';
import { analyzeUploadedLayouts } from '@/utils/layoutAnalysisClient';

vi.mock('@/utils/layoutAnalysisClient', () => ({
  analyzeUploadedLayouts: vi.fn(),
}));

describe('upload entry points', () => {
  it('opens the provider dialog instead of extracting directly from the schematic', () => {
    const onOpenUpload = vi.fn();
    const { container } = render(
      <TrackSchematicView
        project={null}
        selectedRouteSlNo={null}
        onSelectRoute={vi.fn()}
        onJumpToValidation={vi.fn()}
        onOpenUpload={onOpenUpload}
      />,
    );

    expect(container.querySelector('input[type="file"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Upload Layout' }));
    expect(onOpenUpload).toHaveBeenCalledOnce();
    expect(analyzeUploadedLayouts).not.toHaveBeenCalled();
  });
});
