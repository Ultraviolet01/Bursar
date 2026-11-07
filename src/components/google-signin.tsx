import { AUTH_ERRORS, GoogleButton } from "./google-button";
import { googleEnabled, testLoginEnabled } from "@/lib/google";

/** The whole sign-in and sign-up screen: Google only. */
export function GoogleSignIn({ title, lead, next, error }: { title: string; lead: string; next?: string; error?: string }) {
  const google = googleEnabled();
  return (
    <>
      <h1 className="display text-[44px] leading-tight text-ink">{title}</h1>
      <p className="mb-8 mt-2 text-[16px] text-muted">{lead}</p>
      {error && AUTH_ERRORS[error] && (
        <div role="alert" className="animate-shake mb-6 rounded-xl border border-bad-line bg-bad-soft px-4 py-3 text-[15px] text-bad">{AUTH_ERRORS[error]}</div>
      )}
      {google ? (
        <GoogleButton next={next} />
      ) : (
        <div className="rounded-xl border border-amber-line bg-amber-card px-4 py-3 text-[15px] text-ink">
          Google sign-in is not configured on this server. Set <code className="font-mono">GOOGLE_CLIENT_ID</code> and <code className="font-mono">GOOGLE_CLIENT_SECRET</code>.
        </div>
      )}
      <p className="mt-6 text-sm text-muted">
        Bursar uses your Google account (Gmail or Google Workspace) to sign you in. It only reads your name and email address, and never your inbox.
      </p>
      {testLoginEnabled() && (
        <form action="/auth/test-login" method="get" className="mt-8 space-y-3 rounded-xl border border-dashed border-line p-4">
          <div className="text-sm font-medium text-ink">Local test sign-in</div>
          <p className="text-sm text-muted">Only on this machine (ENABLE_TEST_LOGIN=1). Never available on Vercel.</p>
          <label htmlFor="test-email" className="label">Email</label>
          <input id="test-email" name="email" type="email" required className="input" placeholder="you@gmail.com" />
          <label htmlFor="test-name" className="label">Name</label>
          <input id="test-name" name="name" className="input" placeholder="Ada Obi" />
          <button className="btn-outline w-full">Sign in for testing</button>
        </form>
      )}
    </>
  );
}
