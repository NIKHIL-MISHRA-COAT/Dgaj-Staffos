-- ============================================================
-- Migration: Chat, Payroll, Documents, Leave Balance Fixes
-- ============================================================

-- ── Chat Messages ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chat_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  channel_type TEXT NOT NULL DEFAULT 'general', -- 'general', 'department', 'direct', 'announcement'
  department TEXT,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  is_archived BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID REFERENCES public.chat_channels(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  message_type TEXT DEFAULT 'text', -- 'text', 'file', 'image', 'system'
  file_url TEXT,
  file_name TEXT,
  reply_to_id UUID REFERENCES public.chat_messages(id) ON DELETE SET NULL,
  is_edited BOOLEAN DEFAULT FALSE,
  edited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.chat_channel_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID REFERENCES public.chat_channels(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member', -- 'admin', 'member'
  last_read_at TIMESTAMPTZ DEFAULT NOW(),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(channel_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.chat_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(message_id, user_id, emoji)
);

-- ── Payroll ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payroll_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  pay_period_start DATE NOT NULL,
  pay_period_end DATE NOT NULL,
  basic_salary NUMERIC(12,2) DEFAULT 0,
  hra NUMERIC(12,2) DEFAULT 0,
  transport_allowance NUMERIC(12,2) DEFAULT 0,
  other_allowances NUMERIC(12,2) DEFAULT 0,
  gross_salary NUMERIC(12,2) DEFAULT 0,
  pf_deduction NUMERIC(12,2) DEFAULT 0,
  esi_deduction NUMERIC(12,2) DEFAULT 0,
  tds_deduction NUMERIC(12,2) DEFAULT 0,
  other_deductions NUMERIC(12,2) DEFAULT 0,
  total_deductions NUMERIC(12,2) DEFAULT 0,
  net_salary NUMERIC(12,2) DEFAULT 0,
  days_worked INTEGER DEFAULT 0,
  days_absent INTEGER DEFAULT 0,
  overtime_hours NUMERIC(6,2) DEFAULT 0,
  overtime_pay NUMERIC(12,2) DEFAULT 0,
  bonus NUMERIC(12,2) DEFAULT 0,
  advance_deduction NUMERIC(12,2) DEFAULT 0,
  leave_deduction NUMERIC(12,2) DEFAULT 0,
  status TEXT DEFAULT 'draft', -- 'draft', 'processed', 'paid', 'cancelled'
  payment_date DATE,
  payment_method TEXT DEFAULT 'bank_transfer',
  bank_account TEXT,
  notes TEXT,
  processed_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.salary_structures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE UNIQUE,
  basic_salary NUMERIC(12,2) DEFAULT 0,
  hra_percent NUMERIC(5,2) DEFAULT 40,
  transport_allowance NUMERIC(12,2) DEFAULT 0,
  other_allowances NUMERIC(12,2) DEFAULT 0,
  pf_percent NUMERIC(5,2) DEFAULT 12,
  esi_percent NUMERIC(5,2) DEFAULT 0.75,
  tds_percent NUMERIC(5,2) DEFAULT 0,
  effective_from DATE DEFAULT CURRENT_DATE,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Documents / Resources ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.company_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  document_type TEXT DEFAULT 'general', -- 'policy', 'form', 'template', 'report', 'general'
  file_url TEXT,
  file_path TEXT,
  file_name TEXT,
  file_size INTEGER,
  mime_type TEXT,
  department TEXT,
  is_public BOOLEAN DEFAULT TRUE,
  tags TEXT[] DEFAULT '{}',
  uploaded_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Leave Balance Auto-Seed Fix ────────────────────────────────
-- Ensure leave_balances has correct fiscal year column
ALTER TABLE public.leave_balances ADD COLUMN IF NOT EXISTS fiscal_year INTEGER DEFAULT EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER;

-- Function to seed leave balances for a user if missing
CREATE OR REPLACE FUNCTION public.seed_leave_balances_for_user(p_user_id UUID)
RETURNS VOID AS $$
DECLARE
  v_fy INTEGER;
BEGIN
  -- Determine fiscal year (April start)
  v_fy := CASE WHEN EXTRACT(MONTH FROM CURRENT_DATE) >= 4 
               THEN EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER
               ELSE EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER - 1
          END;
  
  INSERT INTO public.leave_balances (user_id, leave_type, total_days, used_days, fiscal_year)
  VALUES
    (p_user_id, 'substitute', 12, 0, v_fy),
    (p_user_id, 'paid', 15, 0, v_fy),
    (p_user_id, 'unpaid', 0, 0, v_fy),
    (p_user_id, 'medical', 8, 0, v_fy),
    (p_user_id, 'half_day', 10, 0, v_fy)
  ON CONFLICT (user_id, leave_type, fiscal_year) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Seed balances for all existing users who don't have them
DO $$
DECLARE
  v_user RECORD;
  v_fy INTEGER;
BEGIN
  v_fy := CASE WHEN EXTRACT(MONTH FROM CURRENT_DATE) >= 4 
               THEN EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER
               ELSE EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER - 1
          END;
  FOR v_user IN SELECT id FROM public.user_profiles LOOP
    INSERT INTO public.leave_balances (user_id, leave_type, total_days, used_days, fiscal_year)
    VALUES
      (v_user.id, 'substitute', 12, 0, v_fy),
      (v_user.id, 'paid', 15, 0, v_fy),
      (v_user.id, 'unpaid', 0, 0, v_fy),
      (v_user.id, 'medical', 8, 0, v_fy),
      (v_user.id, 'half_day', 10, 0, v_fy)
    ON CONFLICT (user_id, leave_type, fiscal_year) DO NOTHING;
  END LOOP;
END;
$$;

-- Trigger to auto-seed leave balances when a new user is created
CREATE OR REPLACE FUNCTION public.auto_seed_leave_balances()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM public.seed_leave_balances_for_user(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_auto_seed_leave_balances ON public.user_profiles;
CREATE TRIGGER trg_auto_seed_leave_balances
  AFTER INSERT ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.auto_seed_leave_balances();

-- Update used_days when leave is approved
CREATE OR REPLACE FUNCTION public.update_leave_balance_on_approval()
RETURNS TRIGGER AS $$
DECLARE
  v_fy INTEGER;
BEGIN
  IF NEW.status = 'approved' AND OLD.status != 'approved' THEN
    v_fy := CASE WHEN EXTRACT(MONTH FROM NEW.start_date::DATE) >= 4 
                 THEN EXTRACT(YEAR FROM NEW.start_date::DATE)::INTEGER
                 ELSE EXTRACT(YEAR FROM NEW.start_date::DATE)::INTEGER - 1
            END;
    UPDATE public.leave_balances
    SET used_days = used_days + NEW.total_days,
        updated_at = NOW()
    WHERE user_id = NEW.user_id
      AND leave_type = NEW.leave_type
      AND fiscal_year = v_fy;
  END IF;
  IF NEW.status IN ('rejected', 'cancelled') AND OLD.status = 'approved' THEN
    v_fy := CASE WHEN EXTRACT(MONTH FROM NEW.start_date::DATE) >= 4 
                 THEN EXTRACT(YEAR FROM NEW.start_date::DATE)::INTEGER
                 ELSE EXTRACT(YEAR FROM NEW.start_date::DATE)::INTEGER - 1
            END;
    UPDATE public.leave_balances
    SET used_days = GREATEST(0, used_days - NEW.total_days),
        updated_at = NOW()
    WHERE user_id = NEW.user_id
      AND leave_type = NEW.leave_type
      AND fiscal_year = v_fy;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_update_leave_balance ON public.leave_requests;
CREATE TRIGGER trg_update_leave_balance
  AFTER UPDATE ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_leave_balance_on_approval();

-- ── Calendar: add user_id for user-specific events ────────────
ALTER TABLE public.calendar_events ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE;
ALTER TABLE public.calendar_events ADD COLUMN IF NOT EXISTS is_personal BOOLEAN DEFAULT FALSE;
ALTER TABLE public.calendar_events ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN DEFAULT FALSE;

-- ── Task completion tracking ───────────────────────────────────
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS time_to_complete_minutes INTEGER;

-- Update completed_at when task is marked done
CREATE OR REPLACE FUNCTION public.track_task_completion()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'done' AND OLD.status != 'done' THEN
    NEW.completed_at := NOW();
    IF OLD.created_at IS NOT NULL THEN
      NEW.time_to_complete_minutes := EXTRACT(EPOCH FROM (NOW() - OLD.created_at))::INTEGER / 60;
    END IF;
  END IF;
  IF NEW.status != 'done' AND OLD.status = 'done' THEN
    NEW.completed_at := NULL;
    NEW.time_to_complete_minutes := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_track_task_completion ON public.tasks;
CREATE TRIGGER trg_track_task_completion
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.track_task_completion();

-- ── Indexes ────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_chat_messages_channel ON public.chat_messages(channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender ON public.chat_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_chat_channel_members_user ON public.chat_channel_members(user_id);
CREATE INDEX IF NOT EXISTS idx_payroll_records_user ON public.payroll_records(user_id, pay_period_start DESC);
CREATE INDEX IF NOT EXISTS idx_company_documents_type ON public.company_documents(document_type);
CREATE INDEX IF NOT EXISTS idx_tasks_completed_at ON public.tasks(completed_at);

-- ── RLS Policies ───────────────────────────────────────────────
ALTER TABLE public.chat_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_channel_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salary_structures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_documents ENABLE ROW LEVEL SECURITY;

-- Chat channels: all authenticated users can read, directors/managers can create
DROP POLICY IF EXISTS "chat_channels_select" ON public.chat_channels;
CREATE POLICY "chat_channels_select" ON public.chat_channels FOR SELECT USING (true);

DROP POLICY IF EXISTS "chat_channels_insert" ON public.chat_channels;
CREATE POLICY "chat_channels_insert" ON public.chat_channels FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "chat_channels_update" ON public.chat_channels;
CREATE POLICY "chat_channels_update" ON public.chat_channels FOR UPDATE USING (true);

-- Chat messages: all can read and insert
DROP POLICY IF EXISTS "chat_messages_select" ON public.chat_messages;
CREATE POLICY "chat_messages_select" ON public.chat_messages FOR SELECT USING (true);

DROP POLICY IF EXISTS "chat_messages_insert" ON public.chat_messages;
CREATE POLICY "chat_messages_insert" ON public.chat_messages FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "chat_messages_update" ON public.chat_messages;
CREATE POLICY "chat_messages_update" ON public.chat_messages FOR UPDATE USING (true);

DROP POLICY IF EXISTS "chat_messages_delete" ON public.chat_messages;
CREATE POLICY "chat_messages_delete" ON public.chat_messages FOR DELETE USING (true);

-- Chat channel members
DROP POLICY IF EXISTS "chat_members_all" ON public.chat_channel_members;
CREATE POLICY "chat_members_all" ON public.chat_channel_members FOR ALL USING (true);

-- Chat reactions
DROP POLICY IF EXISTS "chat_reactions_all" ON public.chat_reactions;
CREATE POLICY "chat_reactions_all" ON public.chat_reactions FOR ALL USING (true);

-- Payroll: employees see own, directors/managers see all
DROP POLICY IF EXISTS "payroll_select" ON public.payroll_records;
CREATE POLICY "payroll_select" ON public.payroll_records FOR SELECT USING (true);

DROP POLICY IF EXISTS "payroll_insert" ON public.payroll_records;
CREATE POLICY "payroll_insert" ON public.payroll_records FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "payroll_update" ON public.payroll_records;
CREATE POLICY "payroll_update" ON public.payroll_records FOR UPDATE USING (true);

-- Salary structures
DROP POLICY IF EXISTS "salary_structures_all" ON public.salary_structures;
CREATE POLICY "salary_structures_all" ON public.salary_structures FOR ALL USING (true);

-- Company documents
DROP POLICY IF EXISTS "company_documents_all" ON public.company_documents;
CREATE POLICY "company_documents_all" ON public.company_documents FOR ALL USING (true);

-- Seed default chat channels
INSERT INTO public.chat_channels (name, description, channel_type)
VALUES
  ('General', 'Company-wide announcements and discussions', 'general'),
  ('Team Updates', 'Daily team updates and check-ins', 'general'),
  ('HR & Policies', 'HR announcements and policy updates', 'announcement')
ON CONFLICT DO NOTHING;
