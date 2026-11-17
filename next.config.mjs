/** @type {import('next').NextConfig} */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL) : null;
const supabaseHost = supabaseUrl ? supabaseUrl.hostname : "localhost";
// "http" only for a local Supabase (supabase start, or the a11y test's mock).
const supabaseProtocol = supabaseUrl?.protocol === "http:" ? "http" : "https";

const nextConfig = {
  // The end-to-end build uses its own folder so it never overwrites the normal one.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  experimental: {
    // The demo data loader (run from /admin) reads the real cover photos from disk,
    // so they must be shipped with that page's server code on Vercel.
    outputFileTracingIncludes: { "/admin": ["./lib/demo/photos/**/*"] },
  },
  images: {
    remotePatterns: [{ protocol: supabaseProtocol, hostname: supabaseHost, pathname: "/storage/v1/object/public/**" }],
  },
};

export default nextConfig;
