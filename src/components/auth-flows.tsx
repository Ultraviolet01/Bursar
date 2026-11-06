"use client";
// Forms for the email-based flows: sign-in links, password reset, and link confirmation.
import Link from "next/link";
import { useActionState, useState } from "react";
import type { AuthState } from "@/app/(auth)/actions";
import { SubmitButton } from "./interactive";

type Action = (s: AuthState, f: FormData) => Promise<AuthState>;

function ErrorBox({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <div role="alert" className="animate-shake rounded-xl border border-bad-line bg-bad-soft px-4 py-3 text-[15px] text-bad">
      {text}
    </div>
  );
}

function Sent({ email, what, devInbox }: { email?: string; what: string; devInbox: boolean }) {
  return (
    <div role="status" className="animate-page rounded-2xl border border-good/30 bg-good-soft p-5">
      <div className="text-[17px] font-medium text-ink">Check your email</div>
      <p className="mt-1 text-[15px] text-body">
        {what} {email ? <>to <span className="font-medium">{email}</span></> : null}. It works once and expires soon.
      </p>
      {devInbox && (
        <p className="mt-3 text-sm text-muted">
          No email provider is set up, so it went to the <Link href="/dev/mail" className="font-medium text-teal hover:underline">dev inbox</Link>.
        </p>
      )}
    </div>
  );
}

/** "Email me a sign-in link": works for new and existing founders, any email provider. */
export function LoginLinkForm({ action, devInbox }: { action: Action; devInbox: boolean }) {
  const [state, formAction] = useActionState(action, {});
  if (state.sent) return <Sent email={state.fields?.email} what="We sent a sign-in link" devInbox={devInbox} />;
  return (
    <form action={formAction} className="space-y-4" noValidate>
      <ErrorBox text={state.error} />
      <div>
        <label htmlFor="link-email" className="label">Email</label>
        <input id="link-email" name="email" type="email" autoComplete="email" required defaultValue={state.fields?.email} className="input" />
      </div>
      <SubmitButton className="btn-outline w-full py-2.5" pendingText="Sending link">Email me a sign-in link</SubmitButton>
    </form>
  );
}

export function ForgotForm({ action, devInbox }: { action: Action; devInbox: boolean }) {
  const [state, formAction] = useActionState(action, {});
  if (state.sent) return <Sent email={state.fields?.email} what="If an account uses that email, we sent a reset link" devInbox={devInbox} />;
  return (
    <form action={formAction} className="space-y-4" noValidate>
      <ErrorBox text={state.error} />
      <div>
        <label htmlFor="reset-email" className="label">Email</label>
        <input id="reset-email" name="email" type="email" autoComplete="email" required defaultValue={state.fields?.email} className="input" />
      </div>
      <SubmitButton className="btn-primary w-full py-2.5" pendingText="Sending">Send reset link</SubmitButton>
    </form>
  );
}

export function ResetForm({ action, token }: { action: Action; token: string }) {
  const [state, formAction] = useActionState(action, {});
  const [show, setShow] = useState(false);
  return (
    <form action={formAction} className="space-y-4" noValidate>
      <ErrorBox text={state.error} />
      <input type="hidden" name="token" value={token} />
      <div>
        <div className="flex items-center justify-between">
          <label htmlFor="new-password" className="label">New password</label>
          <button type="button" onClick={() => setShow((s) => !s)} className="mb-1 text-sm text-teal hover:underline" aria-controls="new-password">{show ? "Hide" : "Show"}</button>
        </div>
        <input id="new-password" name="password" type={show ? "text" : "password"} autoComplete="new-password" minLength={8} required aria-describedby="np-hint" className="input" />
        <p id="np-hint" className="mt-1 text-sm text-muted">At least 8 characters. Other devices are signed out.</p>
      </div>
      <SubmitButton className="btn-primary w-full py-2.5" pendingText="Saving">Save and sign in</SubmitButton>
    </form>
  );
}

/** One button press, so email scanners that open links cannot use up the token. */
export function ConfirmLinkForm({ action, token, email, isNew }: { action: Action; token: string; email: string; isNew: boolean }) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-4">
      <ErrorBox text={state.error} />
      <input type="hidden" name="token" value={token} />
      {isNew && (
        <div>
          <label htmlFor="confirm-name" className="label">Your full name</label>
          <input id="confirm-name" name="name" autoComplete="name" required minLength={2} className="input" />
        </div>
      )}
      <SubmitButton className="btn-primary w-full py-2.5" pendingText="Signing in">{isNew ? `Create account for ${email}` : `Sign in as ${email}`}</SubmitButton>
    </form>
  );
}
