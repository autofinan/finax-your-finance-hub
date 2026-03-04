-- Fix existing users whose names came from WhatsApp contact instead of onboarding
UPDATE usuarios u
SET nome = o.first_name
FROM user_onboarding o
WHERE u.id = o.user_id
  AND o.first_name IS NOT NULL
  AND o.current_step = 'done';

-- Also fix onboarding_status for completed onboardings  
UPDATE usuarios u
SET 
  onboarding_status = 'concluido',
  onboarding_step = 'finalizado'
FROM user_onboarding o
WHERE u.id = o.user_id
  AND o.current_step = 'done'
  AND (u.onboarding_status IS NULL OR u.onboarding_status != 'concluido');