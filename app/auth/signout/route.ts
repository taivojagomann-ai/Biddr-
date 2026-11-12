import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  await getServerSupabase().auth.signOut();
  revalidatePath("/", "layout");
  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}
