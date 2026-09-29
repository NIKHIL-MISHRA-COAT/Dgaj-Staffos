-- Seed leave_balances for existing users with the new leave types
-- This runs in a separate migration so the enum ADD VALUE commits are visible
-- (PostgreSQL requires new enum values to be committed before they can be used in DML)

DO $$
DECLARE
  v_user RECORD;
  v_year INT := EXTRACT(YEAR FROM NOW())::INT;
  v_leave_types TEXT[] := ARRAY['substitute', 'paid', 'unpaid', 'medical', 'half_day'];
  v_quotas INT[] := ARRAY[12, 15, 0, 8, 10];
  i INT;
BEGIN
  FOR v_user IN SELECT id FROM public.user_profiles LOOP
    FOR i IN 1..array_length(v_leave_types, 1) LOOP
      INSERT INTO public.leave_balances (user_id, leave_type, total_days, used_days, fiscal_year)
      VALUES (v_user.id, v_leave_types[i]::leave_type, v_quotas[i], 0, v_year)
      ON CONFLICT (user_id, leave_type, fiscal_year) DO NOTHING;
    END LOOP;
  END LOOP;
END $$;
