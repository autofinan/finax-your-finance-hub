-- Add missing columns to conversation_context table
ALTER TABLE public.conversation_context 
  ADD COLUMN IF NOT EXISTS last_card_name TEXT,
  ADD COLUMN IF NOT EXISTS last_goal_name TEXT,
  ADD COLUMN IF NOT EXISTS last_start_date TEXT,
  ADD COLUMN IF NOT EXISTS last_end_date TEXT;
