import type { SVGProps } from "react";
import type { SocialPlatformId } from "@/lib/social-platforms";

export function SocialIcon({ platform, ...props }: SVGProps<SVGSVGElement> & { platform: SocialPlatformId }) {
  const shared = { viewBox: "0 0 24 24", fill: "currentColor", "aria-hidden": true } as const;

  if (platform === "facebook") {
    return <svg {...shared} {...props}><path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5.02 3.66 9.18 8.44 9.94v-7.03H7.9v-2.9h2.54V9.85c0-2.52 1.5-3.91 3.77-3.91 1.09 0 2.24.2 2.24.2V8.6h-1.26c-1.24 0-1.63.78-1.63 1.57v1.89h2.78l-.45 2.9h-2.33V22C18.34 21.24 22 17.08 22 12.06Z" /></svg>;
  }
  if (platform === "instagram") {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props} aria-hidden><rect x="2" y="2" width="20" height="20" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" /></svg>;
  }
  if (platform === "whatsapp") {
    return <svg {...shared} {...props}><path d="M12.04 2a9.96 9.96 0 0 0-8.62 14.96L2 22l5.16-1.35a9.96 9.96 0 1 0 4.88-18.65Zm0 18.16a8.26 8.26 0 0 1-4.21-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.27 8.27 0 1 1 7 3.86Zm4.53-6.18c-.25-.13-1.47-.72-1.7-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.15.16-.29.18-.53.06-1.45-.73-2.4-1.3-3.37-2.95-.25-.43.25-.4.72-1.33.08-.17.04-.31-.02-.44-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.42h-.47c-.16 0-.43.06-.65.31-.22.25-.85.84-.85 2.03 0 1.2.87 2.35.99 2.51.12.17 1.72 2.62 4.16 3.68 1.55.67 2.16.72 2.93.61.47-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.23-.16-.48-.29Z" /></svg>;
  }
  if (platform === "youtube") {
    return <svg {...shared} {...props}><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8ZM9.6 15.6V8.4l6.3 3.6-6.3 3.6Z" /></svg>;
  }
  if (platform === "tiktok") {
    return <svg {...shared} {...props}><path d="M15.6 2c.2 1.7 1.2 3.3 2.7 4.2a7 7 0 0 0 3.7 1.1v3.8a10.8 10.8 0 0 1-6.3-2v7.1A6.2 6.2 0 1 1 10.3 10v3.9a2.4 2.4 0 1 0 1.6 2.3V2h3.7Z" /></svg>;
  }
  return <svg {...shared} {...props}><path d="M18.9 2H22l-6.8 7.8L23.2 22H17l-4.9-6.4L6.5 22H3.4l7.2-8.3L.9 2h6.4l4.4 5.8L18.9 2Zm-1.1 17.9h1.7L6.4 4H4.6l13.2 15.9Z" /></svg>;
}
