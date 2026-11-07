// @vitest-environment node
// Real installed Supabase SSR/JS client and cookie adapters, but a synthetic
// in-memory HTTP transport: this is NOT a real Supabase Auth provider test.
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {createBrowserClient,createServerClient} from '@supabase/ssr';
import {createClient} from '@supabase/supabase-js';
import {createHash} from 'node:crypto';
import {NextRequest} from 'next/server';

const state=vi.hoisted(()=>({server:null as unknown}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>state.server}));
vi.mock('@/lib/supabase/env',()=>({getSiteOrigin:()=> 'https://paidflow.example',getSupabaseConfig:()=>({url:'http://localhost:54321',key:'synthetic'})}));
import {GET} from '@/app/auth/callback/route';

type CookieOption={maxAge?:number};
const cookies=new Map<string,string>();
const pending=new Map<string,{challenge:string,flowId:string|null}>();
const calls:string[]=[];
let counter=0;
const jar={
  getAll:()=>Array.from(cookies,([name,value])=>({name,value})),
  setAll:(changes:{name:string,value:string,options?:CookieOption}[])=>{for(const {name,value,options} of changes){if(options?.maxAge===0)cookies.delete(name);else cookies.set(name,value);}},
};
const user={id:'10000000-0000-4000-8000-000000000001',email:'synthetic@example.invalid',app_metadata:{},user_metadata:{},aud:'authenticated',created_at:'2026-01-01T00:00:00Z'};
const syntheticSession={access_token:'synthetic.access.token',refresh_token:'synthetic-refresh-token',token_type:'bearer',expires_in:3600,user};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const fakeFetch:typeof fetch=async(input,init)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.toString():input.url);
  if(url.origin!=='http://localhost:54321')throw Error('unexpected network destination');
  calls.push(url.pathname);
  const body=JSON.parse(String(init?.body??'{}')) as Record<string,string>;
  if(url.pathname==='/auth/v1/signup'){
    const redirect=url.searchParams.get('redirect_to');if(!redirect||!body.code_challenge)throw Error('missing synthetic PKCE setup');
    const flowId=new URL(redirect).searchParams.get('sb_flow_id');
    pending.set(`code-${++counter}`,{challenge:body.code_challenge,flowId});return json({user,session:null});
  }
  if(url.pathname==='/auth/v1/token'){
    const expected=pending.get(body.auth_code);const challenge=createHash('sha256').update(body.code_verifier??'').digest('base64url');
    if(!expected||expected.challenge!==challenge)return json({error:'invalid_grant',error_description:'invalid synthetic code'},400);
    pending.delete(body.auth_code);return json(syntheticSession);
  }
  throw Error('unexpected synthetic endpoint');
};
const opts={cookies:jar,global:{fetch:fakeFetch},auth:{autoRefreshToken:false,detectSessionInUrl:false,experimental:{appendPkceFlowIdToRedirects:true}}};
function server(){return createServerClient('http://localhost:54321','synthetic-anon-key',opts);}
async function startTwo(){
  const browser=createBrowserClient('http://localhost:54321','synthetic-anon-key',{...opts,isSingleton:false});
  for(let n=0;n<2;n++){
    const result=await browser.auth.signUp({email:`synthetic${n}@example.invalid`,password:'synthetic-password',options:{emailRedirectTo:'https://paidflow.example/auth/callback?flow=verify'}});
    expect(result.error).toBeNull();
  }
  const a=pending.get('code-1'),b=pending.get('code-2');expect(a).toBeDefined();expect(b).toBeDefined();expect(a!.flowId).toBeTruthy();expect(b!.flowId).toBeTruthy();expect(a!.flowId).not.toBe(b!.flowId);return [a! as {challenge:string,flowId:string},b! as {challenge:string,flowId:string}] as const;
}
const callback=(code:string,flowId:string)=>new NextRequest(`https://paidflow.example/auth/callback?flow=verify&code=${code}&sb_flow_id=${flowId}`);
beforeEach(()=>{cookies.clear();pending.clear();calls.length=0;counter=0;state.server=null;});
describe('real Supabase SDK PKCE slot selection with synthetic transport',()=>{
  it('exchanges two concurrent signup flows out of order without using the latest verifier',async()=>{
    const [a,b]=await startTwo();state.server=server();
    const first=await GET(callback('code-1',a.flowId));expect(first.headers.get('location')).toBe('https://paidflow.example/workspace');
    state.server=server();const second=await GET(callback('code-2',b.flowId));expect(second.headers.get('location')).toBe('https://paidflow.example/workspace');
    expect(pending.size).toBe(0);expect(calls.filter(x=>x==='/auth/v1/token')).toHaveLength(2);
  });
  it('an absent slot fails closed without borrowing or deleting another flow verifier',async()=>{
    const [a,b]=await startTwo();state.server=server();
    const wrong=await GET(callback('code-1','does_not_exist_0001'));expect(wrong.headers.get('location')).toBe('https://paidflow.example/verify-email?error=expired');
    expect(calls.filter(x=>x==='/auth/v1/token')).toHaveLength(0);expect(pending.size).toBe(2);
    state.server=server();expect((await GET(callback('code-1',a.flowId))).headers.get('location')).toBe('https://paidflow.example/workspace');
    state.server=server();expect((await GET(callback('code-2',b.flowId))).headers.get('location')).toBe('https://paidflow.example/workspace');
  });
  it('current default browser configuration omits the flow id and still uses the latest verifier',async()=>{
    const browser=createBrowserClient('http://localhost:54321','synthetic-anon-key',{cookies:jar,global:{fetch:fakeFetch},auth:{autoRefreshToken:false,detectSessionInUrl:false},isSingleton:false});
    for(let n=0;n<2;n++)expect((await browser.auth.signUp({email:`default${n}@example.invalid`,password:'synthetic-password',options:{emailRedirectTo:'https://paidflow.example/auth/callback?flow=verify'}})).error).toBeNull();
    expect(pending.get('code-1')?.flowId).toBeNull();expect(pending.get('code-2')?.flowId).toBeNull();
    state.server=server();const r=await GET(new NextRequest('https://paidflow.example/auth/callback?flow=verify&code=code-1'));
    expect(r.headers.get('location')).toBe('https://paidflow.example/verify-email?error=expired');
    // The synthetic server rejects the mismatched verifier. Real provider behavior
    // and whether the original code remains usable must be verified separately.
  });
  it('SDK redirectType comes from mutable verifier metadata, not the transport response',async()=>{
    const results:(string|null|undefined)[]=[];const sent:string[]=[];
    for(const suffix of ['/recovery','']){
      const data=new Map<string,string>([['evidence-code-verifier',JSON.stringify('same-synthetic-verifier'+suffix)]]);
      const storage={getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);},removeItem:(key:string)=>{data.delete(key);}};
      const transport:typeof fetch=async(_input,init)=>{const body=JSON.parse(String(init?.body));sent.push(body.code_verifier);return json(syntheticSession);};
      const client=createClient('http://localhost:54321','synthetic-anon-key',{auth:{storageKey:'evidence',storage,flowType:'pkce',persistSession:true,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:transport}});
      const result=await client.auth.exchangeCodeForSession('synthetic-code');expect(result.error).toBeNull();results.push((result.data as typeof result.data & {redirectType?:string|null}).redirectType);
    }
    expect(sent).toEqual(['same-synthetic-verifier','same-synthetic-verifier']);expect(results).toEqual(['recovery',null]);
  });
  it('a replay cannot create another session in the synthetic transport',async()=>{
    const [a]=await startTwo();state.server=server();expect((await GET(callback('code-1',a.flowId))).headers.get('location')).toBe('https://paidflow.example/workspace');
    state.server=server();expect((await GET(callback('code-1',a.flowId))).headers.get('location')).toBe('https://paidflow.example/verify-email?error=expired');
  });
});
