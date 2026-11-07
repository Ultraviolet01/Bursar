import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { GoogleSignIn } from "@/components/google-signin";
import { getSession } from "@/lib/auth";

export const metadata: Metadata = { title: "Sign in | Bursar" };
export const dynamic = "force-dynamic";

export default async function SignIn({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  if (await getSession()) redirect("/app");
  const { next, error } = await searchParams;
  return <GoogleSignIn title="Sign in" lead="Pick up where Bursar left off across all your companies." next={next} error={error} />;
}
