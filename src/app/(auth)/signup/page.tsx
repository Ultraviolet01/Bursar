import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { GoogleSignIn } from "@/components/google-signin";
import { getSession } from "@/lib/auth";

export const metadata: Metadata = { title: "Create account | Bursar" };
export const dynamic = "force-dynamic";

export default async function SignUp() {
  if (await getSession()) redirect("/app");
  return <GoogleSignIn title="Create your account" lead="One Google sign-in for every company you run. New here? Continuing with Google creates your account." />;
}
