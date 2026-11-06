// One-shot toast messages, set by server actions and shown (then cleared) by <Toaster />.
import { cookies } from "next/headers";

export const FLASH_COOKIE = "bursar_flash";
export type FlashTone = "good" | "amber" | "bad" | "teal";
export interface Flash { id: number; message: string; tone: FlashTone }

export async function setFlash(message: string, tone: FlashTone = "good") {
  (await cookies()).set(FLASH_COOKIE, encodeURIComponent(JSON.stringify({ id: Date.now(), message, tone })), {
    path: "/",
    maxAge: 30,
    sameSite: "lax",
  });
}

export async function readFlash(): Promise<Flash | null> {
  const raw = (await cookies()).get(FLASH_COOKIE)?.value;
  if (!raw) return null;
  try {
    return JSON.parse(decodeURIComponent(raw)) as Flash;
  } catch {
    return null;
  }
}
