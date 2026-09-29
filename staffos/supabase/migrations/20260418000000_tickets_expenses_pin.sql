-- ============================================================
-- Migration: Tickets, Expenses, PIN management, Notification types
-- ============================================================

-- 1. Extend notification_type enum with new values
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'ticket_created' AND enumtypid = 'notification_type'::regtype) THEN
    ALTER TYPE notification_type ADD VALUE 'ticket_created';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'ticket_updated' AND enumtypid = 'notification_type'::regtype) THEN
    ALTER TYPE notification_type ADD VALUE 'ticket_updated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'expense_submitted' AND enumtypid = 'notification_type'::regtype) THEN
    ALTER TYPE notification_type ADD VALUE 'expense_submitted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'expense_approved' AND enumtypid = 'notification_type'::regtype) THEN
    ALTER TYPE notification_type ADD VALUE 'expense_approved';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'expense_rejected' AND enumtypid = 'notification_type'::regtype) THEN
    ALTER TYPE notification_type ADD VALUE 'expense_rejected';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'pin_set' AND enumtypid = 'notification_type'::regtype) THEN
    ALTER TYPE notification_type ADD VALUE 'pin_set';
  END IF;
END $$;

-- 2. Support Tickets table
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_number text NOT NULL DEFAULT '',
  user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'general',
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  assigned_to uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  resolution_notes text DEFAULT '',
  resolved_at timestamptz,
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz DEFAULT CURRENT_TIMESTAMP
);

-- Auto-generate ticket number
CREATE OR REPLACE FUNCTION generate_ticket_number()
RETURNS TRIGGER AS $$
BEGIN
  NEW.ticket_number := 'TKT-' || TO_CHAR(CURRENT_DATE, 'YYYYMM') || '-' || LPAD(CAST(nextval('ticket_seq') AS text), 4, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE SEQUENCE IF NOT EXISTS ticket_seq START 1;

DROP TRIGGER IF EXISTS set_ticket_number ON public.support_tickets;
CREATE TRIGGER set_ticket_number
  BEFORE INSERT ON public.support_tickets
  FOR EACH ROW
  WHEN (NEW.ticket_number = '')
  EXECUTE FUNCTION generate_ticket_number();

-- 3. Expenses table
CREATE TABLE IF NOT EXISTS public.expenses (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  description text DEFAULT '',
  category text NOT NULL DEFAULT 'other',
  amount numeric(12, 2) NOT NULL DEFAULT 0,
  currency text DEFAULT 'INR',
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  receipt_url text DEFAULT '',
  receipt_path text DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'reimbursed')),
  reviewed_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  rejection_reason text DEFAULT '',
  reimbursed_at timestamptz,
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz DEFAULT CURRENT_TIMESTAMP
);

-- 4. Push notification subscriptions table (for PWA push)
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, endpoint)
);

-- 5. RLS for support_tickets
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own tickets" ON public.support_tickets;
CREATE POLICY "Users can view own tickets"
  ON public.support_tickets FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Directors and managers can view all tickets" ON public.support_tickets;
CREATE POLICY "Directors and managers can view all tickets"
  ON public.support_tickets FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role IN ('director', 'manager')
    )
  );

DROP POLICY IF EXISTS "Users can insert own tickets" ON public.support_tickets;
CREATE POLICY "Users can insert own tickets"
  ON public.support_tickets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own open tickets" ON public.support_tickets;
CREATE POLICY "Users can update own open tickets"
  ON public.support_tickets FOR UPDATE
  USING (auth.uid() = user_id AND status = 'open');

DROP POLICY IF EXISTS "Directors and managers can update any ticket" ON public.support_tickets;
CREATE POLICY "Directors and managers can update any ticket"
  ON public.support_tickets FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role IN ('director', 'manager')
    )
  );

-- 6. RLS for expenses
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own expenses" ON public.expenses;
CREATE POLICY "Users can view own expenses"
  ON public.expenses FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Directors and managers can view all expenses" ON public.expenses;
CREATE POLICY "Directors and managers can view all expenses"
  ON public.expenses FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role IN ('director', 'manager')
    )
  );

DROP POLICY IF EXISTS "Users can insert own expenses" ON public.expenses;
CREATE POLICY "Users can insert own expenses"
  ON public.expenses FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own pending expenses" ON public.expenses;
CREATE POLICY "Users can update own pending expenses"
  ON public.expenses FOR UPDATE
  USING (auth.uid() = user_id AND status = 'pending');

DROP POLICY IF EXISTS "Directors and managers can update any expense" ON public.expenses;
CREATE POLICY "Directors and managers can update any expense"
  ON public.expenses FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role IN ('director', 'manager')
    )
  );

-- 7. RLS for push_subscriptions
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users manage own push subscriptions"
  ON public.push_subscriptions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 8. Director can update any user's pin_hash (for PIN management)
DROP POLICY IF EXISTS "Director can update user pins" ON public.user_profiles;
CREATE POLICY "Director can update user pins"
  ON public.user_profiles FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles AS up
      WHERE up.id = auth.uid() AND up.role = 'director'
    )
  );
