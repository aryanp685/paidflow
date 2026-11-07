import {afterEach, describe, expect, it, vi} from 'vitest';
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {DocumentManager} from '@/components/storage-lab/document-manager';

vi.mock('next/link', () => ({default: ({children, href}: {children: React.ReactNode; href: string}) => <a href={href}>{children}</a>}));
afterEach(() => {cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks();});

describe('document security hold', () => {
  it('shows the hold for unscanned and legacy verified files while preserving permitted deletion', async () => {
    const docs = ['structurally_valid_unscanned','verified'].map((status, i) => ({id: `doc-${i}`, name: `file-${i}.png`, mime:'image/png', size:123, area:'evidence', status, createdAt:'2026-01-01'}));
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.includes('/workspace')) return {ok:true,json:async()=>({businesses:[{id:'business',name:'Synthetic',role:'owner'}]})};
      if (url.includes('/history') || url.includes('/security-events')) return {ok:true,json:async()=>({events:[],hasMore:false})};
      if (options?.method === 'DELETE') return {ok:true};
      return {ok:true,json:async()=>({documents:docs})};
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<DocumentManager/>);
    await screen.findByText('file-0.png');
    expect(screen.getByText('Not malware scanned')).toBeTruthy();
    expect(screen.getByText('Scan status requires review')).toBeTruthy();
    expect(screen.getByText(/Downloads and previews are disabled for all files/)).toBeTruthy();
    expect(screen.queryByRole('button',{name:/preview/i})).toBeNull();
    expect(screen.queryByRole('button',{name:/download/i})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Delete file-0.png'}));
    await waitFor(()=>expect(fetchMock).toHaveBeenCalledWith('/api/storage-lab/documents/doc-0', {method:'DELETE'}));
    await screen.findByText('Document deleted.');
  });
});
