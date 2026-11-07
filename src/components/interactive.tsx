"use client";
// Small client pieces that make the app feel alive: pending buttons, toasts,
// page transitions, count-up numbers and scroll reveals. All respect reduced motion.
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import type { Flash } from "@/lib/flash";
import { IconCheck, IconX } from "./icons";

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`animate-spin ${className}`} aria-hidden>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** A submit button that shows progress and blocks double submits. */
export function SubmitButton({ children, pendingText, className = "btn-primary" }: { children: React.ReactNode; pendingText?: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending}>
      {pending && <Spinner />}
      <span>{pending ? pendingText ?? "Working" : children}</span>
    </button>
  );
}

const TONE: Record<Flash["tone"], string> = {
  good: "border-good/30 bg-surface text-ink [&_.dot]:bg-good",
  teal: "border-teal/30 bg-surface text-ink [&_.dot]:bg-teal",
  amber: "border-amber-line bg-surface text-ink [&_.dot]:bg-amber-dot",
  bad: "border-bad-line bg-surface text-ink [&_.dot]:bg-bad",
};

export function Toaster({ flash }: { flash: Flash | null }) {
  const [toast, setToast] = useState<Flash | null>(null);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (!flash) return;
    document.cookie = "bursar_flash=; Max-Age=0; path=/";
    setToast(flash);
    setLeaving(false);
    const a = setTimeout(() => setLeaving(true), 5200);
    const b = setTimeout(() => setToast(null), 5600);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [flash?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(420px,calc(100vw-2rem))] flex-col gap-2" role="status" aria-live="polite">
      {toast && (
        <div className={`pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 shadow-lg ${TONE[toast.tone]} ${leaving ? "animate-toast-out" : "animate-toast-in"}`}>
          <span className="dot mt-1.5 h-2 w-2 shrink-0 rounded-full" aria-hidden />
          <span className="flex-1 text-[15px]">{toast.message}</span>
          <button type="button" onClick={() => setToast(null)} className="rounded p-0.5 text-muted hover:text-ink" aria-label="Dismiss message">
            <IconX className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

const WELCOME_KEY = "bursar_welcome";

/** Inside the onboarding form: once it submits, start clearing the blur and remember to finish it on arrival. */
export function WelcomeOnSubmit() {
  const { pending } = useFormStatus();
  useEffect(() => {
    if (!pending) return;
    try {
      sessionStorage.setItem(WELCOME_KEY, "1");
    } catch {}
    document.body.classList.add("onboarding-leaving");
  }, [pending]);
  return null;
}

/** Wraps the app. Right after onboarding, the interface sharpens out of the blur. */
export function WelcomeReveal({ children }: { children: React.ReactNode }) {
  const [reveal, setReveal] = useState(false);
  useEffect(() => {
    document.body.classList.remove("onboarding-leaving");
    try {
      if (sessionStorage.getItem(WELCOME_KEY)) {
        sessionStorage.removeItem(WELCOME_KEY);
        setReveal(true);
      }
    } catch {}
  }, []);
  return (
    <div className={reveal ? "animate-unblur" : undefined} onAnimationEnd={(e) => e.target === e.currentTarget && setReveal(false)}>
      {children}
    </div>
  );
}

/** Fades and lifts each page in on navigation. */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <div key={path} className="animate-page">
      {children}
    </div>
  );
}

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Counts a money figure up from zero on first view. The final value is in the DOM for screen readers. */
export function CountUp({ value, decimals = 2 }: { value: number; decimals?: number }) {
  const fmt = (minor: number) =>
    (minor / 100).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const [shown, setShown] = useState(fmt(value));
  useEffect(() => {
    if (reducedMotion()) return setShown(fmt(value));
    let raf = 0;
    const start = performance.now();
    const dur = 900;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(fmt(Math.round(value * eased)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <span aria-hidden>{shown}</span>
      <span className="sr-only">{fmt(value)}</span>
    </>
  );
}

/** Reveals children when they scroll into view. */
export function Reveal({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reducedMotion() || !("IntersectionObserver" in window)) return setSeen(true);
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`reveal ${seen ? "reveal-in" : ""} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

export function CheckBadge() {
  return (
    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-good text-surface">
      <IconCheck className="h-4 w-4" />
    </span>
  );
}
