-- Habilitar extensões necessárias
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Função que chama o worker via HTTP
CREATE OR REPLACE FUNCTION public.fn_trigger_finax_worker()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_url text;
  v_anon_key text;
BEGIN
  v_url := 'https://hhvaqirjrssldsxoezxs.supabase.co/functions/v1/finax-worker';
  v_anon_key := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhodmFxaXJqcnNzbGRzeG9lenhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY2MDA1NDAsImV4cCI6MjA3MjE3NjU0MH0.5ZRkbowM34yCzzOYOyE8_ZwjXgasQKaLpHubAoFuH5A';
  
  -- Chamar worker de forma assíncrona (fire-and-forget)
  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_anon_key
    ),
    body := jsonb_build_object('job_id', NEW.id, 'triggered_by', 'insert_trigger')
  );
  
  RETURN NEW;
END;
$$;

-- Trigger para chamar worker imediatamente após insert
DROP TRIGGER IF EXISTS trg_webhook_jobs_call_worker ON webhook_jobs;
CREATE TRIGGER trg_webhook_jobs_call_worker
  AFTER INSERT ON webhook_jobs
  FOR EACH ROW
  EXECUTE FUNCTION fn_trigger_finax_worker();

-- CRON job como fallback (a cada 1 minuto)
SELECT cron.unschedule('finax-worker-cron') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'finax-worker-cron'
);

SELECT cron.schedule(
  'finax-worker-cron',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://hhvaqirjrssldsxoezxs.supabase.co/functions/v1/finax-worker',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhodmFxaXJqcnNzbGRzeG9lenhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY2MDA1NDAsImV4cCI6MjA3MjE3NjU0MH0.5ZRkbowM34yCzzOYOyE8_ZwjXgasQKaLpHubAoFuH5A"}'::jsonb,
    body := '{"triggered_by": "cron_fallback"}'::jsonb
  );
  $$
);