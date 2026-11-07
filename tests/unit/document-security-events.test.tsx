import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {DocumentSecurityEvents} from '@/components/storage-lab/document-security-events';
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});
const event={id:'1',actorId:'synthetic-actor',documentId:'synthetic-document',operation:'grant',reason:'access',occurredAt:'2026-01-01T00:00:00Z'};
describe('local tenant denial view',()=>{
  it('shows attributable denials and clearly states excluded event classes',async()=>{
    const mock=vi.fn(async()=>({ok:true,json:async()=>({events:[event],hasMore:true})}));vi.stubGlobal('fetch',mock);
    render(<DocumentSecurityEvents businessId="tenant-a"/>);
    expect(await screen.findByText('Access request · Request not completed')).toBeTruthy();
    expect(screen.getByText('Document: synthetic-document')).toBeTruthy();expect(screen.getByText('Actor: synthetic-actor')).toBeTruthy();
    expect(screen.getByText(/anonymous, unverified and pre-authorization denials are not shown/)).toBeTruthy();
    expect(screen.getByText('Older denials are not shown in this view.')).toBeTruthy();
    expect(mock).toHaveBeenCalledWith('/api/storage-lab/security-events?businessId=tenant-a',expect.objectContaining({cache:'no-store'}));
    fireEvent.click(screen.getByRole('button',{name:'Refresh denials'}));await waitFor(()=>expect(mock).toHaveBeenCalledTimes(2));
  });
  it('does not show previous tenant events after a switch, even if the first request resolves late',async()=>{
    let resolveFirst!:(value:unknown)=>void;vi.stubGlobal('fetch',vi.fn((url:string)=>url.includes('tenant-a')?new Promise(r=>{resolveFirst=r;}):Promise.resolve({ok:true,json:async()=>({events:[{...event,id:'b',documentId:'tenant-b-doc'}],hasMore:false})})));
    const {rerender}=render(<DocumentSecurityEvents businessId="tenant-a"/>);rerender(<DocumentSecurityEvents businessId="tenant-b"/>);
    expect(await screen.findByText('Document: tenant-b-doc')).toBeTruthy();resolveFirst({ok:true,json:async()=>({events:[event],hasMore:false})});
    await waitFor(()=>expect(screen.queryByText('Document: synthetic-document')).toBeNull());expect(screen.getByText('Document: tenant-b-doc')).toBeTruthy();
  });
  it('does not expose data when the request is denied or malformed',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:false})));render(<DocumentSecurityEvents businessId="tenant-a"/>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load denials');expect(screen.queryByText('Document: synthetic-document')).toBeNull();
  });
});
