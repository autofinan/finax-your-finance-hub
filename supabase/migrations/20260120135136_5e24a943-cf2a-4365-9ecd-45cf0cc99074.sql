-- =====================================================
-- Security Fix: Error-level findings remediation
-- =====================================================

-- =====================================================
-- 1. FIX: otp_codes - Add service_role policy
-- The table has RLS enabled but no policies, which blocks all access.
-- Edge functions need service_role access to manage OTP codes.
-- =====================================================

-- Add service_role policy for OTP management (used by edge functions)
CREATE POLICY "otp_codes_service_role_all" 
ON public.otp_codes 
FOR ALL 
TO service_role
USING (true) 
WITH CHECK (true);

-- =====================================================
-- 2. FIX: usuarios - Remove public role policies, restrict to authenticated
-- Current policies allow 'public' role which includes unauthenticated users.
-- This exposes phone numbers and personal data to anyone.
-- =====================================================

-- Drop the vulnerable public-role policies
DROP POLICY IF EXISTS "Usuarios: select own" ON public.usuarios;
DROP POLICY IF EXISTS "usuarios_select_own" ON public.usuarios;
DROP POLICY IF EXISTS "usuarios_update_own" ON public.usuarios;

-- Create proper authenticated-only policies
CREATE POLICY "usuarios_select_own_authenticated" 
ON public.usuarios 
FOR SELECT 
TO authenticated
USING (id = auth.uid());

CREATE POLICY "usuarios_update_own_authenticated" 
ON public.usuarios 
FOR UPDATE 
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

-- =====================================================
-- 3. FIX: bank_connections - Add service_role policy for edge functions
-- Edge functions need service_role access to sync bank data.
-- Also verify encrypted tokens are not exposed in logs.
-- =====================================================

-- Add service_role policy for bank integration edge functions
CREATE POLICY "bank_connections_service_role_all" 
ON public.bank_connections 
FOR ALL 
TO service_role
USING (true) 
WITH CHECK (true);