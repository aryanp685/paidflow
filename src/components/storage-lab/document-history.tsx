"use client";
import { useEffect, useState } from "react";

type Event={id:string;actorId:string|null;documentId:string;action:string;occurredAt:string};
const labels:Record<string,string>={
  "document.registered":"Registered", "document.uploaded":"Structurally checked", "document.deleted":"Deleted",
  "document.revoked":"Revoked", "document.upload_abandoned":"Upload abandoned", "document.scan_status_reclassified":"Scan status reclassified",
};

// Local-lab lifecycle history only, not a full security audit.
export function DocumentHistory({businessId}:{businessId:string}){
  const [result,setResult]=useState<{businessId:string;revision:number;events:Event[];more:boolean;error:boolean}|null>(null),[revision,setRevision]=useState(0);
  // Never display a result from a different workspace or a previous refresh.
  const current=result?.businessId===businessId&&result.revision===revision?result:null;
  const loading=!current,events=current?.events??[],more=current?.more??false,error=current?.error??false;
  useEffect(()=>{
    const controller=new AbortController();let active=true;
    fetch(`/api/storage-lab/history?businessId=${encodeURIComponent(businessId)}`,{cache:"no-store",signal:controller.signal})
      .then(async r=>{if(!r.ok)throw Error();const data=await r.json();if(!Array.isArray(data.events)||typeof data.hasMore!=="boolean")throw Error();if(active)setResult({businessId,revision,events:data.events,more:data.hasMore,error:false});})
      .catch(()=>{if(active)setResult({businessId,revision,events:[],more:false,error:true});});
    return ()=>{active=false;controller.abort();};
  },[businessId,revision]);
  return <section className="storage-history" aria-labelledby="history-heading">
    <div className="storage-history-head"><div><h2 id="history-heading">Document activity</h2><p>Owner/admin view · latest 100 lifecycle events</p></div><button type="button" onClick={()=>setRevision(x=>x+1)} disabled={loading}>Refresh</button></div>
    <p className="storage-history-note">This local view is incomplete: it does not show malware scans or successful downloads. Attributable denials appear separately.</p>
    {loading?<p role="status">Loading activity…</p>:error?<p role="alert">Could not load activity. Check your access and try again.</p>:events.length===0?<p>No document activity yet.</p>:<ol className="storage-history-list">{events.map(event=><li key={event.id}><strong>{labels[event.action]??"Document activity"}</strong><span>Document: {event.documentId}</span><span>Actor: {event.actorId??"System"}</span><time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString()}</time></li>)}</ol>}
    {!loading&&!error&&more&&<p>Older events are not shown in this view.</p>}
  </section>;
}
