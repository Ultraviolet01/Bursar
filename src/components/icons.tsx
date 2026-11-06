// Line icons drawn to match the reference sidebar (1.5px strokes, 20px box).
type P = { className?: string };
const base = (path: React.ReactNode, className = "h-5 w-5") => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
    {path}
  </svg>
);

export const IconGrid = ({ className }: P) => base(<><rect x="4" y="4" width="6.5" height="6.5" rx="1" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1" /></>, className);
export const IconInbox = ({ className }: P) => base(<><path d="M4 13.5 6.2 6.6A1.5 1.5 0 0 1 7.6 5.5h8.8a1.5 1.5 0 0 1 1.4 1.1L20 13.5" /><path d="M4 13.5V18a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 18v-4.5h-4.5a3.5 3.5 0 0 1-7 0Z" /></>, className);
export const IconList = ({ className }: P) => base(<><path d="M9 6.5h11M9 12h11M9 17.5h11" /><path d="M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" /></>, className);
export const IconSliders = ({ className }: P) => base(<><path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1" /><path d="M15 5v4M9 10v4M17 15v4" /></>, className);
export const IconWallet = ({ className }: P) => base(<><path d="M18.5 8V6.5A1.5 1.5 0 0 0 17 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12.5a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 18.5 8H6" /><path d="M15.5 13.5h.01" /><rect x="13" y="11" width="7" height="5" rx="1" /></>, className);
export const IconCalendar = ({ className }: P) => base(<><rect x="4" y="5.5" width="16" height="14.5" rx="1.5" /><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" /></>, className);
export const IconUsers = ({ className }: P) => base(<><circle cx="9" cy="8.5" r="3.2" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17.5 14.2A5.5 5.5 0 0 1 20.5 19" /></>, className);
export const IconCog = ({ className }: P) => base(<><circle cx="12" cy="12" r="3" /><path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4 6 18M18 18l-1.6-1.6M7.6 7.6 6 6" /></>, className);
export const IconPause = ({ className }: P) => base(<><rect x="6.5" y="5" width="3.5" height="14" rx="1" /><rect x="14" y="5" width="3.5" height="14" rx="1" /></>, className);
export const IconPlay = ({ className }: P) => base(<path d="M7.5 5.5v13l11-6.5z" />, className);
export const IconCheck = ({ className }: P) => base(<path d="m5.5 12.5 4 4 9-9" />, className);
export const IconX = ({ className }: P) => base(<path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />, className);
export const IconShield = ({ className }: P) => base(<><path d="M12 3.5 5 6v5.5c0 4.3 3 7.6 7 9 4-1.4 7-4.7 7-9V6z" /><path d="m9 12 2.2 2.2L15.5 10" /></>, className);
export const IconArrowRight = ({ className }: P) => base(<path d="M4 12h15M14 6.5 19.5 12 14 17.5" />, className);
export const IconArrowUpRight = ({ className }: P) => base(<path d="M7 17 17 7M9 7h8v8" />, className);
export const IconSearch = ({ className }: P) => base(<><circle cx="11" cy="11" r="6" /><path d="m19.5 19.5-4-4" /></>, className);
export const IconMenu = ({ className }: P) => base(<path d="M4 7h16M4 12h16M4 17h16" />, className);
/** The load-line mark (Plimsoll disc) from the reference design. */
export const IconLine = ({ className }: P) => (
  <svg viewBox="0 0 32 20" fill="none" stroke="currentColor" strokeWidth={1.8} className={className ?? "h-5 w-7"} aria-hidden>
    <circle cx="16" cy="10" r="6.5" />
    <path d="M2 10h28" />
  </svg>
);
