import {beforeEach, describe, expect, it, vi} from 'vitest';

const mocks=vi.hoisted(()=>({getUser:vi.fn(),from:vi.fn(),config:vi.fn(),redirect:vi.fn((url:string)=>{throw new Error(`REDIRECT ${url}`);}),exchange:vi.fn()}));
vi.mock('next/navigation',()=>({redirect:mocks.redirect}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:mocks.getUser,exchangeCodeForSession:mocks.exchange},from:mocks.from})}));
vi.mock('@/lib/supabase/env',()=>({getSupabaseConfig:mocks.config,getSiteOrigin:()=> 'https://paidflow.example'}));
import {requireUser,getWorkspace} from '@/lib/supabase/guard';
import {resetPassword} from '@/app/auth/reset-password/actions';
import {GET} from '@/app/auth/callback/route';
import {NextRequest} from 'next/server';

const user={id:'user-1',email_confirmed_at:'2026-01-01'};
beforeEach(()=>{vi.clearAllMocks();mocks.config.mockReturnValue({url:'https://auth.example',key:'synthetic'});mocks.getUser.mockResolvedValue({data:{user},error:null});});
describe('session and recovery safety',()=>{
 it('never updates a password via the disabled reset action',async()=>{expect(await resetPassword('synthetic-password')).toEqual({error:true});expect(mocks.getUser).not.toHaveBeenCalled();expect(mocks.exchange).not.toHaveBeenCalled();});
 it('recovery callback clears legacy marker and never exchanges a code',async()=>{const r=await GET(new NextRequest('https://paidflow.example/auth/callback?flow=recovery&code=synthetic'));expect(r.headers.get('location')).toBe('https://paidflow.example/forgot-password?error=unavailable');expect(r.headers.get('cache-control')).toBe('no-store');expect(r.headers.get('referrer-policy')).toBe('no-referrer');expect(r.cookies.get('paidflow_recovery')?.value).toBe('');expect(mocks.exchange).not.toHaveBeenCalled();});
 it('normal verification callback still works and clears the legacy marker',async()=>{mocks.exchange.mockResolvedValue({error:null});const r=await GET(new NextRequest('https://paidflow.example/auth/callback?flow=verify&code=synthetic'));expect(mocks.exchange).toHaveBeenCalledWith('synthetic');expect(r.headers.get('location')).toBe('https://paidflow.example/workspace');expect(r.cookies.get('paidflow_recovery')?.value).toBe('');});
 it('passes a valid PKCE flow id to the SDK and rejects ambiguous or invalid IDs',async()=>{
  mocks.exchange.mockResolvedValue({error:null});const id='abcdef0123456789abcdef0123456789';
  const ok=await GET(new NextRequest(`https://paidflow.example/auth/callback?flow=verify&code=synthetic&sb_flow_id=${id}`));
  expect(mocks.exchange).toHaveBeenCalledWith('synthetic',{flowId:id});expect(ok.headers.get('location')).toBe('https://paidflow.example/workspace');
  for(const query of ['sb_flow_id=bad','sb_flow_id=','sb_flow_id=abcdefgh&sb_flow_id=ijklmnop']){
    mocks.exchange.mockClear();const r=await GET(new NextRequest(`https://paidflow.example/auth/callback?code=synthetic&${query}`));
    expect(r.headers.get('location')).toBe('https://paidflow.example/verify-email?error=expired');expect(r.headers.get('cache-control')).toBe('no-store');expect(mocks.exchange).not.toHaveBeenCalled();
  }
 });
 it('auth errors never admit a user even if a user object is returned',async()=>{for(const status of [400,401,403]){mocks.getUser.mockResolvedValue({data:{user},error:{status}});await expect(requireUser()).rejects.toThrow('REDIRECT /login');}mocks.getUser.mockResolvedValue({data:{user},error:{status:503}});await expect(requireUser()).rejects.toThrow('Unable to verify the session');});
 it('absent, unverified and unconfigured sessions fail closed',async()=>{mocks.config.mockReturnValue(null);await expect(requireUser()).rejects.toThrow('REDIRECT /login?setup=required');mocks.config.mockReturnValue({});mocks.getUser.mockResolvedValue({data:{user:null},error:null});await expect(requireUser()).rejects.toThrow('REDIRECT /login');mocks.getUser.mockResolvedValue({data:{user:{...user,email_confirmed_at:null}},error:null});await expect(requireUser()).rejects.toThrow('REDIRECT /verify-email');});
 it('requires the active-membership filter and denies when no active membership exists',async()=>{const eq=vi.fn().mockReturnThis();const select=vi.fn().mockReturnValue({eq});eq.mockReturnValueOnce({eq}).mockResolvedValueOnce({data:[],error:null});mocks.from.mockReturnValue({select});await expect(getWorkspace()).rejects.toThrow('REDIRECT /onboarding');expect(eq).toHaveBeenCalledWith('user_id',user.id);expect(eq).toHaveBeenCalledWith('status','active');expect(mocks.from).toHaveBeenCalledTimes(1);});
 it('membership lookup errors fail closed',async()=>{const eq=vi.fn();eq.mockReturnValueOnce({eq}).mockResolvedValueOnce({data:null,error:{message:'synthetic'}});mocks.from.mockReturnValue({select:()=>({eq})});await expect(getWorkspace()).rejects.toThrow('Unable to load workspace membership');});
});
