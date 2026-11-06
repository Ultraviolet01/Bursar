"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import type { AuthState } from "@/app/(auth)/actions";
import { SubmitButton } from "./interactive";

type Mode = "signin" | "signup";

export function AuthForm({ mode, action, next }: { mode: Mode; action: (s: AuthState, f: FormData) => Promise<AuthState>; next?: string }) {
  const [state, formAction] = useActionState(action, {});
  const [show, setShow] = useState(false);
  const errId = "auth-error";
  return (
    <form action={formAction} className="space-y-5" noValidate aria-describedby={state.error ? errId : undefined}>
      {next && <input type="hidden" name="next" value={next} />}
      {state.error && (
        <div id={errId} role="alert" className="animate-shake rounded-xl border border-bad-line bg-bad-soft px-4 py-3 text-[15px] text-bad">
          {state.error}
        </div>
      )}
      {mode === "signup" && (
        <div>
          <label htmlFor="name" className="label">Full name</label>
          <input id="name" name="name" autoComplete="name" required defaultValue={state.fields?.name} className="input" />
        </div>
      )}
      <div>
        <label htmlFor="email" className="label">Work email</label>
        <input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.fields?.email} className="input" />
      </div>
      <div>
        <div className="flex items-center justify-between">
          <label htmlFor="password" className="label">Password</label>
          <button type="button" onClick={() => setShow((s) => !s)} className="mb-1 text-sm text-teal hover:underline" aria-controls="password">
            {show ? "Hide" : "Show"}
          </button>
        </div>
        <input
          id="password"
          name="password"
          type={show ? "text" : "password"}
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          required
          minLength={mode === "signup" ? 8 : undefined}
          aria-describedby={mode === "signup" ? "pw-hint" : undefined}
          className="input"
        />
        {mode === "signup" && <p id="pw-hint" className="mt-1 text-sm text-muted">At least 8 characters.</p>}
      </div>
      <SubmitButton className="btn-primary w-full py-2.5" pendingText={mode === "signin" ? "Signing in" : "Creating account"}>
        {mode === "signin" ? "Sign in" : "Create account"}
      </SubmitButton>
      <p className="text-center text-[15px] text-muted">
        {mode === "signin" ? (
          <>New to Bursar? <Link href="/signup" className="font-medium text-teal hover:underline">Create an account</Link></>
        ) : (
          <>Already have an account? <Link href="/signin" className="font-medium text-teal hover:underline">Sign in</Link></>
        )}
      </p>
    </form>
  );
}
