"use client";
import { useEffect, useRef, useState } from "react";
import { reminderSubjects, reminderVariantLabels, type ReminderLanguage, type ReminderTemplates, type ReminderVariant, type ReminderVariants } from "@/lib/reminders/templates";

function whatsappNumber(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\+?[1-9][0-9]{7,14}$/.test(trimmed)) return null;
  return trimmed.replace(/^\+/, "");
}
function emailAddress(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length > 254 || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(trimmed)) return null;
  return trimmed;
}
export function ReminderComposer({ templates, variants }: { templates: ReminderTemplates; variants?: ReminderVariants }) {
  const [language, setLanguage] = useState<ReminderLanguage>("en");
  const [variant, setVariant] = useState<ReminderVariant>("general");
  const [messages, setMessages] = useState<ReminderVariants>(() => ({ ...variants, general: { ...templates } }));
  const message = (messages[variant] ?? messages.general)[language];
  const availableVariants = (["general", "upcoming", "today", "overdue"] as const).filter(item => messages[item]);
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [copying, setCopying] = useState(false);
  // Serialize clipboard writes and ignore results for a draft that changed.
  const copyGeneration = useRef(0);
  const copyInFlight = useRef(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function invalidateCopyStatus() { copyGeneration.current++; setCopyStatus(""); }
  const number = whatsappNumber(phone), address = emailAddress(email);
  let encodedMessage: string | null = null;
  try { encodedMessage = encodeURIComponent(message); } catch { /* Invalid Unicode: fail closed rather than render a broken link. */ }
  const canShare = message.trim().length > 0 && message.length <= 2000 && encodedMessage !== null;
  async function copy() {
    if (!canShare || copyInFlight.current) return;
    copyInFlight.current = true;
    setCopying(true);
    const generation = ++copyGeneration.current;
    setCopyStatus("");
    try { await navigator.clipboard.writeText(message); if (mounted.current && copyGeneration.current === generation) setCopyStatus("Copied to clipboard. No message was sent."); }
    catch { if (mounted.current && copyGeneration.current === generation) setCopyStatus("Could not copy automatically. Select and copy the message manually."); }
    finally { copyInFlight.current = false; if (mounted.current) setCopying(false); }
  }
  return <section className="customer-form reminder-composer" aria-labelledby="compose-reminder-title">
    <div className="customer-form-intro"><h2 id="compose-reminder-title">Review and edit</h2><p>Drafts in English, Hindi and Marathi are editable starting points. Review the wording and details before sharing. Edits stay on this page only and are discarded when you leave.</p></div>
    {availableVariants.length > 1 && <div className="reminder-language"><label htmlFor="reminder-variant">Draft type</label><select id="reminder-variant" value={variant} onChange={e => { const value = e.target.value as ReminderVariant; if (availableVariants.includes(value)) { setVariant(value); invalidateCopyStatus(); } }}>{availableVariants.map(item => <option key={item} value={item}>{reminderVariantLabels[item]}</option>)}</select><p>Date-specific drafts use the date at page load. Check the date and balance before sharing.</p></div>}
    <div className="reminder-language"><label htmlFor="reminder-language">Draft language</label><select id="reminder-language" value={language} onChange={e => { const value = e.target.value; if (value === "en" || value === "hi" || value === "mr") { setLanguage(value); invalidateCopyStatus(); } }}><option value="en">English</option><option value="hi">हिन्दी (Hindi)</option><option value="mr">मराठी (Marathi)</option></select><p>Switching keeps your edits for each draft type and language until you leave this page.</p></div>
    <label className="reminder-message-label" htmlFor="reminder-message">Message</label>
    <textarea id="reminder-message" rows={8} maxLength={2000} lang={language} value={message} onChange={e => { const value = e.target.value; setMessages(current => ({ ...current, [variant]: { ...(current[variant] ?? current.general), [language]: value } })); invalidateCopyStatus(); }} />
    {!canShare && <p className="draft-help">Enter a valid message of up to 2,000 characters to copy or open an app.</p>}
    <div className="reminder-copy"><button type="button" disabled={!canShare || copying} onClick={copy}>{copying ? "Copying…" : "Copy message"}</button><p role="status">{copyStatus}</p></div>
    <div className="reminder-share"><h3>Optional: open your messaging app</h3><p>Enter the recipient yourself and check it carefully. Opening WhatsApp shares the number and message with WhatsApp and may leave them in browser history. Opening email passes the address and message to your email app. You must review and send there; delivery is not tracked.</p>
      <div className="customer-fields"><label>WhatsApp number with country code<input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="e.g. +919876543210" maxLength={16} autoComplete="off" /><small>Digits only, with optional +. Do not include spaces.</small></label><label>Email address<input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" maxLength={254} autoComplete="off" /></label></div>
      <div className="reminder-links">{number && canShare && <a href={`https://wa.me/${number}?text=${encodedMessage}`} target="_blank" rel="noopener noreferrer">Open WhatsApp ↗</a>}{address && canShare && <a href={`mailto:${encodeURIComponent(address)}?subject=${encodeURIComponent(reminderSubjects[language])}&body=${encodedMessage}`}>Open email draft ↗</a>}</div>
    </div>
  </section>;
}
