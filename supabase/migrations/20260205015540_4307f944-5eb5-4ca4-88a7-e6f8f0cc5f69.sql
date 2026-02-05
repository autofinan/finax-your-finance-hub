-- Set security_invoker on remaining views using ALTER VIEW
ALTER VIEW public.ai_accuracy_summary SET (security_invoker = true);
ALTER VIEW public.queue_status SET (security_invoker = true);
ALTER VIEW public.vw_contas_a_vencer SET (security_invoker = true);
ALTER VIEW public.vw_dashboard_usuario SET (security_invoker = true);
ALTER VIEW public.vw_status_plano SET (security_invoker = true);