-- ═══════════════════════════════════════════════════════════════════════════
--  0020 — Withdrawal fee
--
--  The aggregator model, made a dial: collecting money in (pay-ins, `retrait`)
--  stays free, and taking money out (`depot` payouts from the CamerPay console)
--  carries a percentage fee that is withheld from what the recipient receives
--  and stays in the platform balance. That is the revenue.
--
--  Both knobs live in `settings`, same as the service charge — an
--  administrator turns them on / off and sets the rate without a deploy:
--
--    · withdrawal_fee_enabled  — boolean. OFF by default: the pilot stays
--      free until the fee is deliberately switched on.
--    · withdrawal_fee_percent  — the rate, e.g. '1.5' = 1.5 %. Parsed with
--      Number(); 0 or unparseable means "no fee".
--
--  The admin settings page renders these automatically (the form is generic
--  over `settings.category` = 'payments'), and the CamerPay console reads
--  them per payout so the displayed math and the executed math can never
--  disagree.
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.settings (key, value, value_type, category, label, description)
values
  ('withdrawal_fee_enabled', 'false', 'boolean', 'payments', 'Withdrawal fee',
   'Off = payouts are free. On = every payout from the CamerPay console withholds this % from what the recipient receives; the withheld amount stays in the platform balance.'),
  ('withdrawal_fee_percent', '1.5', 'string', 'payments', 'Withdrawal fee %',
   'Applied to the gross amount the recipient is owed, rounded to whole francs, withheld from the payout. Pay-ins are always free.')
on conflict (key) do nothing;
