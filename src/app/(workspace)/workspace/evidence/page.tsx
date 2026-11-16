import Link from "next/link";
import { ArrowRight, FileLock2, ShieldAlert } from "lucide-react";

/** Informational only. The workspace layout performs the normal session and membership checks. */
export default function EvidencePage() {
  return (
    <>
      <div className="workspace-page-head">
        <div>
          <div className="auth-kicker"><span /> WORKSPACE</div>
          <h1>Evidence vault</h1>
          <p>Document and payment-proof access is not available here yet.</p>
        </div>
      </div>
      <section className="evidence-hold" aria-labelledby="evidence-hold-title">
        <div className="evidence-hold-icon"><FileLock2 size={24} aria-hidden="true" /></div>
        <div>
          <div className="evidence-label"><ShieldAlert size={14} aria-hidden="true" /> ON HOLD</div>
          <h2 id="evidence-hold-title">Proof attachments are unavailable</h2>
          <p>You cannot upload, attach, preview or download documents through this page. Payment records can be recorded without proof; they are user-reported, not independently verified.</p>
          <p>This page does not show existing documents or their scan status. Do not assume an existing attachment is safe or verified.</p>
          <Link className="dashboard-link" href="/workspace/payments">View payment history <ArrowRight size={14} aria-hidden="true" /></Link>
        </div>
      </section>
    </>
  );
}
