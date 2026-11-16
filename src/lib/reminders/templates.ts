import { z } from "zod";

export type ReminderLanguage = "en" | "hi" | "mr";
export type ReminderTemplates = Record<ReminderLanguage, string>;
export type ReminderDetails = { customerName: string; invoiceNumber: string; dueDate: string; balance: string; businessName: string };

/** Editable starting text, not a translation service or independent payment verification. */
export function reminderTemplates({ customerName, invoiceNumber, dueDate, balance, businessName }: ReminderDetails): ReminderTemplates {
  return {
    en: `Hello ${customerName},\n\nThis is a reminder about invoice ${invoiceNumber}, due ${dueDate}. Our records show a balance of ${balance}. Please let us know the payment status.\n\nThank you,\n${businessName}`,
    hi: `नमस्ते ${customerName},\n\nयह इनवॉइस ${invoiceNumber} के लिए एक अनुस्मारक है। इसकी देय तारीख ${dueDate} है। हमारे रिकॉर्ड के अनुसार बकाया राशि ${balance} है। कृपया भुगतान की स्थिति बताएं।\n\nधन्यवाद,\n${businessName}`,
    mr: `नमस्कार ${customerName},\n\nहे इनव्हॉइस ${invoiceNumber} बाबत स्मरणपत्र आहे. देय तारीख ${dueDate} आहे. आमच्या नोंदीनुसार ${balance} रक्कम बाकी आहे. कृपया पेमेंटची स्थिती कळवा.\n\nधन्यवाद,\n${businessName}`,
  };
}
export const reminderSubjects: Record<ReminderLanguage, string> = {
  en: "Invoice payment reminder", hi: "इनवॉइस भुगतान का अनुस्मारक", mr: "इनव्हॉइस पेमेंटसाठी स्मरणपत्र",
};

export type ReminderVariant = "general" | "upcoming" | "today" | "overdue";
export type ReminderVariants = Partial<Record<ReminderVariant, ReminderTemplates>> & { general: ReminderTemplates };
export const reminderVariantLabels: Record<ReminderVariant, string> = {
  general: "General follow-up", upcoming: "Upcoming due date", today: "Due today", overdue: "Overdue follow-up",
};

/** Offer a date-specific draft only when it matches the server's India-date snapshot. */
export function reminderTemplateVariants(details: ReminderDetails, asOf: string): ReminderVariants {
  // ISO dates sort in calendar order; invalid dates must not produce a date claim.
  if (!z.iso.date().safeParse(asOf).success || !z.iso.date().safeParse(details.dueDate).success) throw new Error("Invalid reminder date.");
  const general = reminderTemplates(details);
  const variant: Exclude<ReminderVariant, "general"> = details.dueDate > asOf ? "upcoming" : details.dueDate === asOf ? "today" : "overdue";
  const { customerName, invoiceNumber, dueDate, balance, businessName } = details;
  const line: Record<Exclude<ReminderVariant, "general">, ReminderTemplates> = {
    upcoming: {
      en: `Invoice ${invoiceNumber} is due on ${dueDate}.`,
      hi: `इनवॉइस ${invoiceNumber} की देय तारीख ${dueDate} है।`,
      mr: `इनव्हॉइस ${invoiceNumber} ची देय तारीख ${dueDate} आहे.`,
    },
    today: {
      en: `Invoice ${invoiceNumber} is due today, ${dueDate}.`,
      hi: `इनवॉइस ${invoiceNumber} आज ${dueDate} को देय है।`,
      mr: `इनव्हॉइस ${invoiceNumber} आज ${dueDate} रोजी देय आहे.`,
    },
    overdue: {
      en: `Invoice ${invoiceNumber} was due on ${dueDate}.`,
      hi: `इनवॉइस ${invoiceNumber} की देय तारीख ${dueDate} थी।`,
      mr: `इनव्हॉइस ${invoiceNumber} ची देय तारीख ${dueDate} होती.`,
    },
  };
  return { general, [variant]: {
    en: `Hello ${customerName},\n\n${line[variant].en} Our records show a balance of ${balance}. Please let us know the payment status.\n\nThank you,\n${businessName}`,
    hi: `नमस्ते ${customerName},\n\n${line[variant].hi} हमारे रिकॉर्ड के अनुसार बकाया राशि ${balance} है। कृपया भुगतान की स्थिति बताएं।\n\nधन्यवाद,\n${businessName}`,
    mr: `नमस्कार ${customerName},\n\n${line[variant].mr} आमच्या नोंदीनुसार ${balance} रक्कम बाकी आहे. कृपया पेमेंटची स्थिती कळवा.\n\nधन्यवाद,\n${businessName}`,
  } };
}
