export const navigation = [
  { label: "Product", href: "#product" },
  { label: "Features", href: "#features" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Pricing", href: "#pricing" },
  { label: "Security", href: "#security" },
] as const;
export const faqs = [
  ["What is PAIDFLOW?", "PAIDFLOW is a planned receivables workspace for keeping invoices, payment records, follow-ups and evidence together. This page previews the product we are building."],
  ["Who is it for?", "It is being designed for Indian businesses that sell to other businesses and want a clearer picture of the money they are owed."],
  ["Does it replace Tally?", "No. PAIDFLOW is intended to work alongside accounting tools such as Tally and Zoho Books as a receivables and follow-up layer. Integrations are not available yet."],
  ["Can I track partial payments?", "Partial and multiple payment tracking is planned. The product is not available yet, so no payment records can be created today."],
  ["Can I send reminders through WhatsApp?", "We plan to offer copy-ready messages and WhatsApp click-to-chat links. Messages would be sent by you, not automatically by PAIDFLOW."],
  ["Does PAIDFLOW automatically verify UPI payments?", "No. A UPI transfer or screenshot is not automatically verified. Payment records will be clearly marked as user-recorded unless a future verification integration is introduced."],
  ["Can I upload existing invoices?", "Invoice uploads and a human-reviewed document reader are planned. Extracted information will need your review before it becomes a record."],
  ["Is my business data private?", "The planned application is designed around business-level isolation, role-based access and private documents. These controls are not implemented in this marketing preview yet."],
] as const;
