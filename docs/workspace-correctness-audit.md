# Workspace correctness audit — first local pass

This is an incremental review, not a claim that Paidflow has no bugs or is ready for production. No hosted schema, provider settings, releases or deployments were changed in this pass.

## Findings addressed locally

- Customer and invoice lists previously treated missing rows as an empty list. All four paginated workspace lists (customers, invoices, payments and reminder candidates) now require an exact count and the expected number of unique rows for the requested range. A missing/null count or response, short/truncated result, duplicate ID or inconsistent count returns an error instead of displaying incomplete information as a complete page. Cross-page offsets can still shift when data changes between requests; this is not snapshot pagination.
- Customer/invoice navigation previously linked beyond the 1,000-page cap, looping back to page 1, and payments could show an empty pagination control at the cap. All four lists stop at page 1,000 and explain the 50,000-row visibility limit. Scalable search/keyset pagination remains future work.
- Customer update action now restricts its tenant-scoped update to non-archived customers, matching the edit page; concurrent archival therefore prevents this app update. Database grants/RLS are a separate boundary, and this is not a database-wide immutability guarantee.
- A React form action can resolve with an error object and still reset form fields. Invoice draft, payment and customer forms now retain their current input after such a returned error and prevent the form's automatic reset, including select controls. Same-tab invoice/payment request keys remain intact for exact retries. This does not preserve inputs across reload, remount, crash, or a thrown action/transport failure, and does not make distinct request keys or cross-tab retries idempotent.
- Customer creation now has a local candidate business/request-key RPC and same-tab retry flow. Its guarantees apply only when the same key and normalized details are used through that RPC; other keys, tabs or direct inserts can still create duplicates. A new key requires explicit acknowledgement. See `docs/local-customer-idempotency.md` for retention and rollout limitations.
- Corrected outdated overview wording about issued invoice workflow.

## Open high-priority work

1. Proof and issuance guard candidates are local and undeployed. Base SQL permits direct RPC paths that the UI does not protect. Security acceptance remains failed for known baseline unscanned-proof gaps. The currently empty dedicated Supabase target still needs a reviewed atomic, fail-closed rollout and accurate migration history; do not apply schema alone or lift holds. Previous target inspection is not a fresh health check.
2. Verify financial/GST rules, locks, history, real-provider Auth/RLS/PostgREST, idempotent retries, reconciliation, backups and rollback independently before accepting real invoicing. Existing issuance hold intentionally blocks new issuance when installed.
3. Verify the customer-create candidate against real provider behavior and review form conflict handling, suspension/workspace changes and provider-error semantics. Input state lives in memory and is lost on reload. Review onReset behavior in real browsers, not just jsdom.
4. Implement remaining user-approved features, including team/settings/subscriptions within agreed scope; OCR remains gated on safe file processing and explicit human review. Reminder scheduling/history is not implemented. Analytics is limited to 1,000 issued invoices and depends on recorded balances.
5. Conduct broader accessible UX, responsive, integration, end-to-end, abuse and operational testing. UI polish deliberately remains last. No mock result proves production behavior.
