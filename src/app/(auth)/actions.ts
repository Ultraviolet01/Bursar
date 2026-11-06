"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSession } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/crypto";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { setFlash } from "@/lib/flash";
import { appUrl, consumeToken, issueToken, TooManyRequests } from "@/lib/tokens";

export interface AuthState {
  error?: string;
  sent?: boolean;
  fields?: Record<string, string>;
}

const safeNext = (v: FormDataEntryValue | null) => {
  const s = typeof v === "string" ? v : "";
  return s.startsWith("/app") ? s : "/app";
};

const Email = z.string().trim().toLowerCase().email("Enter a valid email address.");

async function base() {
  const h = await headers();
  return appUrl(h.get("x-forwarded-host") ?? h.get("host"), h.get("x-forwarded-proto"));
}

async function landAfterSignIn(userId: string, name: string, next?: FormDataEntryValue | null): Promise<never> {
  const first = await db.company.findFirst({ where: { ownerId: userId }, orderBy: { createdAt: "asc" } });
  await createSession(userId, first?.id);
  await setFlash(`Welcome${first ? " back" : ""}, ${name.split(" ")[0]}.`, "teal");
  redirect(first ? safeNext(next ?? null) : "/onboarding");
}

// ---- Password ----

export async function signInAction(_: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const user = email ? await db.user.findUnique({ where: { email } }) : null;
  if (user && !user.passwordHash) {
    return { error: "This account signs in with Google or an email link. Use one of those, or reset your password to set one.", fields: { email } };
  }
  // Same message either way, so the form does not reveal which emails exist.
  if (!user || !verifyPassword(password, user.passwordHash!)) {
    return { error: "That email and password do not match an account.", fields: { email } };
  }
  return landAfterSignIn(user.id, user.name, formData.get("next"));
}

const SignUp = z.object({
  name: z.string().trim().min(2, "Enter your full name."),
  email: Email,
  password: z.string().min(8, "Use at least 8 characters for your password."),
});

export async function signUpAction(_: AuthState, formData: FormData): Promise<AuthState> {
  const raw = Object.fromEntries(formData) as Record<string, string>;
  const parsed = SignUp.safeParse(raw);
  const fields = { name: raw.name ?? "", email: raw.email ?? "" };
  if (!parsed.success) return { error: parsed.error.issues[0].message, fields };
  if (await db.user.findUnique({ where: { email: parsed.data.email } })) {
    return { error: "An account with that email already exists. Sign in instead.", fields };
  }
  const user = await db.user.create({ data: { name: parsed.data.name, email: parsed.data.email, passwordHash: hashPassword(parsed.data.password) } });
  await sendVerification(user.id, user.email, user.name).catch(() => {});
  await createSession(user.id);
  redirect("/onboarding");
}

// ---- Email confirmation ----

export async function sendVerification(userId: string, email: string, name: string) {
  const token = await issueToken("VERIFY", email, userId);
  const link = `${await base()}/auth/verify?token=${token}`;
  await sendEmail({ to: email, subject: "Confirm your email for Bursar", text: `Hi ${name.split(" ")[0]},\n\nConfirm this is your email so Bursar can reach you about approvals and payments.`, link });
}

// ---- Email sign-in links (work for sign-up too) ----

export async function requestLoginLink(_: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = Email.safeParse(formData.get("email"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const email = parsed.data;
  const user = await db.user.findUnique({ where: { email } });
  try {
    const token = await issueToken("LOGIN", email, user?.id);
    const link = `${await base()}/signin/confirm?token=${token}`;
    await sendEmail({
      to: email,
      subject: user ? "Your Bursar sign-in link" : "Create your Bursar account",
      text: `${user ? "Use this link to sign in to Bursar." : "Use this link to create your Bursar account."} It works once and expires in 15 minutes.`,
      link,
    });
  } catch (e) {
    if (e instanceof TooManyRequests) return { error: e.message, fields: { email } };
    return { error: "We could not send the email. Try again in a minute.", fields: { email } };
  }
  return { sent: true, fields: { email } };
}

export async function confirmLoginLink(_: AuthState, formData: FormData): Promise<AuthState> {
  const row = await consumeToken("LOGIN", String(formData.get("token") ?? ""));
  if (!row) return { error: "This link has expired or was already used. Ask for a new one." };
  let user = await db.user.findUnique({ where: { email: row.email } });
  if (!user) {
    const local = row.email.split("@")[0].replace(/[._-]+/g, " ");
    const name = String(formData.get("name") ?? "").trim() || local.replace(/\b\w/g, (c) => c.toUpperCase());
    user = await db.user.create({ data: { email: row.email, name, emailVerifiedAt: new Date() } });
  } else if (!user.emailVerifiedAt) {
    user = await db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
  }
  return landAfterSignIn(user.id, user.name);
}

// ---- Password reset ----

export async function requestReset(_: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = Email.safeParse(formData.get("email"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const user = await db.user.findUnique({ where: { email: parsed.data } });
  // Same answer whether or not the account exists.
  if (user) {
    try {
      const token = await issueToken("RESET", user.email, user.id);
      await sendEmail({
        to: user.email,
        subject: "Reset your Bursar password",
        text: `Hi ${user.name.split(" ")[0]},\n\nUse this link to choose a new password. It works once and expires in 30 minutes.`,
        link: `${await base()}/reset?token=${token}`,
      });
    } catch (e) {
      if (e instanceof TooManyRequests) return { error: e.message, fields: { email: parsed.data } };
    }
  }
  return { sent: true, fields: { email: parsed.data } };
}

export async function resetPassword(_: AuthState, formData: FormData): Promise<AuthState> {
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) return { error: "Use at least 8 characters for your password." };
  const row = await consumeToken("RESET", String(formData.get("token") ?? ""));
  if (!row?.userId) return { error: "This reset link has expired or was already used. Ask for a new one." };
  const user = await db.user.update({ where: { id: row.userId }, data: { passwordHash: hashPassword(password), emailVerifiedAt: new Date() } });
  // A reset signs out every other device.
  await db.session.deleteMany({ where: { userId: user.id } });
  return landAfterSignIn(user.id, user.name);
}
