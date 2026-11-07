"use client";
import { useEffect, useState } from "react";

type Event={id:string;actorId:string|null;documentId:string|null;operation:string;reason:string;occurredAt:string};
const operations:Record<string,string>={upload:"Upload",delete:"Delete",grant:"Access request",download:"Download",preview:"Preview"};
const reasons:Record<string,string>={access:"Request not completed",validation:"Validation rejected"};

// Only events whose tenant was established after authorization are shown.
export function DocumentSecurityEvents({businessId}:{businessId:string}){
  const [result,setResult]=useState<{businessId:string;revision:number;events:Event[];more:boolean;error:boolean}|null>(null),[revision,setRevision]=useState(0);
  const current=result?.businessId===businessId&&result.revision===revision?result:null;
  const loading=!current,events=current?.events??[],more=current?.more??false,error=current?.error??false;
  useEffect(()=>{
    const controller=new AbortController();let active=true;
    fetch(`/api/storage-lab/security-events?businessId=${encodeURIComponent(businessId)}`,{cache:"no-store",signal:controller.signal})
      .then(async r=>{if(!r.ok)throw Error();const data=await r.json();if(!Array.isArray(data.events)||typeof data.hasMore!=="boolean")throw Error();if(active)setResult({businessId,revision,events:data.events,more:data.hasMore,error:false});})
      .catch(()=>{if(active)setResult({businessId,revision,events:[],more:false,error:true});});
    return ()=>{active=false;controller.abort();};
  },[businessId,revision]);
  return <section className="storage-history" aria-labelledby="security-heading">
    <div className="storage-history-head"><div><h2 id="security-heading">Denied document requests</h2><p>Owner/admin view · latest 100 attributable events</p></div><button type="button" onClick={()=>setRevision(x=>x+1)} disabled={loading}>Refresh denials</button></div>
    <p className="storage-history-note">Incomplete: anonymous, unverified and pre-authorization denials are not shown. A denial may also indicate a service failure.</p>
    {loading?<p role="status">Loading denials…</p>:error?<p role="alert">Could not load denials. Check your access and try again.</p>:events.length===0?<p>No attributable denials to show.</p>:<ol className="storage-history-list">{events.map(event=><li key={event.id}><strong>{operations[event.operation]??"Document request"} · {reasons[event.reason]??"Request not completed"}</strong><span>{event.documentId?`Document: ${event.documentId}`:"Workspace-level upload"}</span><span>Actor: {event.actorId??"Unavailable"}</span><time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString()}</time></li>)}</ol>}
    {!loading&&!error&&more&&<p>Older denials are not shown in this view.</p>}
  </section>;
}
