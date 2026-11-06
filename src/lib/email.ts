// Sends transactional email. With RESEND_API_KEY set it uses Resend's HTTP API;
// without it, emails go to the DevEmail table so they can be read at /dev/mail.
import { db } from "./db";

export interface Email {
  to: string;
  subject: string;
  text: string;
  link?: string;
}

export function emailMode(): "resend" | "dev" {
  return process.env.RESEND_API_KEY ? "resend" : "dev";
}

/** The /dev/mail inbox: only without a provider, and in production only if ENABLE_DEV_MAIL=1. */
export function devMailEnabled() {
  return emailMode() === "dev" && (process.env.NODE_ENV !== "production" || process.env.ENABLE_DEV_MAIL === "1");
}

export async function sendEmail(mail: Email): Promise<void> {
  if (emailMode() === "dev") {
    await db.devEmail.create({ data: mail });
    if (process.env.NODE_ENV !== "test") console.log(`[dev email] to ${mail.to}: ${mail.subject}${mail.link ? `\n  ${mail.link}` : ""}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || "Bursar <onboarding@resend.dev>",
      to: [mail.to],
      subject: mail.subject,
      text: mail.text,
      html: html(mail),
    }),
  });
  if (!res.ok) throw new Error(`Email provider refused the message (${res.status})`);
}

function escape(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function html(mail: Email) {
  const body = escape(mail.text).replace(/\n/g, "<br>");
  const button = mail.link
    ? `<p style="margin:28px 0"><a href="${escape(mail.link)}" style="background:#0E5E56;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Continue</a></p>`
    : "";
  return `<div style="font-family:system-ui,sans-serif;color:#26383F;max-width:520px;margin:auto;padding:24px">
<p style="font-family:Georgia,serif;font-size:24px;letter-spacing:.08em;color:#0F2D3A">BURSAR</p>
<p style="font-size:16px;line-height:1.5">${body}</p>${button}
<p style="font-size:13px;color:#53636A">If you did not ask for this, you can ignore this email.</p></div>`;
}
