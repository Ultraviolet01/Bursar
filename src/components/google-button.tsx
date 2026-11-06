// "Continue with Google". Only rendered when GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set.
export function GoogleButton({ next }: { next?: string }) {
  return (
    <a
      href={`/auth/google${next ? `?next=${encodeURIComponent(next)}` : ""}`}
      className="btn-outline w-full py-2.5"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09Z" />
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.24 1.05-3.72 1.05-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
        <path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.94l3.66-2.84Z" />
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z" />
      </svg>
      Continue with Google
    </a>
  );
}

export function Divider({ label = "or" }: { label?: string }) {
  return (
    <div className="my-6 flex items-center gap-3 text-sm text-muted" role="separator">
      <span className="h-px flex-1 bg-line" />
      {label}
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

export const AUTH_ERRORS: Record<string, string> = {
  google_off: "Google sign-in is not set up on this server yet. Use email instead.",
  google_cancelled: "Google sign-in was cancelled.",
  google_expired: "That Google sign-in took too long. Try again.",
  google_state: "That Google sign-in could not be matched to this browser. Try again.",
  google_failed: "Google sign-in failed. Try again, or use email.",
  google_unverified: "Google has not verified that email address, so Bursar cannot use it.",
};
