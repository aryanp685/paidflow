"use client";

import { ArrowRight, ArrowUpRight, Check, FileText, FolderLock, Globe2, MessageSquareText, ShieldCheck, Sparkles, UsersRound, WalletCards, ScanLine, BarChart3, LockKeyhole } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { faqs } from "@/lib/constants";
import { Brand } from "./brand";
import { Reveal, Stagger, StaggerItem } from "./reveal";
import type { Translations } from "@/lib/i18n/translations";

const features = [{ icon: FileText, title: "Invoice management", text: "Create and organize invoices with a clear view of what is due.", label: "01 / INVOICES" }, { icon: WalletCards, title: "Payment tracking", text: "Keep a record of full and partial payments against your invoices.", label: "02 / PAYMENTS" }, { icon: MessageSquareText, title: "Smart reminders", text: "Prepare thoughtful follow-ups for the right moment.", label: "03 / FOLLOW-UPS" }, { icon: UsersRound, title: "Customer payment history", text: "Bring conversations and payment records into one customer view.", label: "04 / CUSTOMERS" }, { icon: FolderLock, title: "Evidence vault", text: "Keep payment proofs and supporting documents organized.", label: "05 / DOCUMENTS" }, { icon: BarChart3, title: "Receivables analytics", text: "Make sense of aging balances and collection trends.", label: "06 / INSIGHTS" }, { icon: ScanLine, title: "OCR invoice reader", text: "Extract details from existing invoices, with your review before saving.", label: "07 / EXTRACTION" }, { icon: Globe2, title: "Hindi & Marathi support", text: "Prepare reminder messages in the language that feels right.", label: "08 / LANGUAGE" }];

const plans = [{ name: "Free", price: "0", description: "For getting a feel for a more organized way to work.", features: ["A starting point for receivables", "Invoice and payment organization", "Essential follow-up workflows"] }, { name: "Starter", price: "199", description: "For growing businesses ready for a little more clarity.", features: ["Everything in Free", "More room to organize your work", "Deeper customer context"], featured: true }, { name: "Growth", price: "499", description: "For teams building a more connected collection process.", features: ["Everything in Starter", "Designed for growing teams", "More receivables insights"] }];

export function Problem({ t }: { t: Translations }) {
  return (
    <section className="section problem-section">
      <div className="container problem-grid">
        <Reveal direction="right">
        <div>
          <div className="section-kicker"><span>01</span> {t.sections.problem.kicker}</div>
          <h2>{t.sections.problem.heading}</h2>
          <p className="section-lead">{t.sections.problem.description}</p>
          <a href="#how-it-works" className="text-link">{t.sections.problem.followUp} <ArrowUpRight size={15} /></a>
        </div>
        </Reveal>
        <Reveal direction="left" delay={0.1}>
        <div className="problem-board">
          <div className="board-top"><span>{t.sections.problem.everydayReality}</span><span>✳</span></div>
          <div className="problem-list">
            <div><span>01</span><strong>Invoices in one place.</strong><em>Payment proofs in another.</em></div>
            <div><span>02</span><strong>Follow-ups on your mind.</strong><em>Due dates easy to miss.</em></div>
            <div><span>03</span><strong>Work delivered.</strong><em>But what’s still outstanding?</em></div>
          </div>
          <div className="board-bottom"><span className="mini-brand">p.</span><span>{t.sections.problem.bringTogether}</span><ArrowRight size={17} /></div>
        </div>
        </Reveal>
      </div>
    </section>
  );
}

export function Features({ t }: { t: Translations }) {
  return (
    <section className="section features-section" id="features">
      <div className="container">
        <div className="section-heading features-heading">
          <Reveal>
            <div className="section-kicker"><span>02</span> {t.sections.features.kicker}</div>
            <h2>{t.sections.features.heading}</h2>
            <p>{t.sections.features.description}</p>
            <div className="planned-label"><Sparkles size={14} /> {t.sections.features.planned}</div>
          </Reveal>
        </div>
        <Stagger className="features-grid" amount={0.1}>
          {features.map(({ icon: Icon, title, text, label }, i) => (
            <StaggerItem className={`feature-card feature-${i + 1}`} key={title}>
              <div className="feature-top"><span className="feature-icon"><Icon size={19} /></span><span>{label}</span></div>
              <h3>{title}</h3>
              <p>{text}</p>
              {i === 0 && (
                <div className="feature-visual-invoice"><span><FileText size={14} /> INV-2026-0042</span><strong>₹48,500.00</strong><i>Partially paid</i></div>
              )}
              {i === 2 && (
                <div className="feature-visual-message"><span>Hi, a friendly reminder about your invoice...</span><MessageSquareText size={14} /></div>
              )}
              {i === 4 && (
                <div className="feature-visual-files"><span>PO</span><span>INV</span><span>POD</span><span>✓</span></div>
              )}
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  );
}

export function India({ t }: { t: Translations }) {
  const items = [
    ["₹", "INR, naturally", "Familiar Indian number formatting."],
    ["FY", "April to March", "Designed around the Indian financial year."],
    ["GST", "GST-oriented workflows", "Invoice fields for local business needs."],
    ["UPI", "UPI-friendly records", "Record the payment method you used."],
    ["अ", "Speak their language", "Hindi and Marathi reminder support planned."],
    ["✓", "Evidence in order", "Organize documents relevant to MSMEs."]
  ];
  return (
    <section className="section india-section">
      <div className="container india-grid">
        <Reveal direction="right">
        <div>
          <div className="section-kicker light-kicker"><span>06</span> {t.sections.india.kicker}</div>
          <h2>{t.sections.india.heading}</h2>
          <p>{t.sections.india.description}</p>
          <div className="india-stamp"><span>✳</span> {t.sections.india.stamp}</div>
        </div>
        </Reveal>
        <Stagger className="india-items" amount={0.1}>
          {items.map(([symbol, title, text]) => (
            <StaggerItem key={title}>
              <span className="india-symbol">{symbol}</span>
              <div><h3>{title}</h3><p>{text}</p></div>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  );
}

export function Security({ t }: { t: Translations }) {
  return (
    <section className="section security-section" id="security">
      <div className="container security-grid">
        <Reveal direction="scale" className="security-illustration">
          <div className="security-ring ring-a" />
          <div className="security-ring ring-b" />
          <div className="security-center"><ShieldCheck size={38} /></div>
          <div className="security-chip chip-a"><LockKeyhole size={14} /> {t.sections.security.chipPrivate}</div>
          <div className="security-chip chip-b"><UsersRound size={14} /> {t.sections.security.chipRole}</div>
          <span className="security-caption">{t.sections.security.caption} &nbsp; ✳</span>
        </Reveal>
        <Reveal direction="left" delay={0.1}>
        <div>
          <div className="section-kicker"><span>07</span> {t.sections.security.kicker}</div>
          <h2>{t.sections.security.heading}</h2>
          <p className="section-lead">{t.sections.security.description}</p>
          <div className="security-note"><ShieldCheck size={19} /><p>{t.sections.security.note}</p></div>
        </div>
        </Reveal>
      </div>
    </section>
  );
}

export function Pricing({ t }: { t: Translations }) {
  return (
    <section className="section pricing-section" id="pricing">
      <div className="container">
        <div className="section-heading pricing-heading">
          <Reveal>
            <div className="section-kicker"><span>08</span> {t.sections.pricing.kicker}</div>
            <h2>{t.sections.pricing.heading}</h2>
            <p>{t.sections.pricing.description}</p>
          </Reveal>
        </div>
        <Stagger className="pricing-grid" amount={0.1}>
          {plans.map((plan) => (
            <StaggerItem className={`price-card ${plan.featured ? "featured" : ""}`} key={plan.name}>
              <div className="plan-top"><span>{plan.name}</span>{plan.featured && <span className="plan-popular">A LITTLE MORE ROOM</span>}</div>
              <p>{plan.description}</p>
              <div className="plan-price"><span>₹</span>{plan.price}<small>/ month</small></div>
              <div className="plan-rule" />
              <ul>{plan.features.map((feature) => <li key={feature}><Check size={15} /> {feature}</li>)}</ul>
              <a href="/signup" className={plan.featured ? "price-button primary" : "price-button"}>{t.sections.pricing.explore} {plan.name} <ArrowUpRight size={16} /></a>
              <div className="concept-note">{t.sections.pricing.conceptNote}</div>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  );
}

export function Faq({ t }: { t: Translations }) {
  // TODO: translate the faqs array from @/lib/constants
  return (
    <section className="section faq-section" id="faq">
      <div className="container faq-grid">
        <Reveal direction="right">
        <div>
          <div className="section-kicker"><span>09</span> {t.sections.faq.kicker}</div>
          <h2>{t.sections.faq.heading}</h2>
          <p className="section-lead">{t.sections.faq.description}</p>
        </div>
        </Reveal>
        <Reveal direction="left" delay={0.1}>
        <Accordion type="single" collapsible className="faq-list">
          {faqs.map(([question, answer], i) => (
            <AccordionItem key={question} value={`faq-${i}`}>
              <AccordionTrigger>{question}</AccordionTrigger>
              <AccordionContent>{answer}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
        </Reveal>
      </div>
    </section>
  );
}

export function FinalCta({ t }: { t: Translations }) {
  return (
    <section className="final-section" id="availability">
      <div className="container">
        <Reveal direction="scale" className="final-card">
          <div className="final-decoration" aria-hidden="true">✳</div>
          <div className="section-kicker light-kicker"><span>10</span> {t.sections.finalCta.kicker}</div>
          <h2>{t.sections.finalCta.heading}</h2>
          <p>{t.sections.finalCta.description}</p>
          <a href="/signup" className="final-button">{t.sections.finalCta.button} <ArrowUpRight size={17} /></a>
          <span className="final-small">{t.sections.finalCta.small}</span>
        </Reveal>
      </div>
    </section>
  );
}

export function Footer({ t }: { t: Translations }) {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-grid">
          <div className="footer-brand">
            <Brand />
            <p>{t.sections.footer.tagline}</p>
            <span>{t.sections.footer.madeForIndia} &nbsp; ✳</span>
          </div>
          <div>
            <h3>{t.sections.footer.product}</h3>
            <a href="#features">{t.sections.footer.features}</a>
            <a href="#how-it-works">{t.sections.footer.howItWorks}</a>
            <a href="#pricing">{t.sections.footer.pricing}</a>
            <a href="#security">{t.sections.footer.security}</a>
          </div>
          <div>
            <h3>{t.sections.footer.resources}</h3>
            <a href="#faq">{t.sections.footer.faq}</a>
            <a href="#preview">{t.sections.footer.preview}</a>
          </div>
          <div>
            <h3>{t.sections.footer.company}</h3>
            <a href="#availability">{t.sections.footer.about}</a>
            <span>{t.sections.footer.contact}</span>
            <span>{t.sections.footer.privacy}</span>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} PAIDFLOW. {t.sections.footer.rights}</span>
          <span>{t.sections.footer.flowNote} &nbsp; ↗</span>
        </div>
      </div>
    </footer>
  );
}
