import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UploadModal } from '@/components/UploadModal';

function renderModal() {
  return render(<UploadModal isOpen onClose={vi.fn()} onProjectCreated={vi.fn()} />);
}

describe('UploadModal', () => {
  it('defaults to offline with no API key or AI required', () => {
    renderModal();

    expect(screen.getByLabelText('Layout file')).toBeInTheDocument();
    expect(screen.getByLabelText('Extraction Provider')).toHaveValue('offline');
    expect(screen.getByLabelText(/API Key/)).toBeDisabled();
    expect(screen.queryByText('Target Output TOC Format')).not.toBeInTheDocument();
    expect(screen.queryByText(/Direction \/ Adjacent Station Context/)).not.toBeInTheDocument();
  });

  it('requires a key only after explicitly selecting an online provider', async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText('Extraction Provider'), { target: { value: 'openai' } });
    const keyInput = screen.getByLabelText(/API Key/);
    expect(keyInput).toBeEnabled();

    const file = new File(['%PDF-1.4'], 'layout.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('Layout file'), { target: { files: [file] } });
    await screen.findByText('layout.pdf');
    fireEvent.click(screen.getByRole('button', { name: 'Proceed' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Enter your OpenAI (online) API key, or choose Offline (no AI).');
    });
    expect(keyInput).toHaveValue('');
  });
});
