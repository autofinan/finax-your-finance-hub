-- Add RLS policies for tables that have RLS enabled but no policies
-- These are for ai_corrections, user_patterns, spending_alerts

-- ai_corrections policies
CREATE POLICY "ai_corrections_service_role_all" ON ai_corrections
  FOR ALL USING (is_service_role());

CREATE POLICY "ai_corrections_select_own" ON ai_corrections
  FOR SELECT USING (user_id = auth.uid() OR user_id IS NULL);

-- user_patterns policies  
CREATE POLICY "user_patterns_service_role_all" ON user_patterns
  FOR ALL USING (is_service_role());

CREATE POLICY "user_patterns_select_own" ON user_patterns
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "user_patterns_insert_own" ON user_patterns
  FOR INSERT WITH CHECK (user_id = auth.uid() OR is_service_role());

CREATE POLICY "user_patterns_update_own" ON user_patterns
  FOR UPDATE USING (user_id = auth.uid() OR is_service_role());

-- spending_alerts policies
CREATE POLICY "spending_alerts_service_role_all" ON spending_alerts
  FOR ALL USING (is_service_role());

CREATE POLICY "spending_alerts_select_own" ON spending_alerts
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "spending_alerts_update_own" ON spending_alerts
  FOR UPDATE USING (user_id = auth.uid() OR is_service_role());