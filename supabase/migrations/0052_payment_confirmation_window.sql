-- 52. Five-minute Mobile Money confirmation window
--
-- A customer who closes the browser must receive the same expiry decision as a
-- customer who waits on the payment screen. The application atomically marks
-- expired attempts failed; this schedule makes the reconciler reach that
-- decision within one minute after the five-minute window.

do $$
declare
  v_base text;
  v_secret text;
begin
  select nullif(trim(value), '') into v_base
  from public.settings
  where key = 'cron_base_url';

  select nullif(trim(value), '') into v_secret
  from public.settings
  where key = 'cron_secret';

  if v_base is null or v_secret is null then
    raise notice '0052: cron_base_url / cron_secret not set — reconciler schedule unchanged.';
    return;
  end if;

  if exists (select 1 from cron.job where jobname = 'resto237-reconcile') then
    perform cron.unschedule('resto237-reconcile');
  end if;

  execute format(
    'select cron.schedule(%L, %L, %L)',
    'resto237-reconcile',
    '* * * * *',
    format(
      'select net.http_get(url := %L, headers := %L::jsonb, timeout_milliseconds := 30000)',
      rtrim(v_base, '/') || '/api/cron/reconcile',
      json_build_object('Authorization', 'Bearer ' || v_secret)::text
    )
  );
end
$$;