"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSession } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/crypto";
import { db } from "@/lib/db";
import { setFlash } from "@/lib/flash";

export interface AuthState {
  error?: string;
  fields?: Record<string, string>;
}

const safeNext = (v: FormDataEntryValue | null) => {
  const s = typeof v === "string" ? v : "";
  return s.startsWith("/app") ? s : "/app";
};

export async function signInAction(_: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const user = email ? await db.user.findUnique({ where: { email } }) : null;
  // Same message either way, so the form does not reveal which emails exist.
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return { error: "That email and password do not match an account.", fields: { email } };
  }
  const first = await db.company.findFirst({ where: { ownerId: user.id }, orderBy: { createdAt: "asc" } });
  await createSession(user.id, first?.id);
  await setFlash(`Welcome back, ${user.name.split(" ")[0]}.`, "teal");
  redirect(first ? safeNext(formData.get("next")) : "/onboarding");
}

const SignUp = z.object({
  name: z.string().trim().min(2, "Enter your full name."),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
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
  await createSession(user.id);
  redirect("/onboarding");
}
