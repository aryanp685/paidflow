import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {DocumentManager} from '@/components/storage-lab/document-manager';
import {DocumentHistory} from '@/components/storage-lab/document-history';
vi.mock('next/link',()=>({default:({children,href}:{children:React.ReactNode;href:string})=><a href={href}>{children}</a>}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});
const event={id:'event-1',actorId:'synthetic-actor',documentId:'synthetic-document',action:'document.uploaded',occurredAt:'2026-01-01T00:00:00Z'};
describe('local document lifecycle history',()=>{
  it('renders scoped lifecycle activity and an explicit incomplete-audit warning',async()=>{
    const fetchMock=vi.fn(async()=>({ok:true,json:async()=>({events:[event],hasMore:true})}));vi.stubGlobal('fetch',fetchMock);
    render(<DocumentHistory businessId="business-a"/>);
    expect(await screen.findByText('Structurally checked')).toBeTruthy();
    expect(screen.getByText('Document: synthetic-document')).toBeTruthy();expect(screen.getByText('Actor: synthetic-actor')).toBeTruthy();
    expect(screen.getByText(/does not show malware scans or successful downloads/)).toBeTruthy();
    expect(screen.getByText('Older events are not shown in this view.')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/storage-lab/history?businessId=business-a',expect.objectContaining({cache:'no-store'}));
    fireEvent.click(screen.getByRole('button',{name:'Refresh'}));await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(2));
  });
  it('reports authorization or malformed response failures without showing stale rows',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:false})));render(<DocumentHistory businessId="business-a"/>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load activity');expect(screen.queryByText('Structurally checked')).toBeNull();
  });
  it('a late response for a prior tenant cannot replace the current tenant',async()=>{
    let resolveA!:(value:unknown)=>void;
    const fetchMock=vi.fn((url:string)=>url.includes('business-a')?new Promise(r=>{resolveA=r;}):Promise.resolve({ok:true,json:async()=>({events:[{...event,id:'b',documentId:'tenant-b'}],hasMore:false})}));
    vi.stubGlobal('fetch',fetchMock);const {rerender}=render(<DocumentHistory businessId="business-a"/>);
    rerender(<DocumentHistory businessId="business-b"/>);expect(await screen.findByText('Document: tenant-b')).toBeTruthy();
    resolveA({ok:true,json:async()=>({events:[{...event,documentId:'tenant-a'}],hasMore:false})});
    await waitFor(()=>expect(screen.queryByText('Document: tenant-a')).toBeNull());expect(screen.getByText('Document: tenant-b')).toBeTruthy();
  });
  it('does not request or display the owner/admin view to a viewer',async()=>{
    const fetchMock=vi.fn(async(url:string)=>url.includes('/workspace')?{ok:true,json:async()=>({businesses:[{id:'business-a',name:'Synthetic',role:'viewer'}]})}:{ok:true,json:async()=>({documents:[]})});vi.stubGlobal('fetch',fetchMock);
    render(<DocumentManager/>);await screen.findByText('A little space for your files.');
    expect(screen.queryByRole('heading',{name:'Document activity'})).toBeNull();expect(fetchMock.mock.calls.some(([url])=>url.includes('/history')||url.includes('/security-events'))).toBe(false);
  });
});
