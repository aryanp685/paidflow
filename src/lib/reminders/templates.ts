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
