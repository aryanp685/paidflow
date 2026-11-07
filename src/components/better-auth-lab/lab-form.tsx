"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
export type LabScreen="login"|"signup"|"forgot-password"|"reset-password"|"verify-email"|"workspace"|"onboard";
const copy:Record<LabScreen,{kicker:string;title:string;description:string;submit:string}>={
  login:{kicker:"LOCAL AUTH LAB",title:"Good to see you again.",description:"Sign in to the isolated local test workspace.",submit:"Sign in"},
  signup:{kicker:"LOCAL AUTH LAB",title:"A little more clarity starts here.",description:"Create a test account and verify your email.",submit:"Create account"},
  "forgot-password":{kicker:"ACCOUNT RECOVERY",title:"Forgot your password?",description:"We’ll send a reset link if the account exists.",submit:"Send reset link"},
  "reset-password":{kicker:"ACCOUNT RECOVERY",title:"Choose a new password.",description:"Your one-time link authorizes this password reset.",submit:"Update password"},
  "verify-email":{kicker:"ONE MORE STEP",title:"Check your test inbox.",description:"After following your verification link, return to sign in.",submit:""},
  onboard:{kicker:"YOUR LOCAL WORKSPACE",title:"Start with your business.",description:"Add the details for this test workspace.",submit:"Create workspace"},
  workspace:{kicker:"LOCAL AUTH LAB",title:"Your workspaces.",description:"Only active memberships are shown.",submit:""},
};
export function LabForm({screen,storageEnabled=false}:{screen:LabScreen;storageEnabled?:boolean}) {
  const t=copy[screen],router=useRouter(); const [email,setEmail]=useState("");const [password,setPassword]=useState("");const [name,setName]=useState("");const recoveryToken=useRef("");const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");const [error,setError]=useState("");
  const onboardingKey=useRef("");
  const [businesses,setBusinesses]=useState<{id:string;name:string;role:string}[]>([]);
  useEffect(()=>{if(screen==="reset-password"){const url=new URL(window.location.href);if(url.searchParams.has("token")){recoveryToken.current=url.searchParams.get("token")??"";history.replaceState(null,"",url.pathname);}}if(screen==="workspace")fetch("/api/better-auth-lab/workspace",{cache:"no-store"}).then(async r=>{if(r.status===401){router.replace("/better-auth-lab/login");return;}if(!r.ok)throw new Error();const data=await r.json();setBusinesses(data.businesses);}).catch(()=>setError("Could not load workspaces."));},[screen,router]);
  async function submit(e:React.FormEvent<HTMLFormElement>){e.preventDefault();const form=e.currentTarget;setError("");setMessage("");setBusy(true);try{let endpoint="";let body:Record<string,string>={};const origin=window.location.origin;
    if(screen==="onboard"){
      if(!onboardingKey.current)onboardingKey.current=crypto.randomUUID();
      const values=new FormData(form);const gstRegistered=values.get("gstRegistered")==="on";
      const res=await fetch("/api/better-auth-lab/workspace",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({key:onboardingKey.current,name:values.get("businessName"),businessType:values.get("businessType"),address:values.get("address"),city:values.get("city"),district:values.get("district"),stateCode:values.get("stateCode"),pincode:values.get("pincode"),gstRegistered,...(gstRegistered?{gstin:values.get("gstin")} : {}),invoicePrefix:values.get("invoicePrefix"),termsDays:Number(values.get("termsDays"))})});
      if(!res.ok){setError("Unable to create workspace. Check your details and existing memberships.");return;}router.replace("/better-auth-lab/workspace");router.refresh();return;
    }
    if(screen==="login"){endpoint="sign-in/email";body={email,password};}
    if(screen==="signup"){endpoint="sign-up/email";body={name,email,password,callbackURL:`${origin}/better-auth-lab/verify-email`};}
    if(screen==="forgot-password"){endpoint="request-password-reset";body={email,redirectTo:`${origin}/better-auth-lab/reset-password`};}
    if(screen==="reset-password"){if(!recoveryToken.current){setError("This reset link is invalid or expired.");return;}endpoint="reset-password";body={token:recoveryToken.current,newPassword:password};}
    const res=await fetch(`/api/better-auth-lab/${endpoint}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    if(!res.ok){setError(screen==="login"?"Unable to sign in. Check your credentials and verification.":"Unable to complete this request. Check your details or request a new link.");return;}
    if(screen==="login"){router.replace("/better-auth-lab/workspace");router.refresh();return;}
    setMessage(screen==="reset-password"?"Password updated. Sign in with your new password.":"If the request is valid, check the local test inbox.");if(screen==="reset-password")recoveryToken.current="";
  }catch{setError("Authentication is unavailable. Please try again.");}finally{setBusy(false);}}
  async function logout(){setBusy(true);try{const res=await fetch("/api/better-auth-lab/sign-out",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});if(!res.ok)throw new Error();router.replace("/better-auth-lab/login");router.refresh();}catch{setError("Unable to sign out. Try again.");}finally{setBusy(false);}}
  return <div><div className="auth-kicker"><span/> {t.kicker}</div><h1 className="auth-title">{t.title}</h1><p className="auth-description">{t.description}</p><p className="auth-alert" role="status">Local test only. This is separate from the existing Supabase sign-in.</p>{error&&<div className="auth-error" role="alert">{error}</div>}{message&&<div className="auth-success" role="status">{message}</div>}
  {screen==="workspace"?<><ul aria-label="Active workspaces">{businesses.map(b=><li key={b.id}>{b.name} · {b.role}</li>)}</ul>{businesses.length===0&&<p>No active workspace. <Link href="/better-auth-lab/onboard">Create a test workspace</Link>.</p>}{storageEnabled&&businesses.length>0&&<p><Link href="/better-auth-lab/documents">Open document lab →</Link></p>}<Button type="button" disabled={busy} onClick={logout}>Sign out</Button></>:screen!=="verify-email"&&<form className="auth-form" onSubmit={submit}>
    {screen==="onboard"&&<>
      <div className="auth-field"><label htmlFor="businessName">Business name</label><Input id="businessName" name="businessName" maxLength={200} required/></div>
      <div className="auth-field"><label htmlFor="businessType">Business type</label><select id="businessType" name="businessType" required defaultValue="other"><option value="other">Other</option><option value="manufacturer">Manufacturer</option><option value="wholesaler">Wholesaler</option><option value="distributor">Distributor</option><option value="service">Service</option><option value="agency">Agency</option></select></div>
      {[{id:"address",label:"Address"},{id:"city",label:"City"},{id:"district",label:"District"},{id:"stateCode",label:"State code (two digits)",pattern:"[0-9]{2}"},{id:"pincode",label:"PIN code",pattern:"[0-9]{6}"},{id:"invoicePrefix",label:"Invoice prefix",pattern:"[A-Z0-9]{1,10}"}].map(f=><div className="auth-field" key={f.id}><label htmlFor={f.id}>{f.label}</label><Input id={f.id} name={f.id} pattern={f.pattern} defaultValue={f.id==="invoicePrefix"?"PF":undefined} required/></div>)}
      <div className="auth-field"><label htmlFor="termsDays">Payment terms in days</label><Input id="termsDays" name="termsDays" type="number" min={0} max={3650} defaultValue={15} required/></div>
      <label><input name="gstRegistered" type="checkbox"/> GST registered</label><div className="auth-field"><label htmlFor="gstin">GSTIN (if registered)</label><Input id="gstin" name="gstin" pattern="[0-9]{2}[A-Z0-9]{13}"/></div>
    </>}
    {screen==="signup"&&<div className="auth-field"><label htmlFor="lab-name">Name</label><Input id="lab-name" value={name} onChange={e=>setName(e.target.value)} autoComplete="name" required maxLength={200}/></div>}
    {screen!=="reset-password"&&screen!=="onboard"&&<div className="auth-field"><label htmlFor="lab-email">Email address</label><Input id="lab-email" type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" required/></div>}
    {["login","signup","reset-password"].includes(screen)&&<div className="auth-field"><label htmlFor="lab-password">{screen==="reset-password"?"New password":"Password"}</label><Input id="lab-password" type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete={screen==="login"?"current-password":"new-password"} required minLength={screen==="login"?1:8} maxLength={72}/></div>}
    <Button className="auth-submit" disabled={busy} type="submit">{busy?<><LoaderCircle className="animate-spin" size={17}/> Please wait</>:<>{t.submit}<ArrowRight size={16}/></>}</Button></form>}
    <div className="auth-switch">{screen==="login"?<><Link href="/better-auth-lab/signup">Create an account</Link> · <Link href="/better-auth-lab/forgot-password">Forgot password?</Link></>:<Link href="/better-auth-lab/login">← Back to sign in</Link>}</div>
  </div>;
}
