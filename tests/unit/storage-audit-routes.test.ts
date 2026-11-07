import {beforeEach, describe, expect, it, vi} from 'vitest';

const mocks=vi.hoisted(()=>({storage: {recordRequestDenial:vi.fn(),upload:vi.fn(),remove:vi.fn(),grant:vi.fn(),cleanup:vi.fn()},origin:vi.fn(),business:vi.fn()}));
vi.mock('@/lib/better-auth-lab/server',()=>({getLab:async()=>({auth:{},runtimePool:{}}),isLabHost:()=>true}));
vi.mock('../../better-auth-lab/core.mjs',()=>({withVerifiedBusiness:mocks.business}));
vi.mock('@/lib/storage-lab/server',async(importOriginal)=>({
  ...await importOriginal<typeof import('@/lib/storage-lab/server')>(),
  getStorageLab:async()=>mocks.storage,
  sameOrigin:mocks.origin,
}));
import {POST as upload} from '@/app/api/storage-lab/documents/route';
import {POST as grant,DELETE as remove} from '@/app/api/storage-lab/documents/[id]/route';
import {POST as cleanup} from '@/app/api/storage-lab/cleanup/route';

const id='synthetic-secret-doc', params={params:Promise.resolve({id})};
const req=(method:string,body?:BodyInit,extra:Record<string,string>={})=>new Request('http://localhost/api/storage-lab/documents',{method,headers:{cookie:'synthetic-secret-cookie',...extra},body});
beforeEach(()=>{vi.resetAllMocks();mocks.origin.mockReturnValue(true);mocks.business.mockResolvedValue(null);mocks.storage.recordRequestDenial.mockResolvedValue(undefined);});
describe('storage request rejection auditing',()=>{
  it('records origin rejection without passing a target or body to the audit helper',async()=>{
    mocks.origin.mockReturnValue(false);
    for(const response of [await upload(req('POST','synthetic-secret-file')),await grant(req('POST'),params),await remove(req('DELETE'),params),await cleanup(req('POST','synthetic-secret-file'))])expect(response.status).toBe(403);
    expect(mocks.storage.recordRequestDenial.mock.calls.map(([x])=>[x.operation,x.reason])).toEqual([['upload','origin'],['grant','origin'],['delete','origin'],['cleanup','origin']]);
    for(const [event] of mocks.storage.recordRequestDenial.mock.calls){expect(Object.keys(event).sort()).toEqual(['headers','operation','reason']);expect(JSON.stringify({operation:event.operation,reason:event.reason})).not.toContain('synthetic-secret');}
    expect(mocks.storage.upload).not.toHaveBeenCalled();expect(mocks.storage.grant).not.toHaveBeenCalled();expect(mocks.storage.remove).not.toHaveBeenCalled();
  });
  it('denies even when origin-denial audit write fails',async()=>{mocks.origin.mockReturnValue(false);mocks.storage.recordRequestDenial.mockRejectedValue(Error('audit unavailable'));expect((await grant(req('POST'),params)).status).toBe(403);expect(mocks.storage.grant).not.toHaveBeenCalled();});
  it('records malformed filename and oversized body before delegation',async()=>{
    const a=await upload(req('POST','x',{'x-file-name':'%'}));expect(a.status).toBe(400);
    const b=await upload(req('POST','x',{'content-length':'99999999'}));expect(b.status).toBe(400);
    expect(mocks.storage.recordRequestDenial.mock.calls.map(([x])=>[x.operation,x.reason])).toEqual([['upload','validation'],['upload','validation']]);expect(mocks.storage.upload).not.toHaveBeenCalled();
  });
  it('records authorization rejection before reading upload',async()=>{mocks.business.mockRejectedValue(Error('FORBIDDEN'));expect((await upload(req('POST','file'))).status).toBe(403);expect(mocks.storage.recordRequestDenial).toHaveBeenCalledWith(expect.objectContaining({operation:'upload',reason:'access'}));expect(mocks.storage.upload).not.toHaveBeenCalled();});
  it('does not duplicate events after delegation to the audited storage core',async()=>{mocks.storage.upload.mockRejectedValue(Error('INVALID_TYPE'));expect((await upload(req('POST','synthetic'))).status).toBe(400);expect(mocks.storage.recordRequestDenial).not.toHaveBeenCalled();});
  it('records invalid cleanup body',async()=>{expect((await cleanup(req('POST','{}'))).status).toBe(400);expect(mocks.storage.recordRequestDenial).toHaveBeenCalledWith(expect.objectContaining({operation:'cleanup',reason:'validation'}));expect(mocks.storage.cleanup).not.toHaveBeenCalled();});
});
