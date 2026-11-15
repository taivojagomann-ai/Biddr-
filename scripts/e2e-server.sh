#!/usr/bin/env bash
# Builds and starts the app for the end-to-end tests against the local stack,
# with the same settings as playwright.e2e.config.ts. Handy while writing tests:
# `npm run test:e2e` reuses a server that is already running (outside CI).
set -euo pipefail
export NEXT_DIST_DIR=.next-e2e
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
export NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0
export SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU
export NEXT_PUBLIC_SITE_URL=http://localhost:3100
export NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_e2e_only
export STRIPE_SECRET_KEY=sk_test_e2e_only
export STRIPE_WEBHOOK_SECRET=whsec_e2e_only
export E2E_STRIPE_MOCK=true
export CRON_SECRET=e2e-cron-secret
export ENABLE_DEMO_DATA=true
export BID_HOLD_AMOUNT_EUR=500
export NEXT_TELEMETRY_DISABLED=1
npx next build
exec npx next start -p 3100
