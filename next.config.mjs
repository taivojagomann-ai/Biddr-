/** @type {import('next').NextConfig} */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL) : null;
const supabaseHost = supabaseUrl ? supabaseUrl.hostname : "localhost";
// "http" only for a local Supabase (supabase start, or the a11y test's mock).
const supabaseProtocol = supabaseUrl?.protocol === "http:" ? "http" : "https";

const nextConfig = {
  images: {
    remotePatterns: [{ protocol: supabaseProtocol, hostname: supabaseHost, pathname: "/storage/v1/object/public/**" }],
  },
};

export default nextConfig;
