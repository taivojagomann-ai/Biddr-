import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { loginErrorMessage } from "@/lib/login";
import { safeNext } from "@/lib/redirect";
import { getServerSupabase } from "@/lib/supabase/server";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

type SearchParams = { next?: string | string[]; error?: string | string[] };

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const next = safeNext(searchParams.next);
  const supabase = getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect(next);

  return (
    <main className="container flex justify-center py-12 sm:py-20">
      <div className="w-full max-w-sm">
        <h1 className="font-wide text-3xl font-extrabold tracking-tight">Sign in to bid</h1>
        <p className="mt-3 text-sm text-mute">
          One account lets you bid, ask sellers questions and list a car. New to Biddr? The same steps create your
          account.
        </p>
        <LoginForm next={next} initialError={loginErrorMessage(searchParams.error)} />
      </div>
    </main>
  );
}
