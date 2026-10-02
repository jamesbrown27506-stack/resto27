/**
 * The developer's credit, which doubles as the WhatsApp contact. Website
 * footer only — never inside the installed app. The chat opens with a message
 * already written, so reaching out is one tap.
 */
export const DEVELOPER = { name: "Mrcode27", whatsappNumber: "237691098999" };

export function developerWhatsAppHref(message: string): string {
  return `https://wa.me/${DEVELOPER.whatsappNumber}?text=${encodeURIComponent(message)}`;
}
