-- =============================================================================
-- 0032: One email for a paid premium, with both documents (DECISIONS.md point 15).
--
-- The "premium paid" email now carries the invoice and the receipt, so a payment
-- receipt no longer gets an email of its own (its bell notification stays). Refund
-- receipts are still emailed (with the credit note after a full refund).
--
-- Idempotent: safe to run more than once. Nothing is dropped.
-- =============================================================================

create or replace function public.notification_is_emailed(p_type text, p_data jsonb)
returns boolean language sql immutable as $$
  select case p_type
    when 'auction_won' then true
    when 'auction_ended' then coalesce(p_data->>'status', '') = 'sold'
    when 'premium_due' then true
    when 'premium_reminder' then true
    when 'premium_paid' then true
    when 'premium_unpaid' then true
    when 'buyer_did_not_pay' then coalesce(p_data->>'role', '') = 'seller'
    when 'second_chance_offer' then true
    when 'receipt_ready' then coalesce(p_data->>'receipt_type', '') = 'refund'
    else false
  end;
$$;
