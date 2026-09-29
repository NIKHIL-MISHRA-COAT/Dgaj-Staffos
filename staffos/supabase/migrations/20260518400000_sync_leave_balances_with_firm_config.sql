-- ── Fix: Sync leave balances with firm configuration ──────────────────────────
-- Update seed_leave_balances_for_user to read quotas from director_settings
-- so leave balances always reflect the firm's configured quotas.

CREATE OR REPLACE FUNCTION public.seed_leave_balances_for_user(p_user_id UUID)
RETURNS VOID AS $$
DECLARE
  v_fy INTEGER;
  v_role TEXT;
  v_quotas JSONB;
  v_role_quotas JSONB;
  v_substitute INT := 12;
  v_paid INT := 15;
  v_unpaid INT := 0;
  v_medical INT := 8;
  v_half_day INT := 10;
BEGIN
  -- Determine fiscal year (April start)
  v_fy := CASE WHEN EXTRACT(MONTH FROM CURRENT_DATE) >= 4
               THEN EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER
               ELSE EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER - 1
          END;

  -- Get user role
  SELECT role INTO v_role FROM public.user_profiles WHERE id = p_user_id;
  v_role := LOWER(COALESCE(v_role, 'employee'));

  -- Try to read quotas from director_settings
  SELECT setting_value INTO v_quotas
  FROM public.director_settings
  WHERE setting_key = 'leave_quotas_by_fy'
  LIMIT 1;

  IF v_quotas IS NOT NULL THEN
    -- Try role-specific quota, fallback to employee
    v_role_quotas := COALESCE(v_quotas->v_role, v_quotas->'employee');
    IF v_role_quotas IS NOT NULL THEN
      v_substitute := COALESCE((v_role_quotas->>'substitute')::INT, 12);
      v_paid       := COALESCE((v_role_quotas->>'paid')::INT, 15);
      v_unpaid     := COALESCE((v_role_quotas->>'unpaid')::INT, 0);
      v_medical    := COALESCE((v_role_quotas->>'medical')::INT, 8);
      v_half_day   := COALESCE((v_role_quotas->>'half_day')::INT, 10);
    END IF;
  END IF;

  INSERT INTO public.leave_balances (user_id, leave_type, total_days, used_days, fiscal_year)
  VALUES
    (p_user_id, 'substitute', v_substitute, 0, v_fy),
    (p_user_id, 'paid',       v_paid,       0, v_fy),
    (p_user_id, 'unpaid',     v_unpaid,     0, v_fy),
    (p_user_id, 'medical',    v_medical,    0, v_fy),
    (p_user_id, 'half_day',   v_half_day,   0, v_fy)
  ON CONFLICT (user_id, leave_type, fiscal_year)
  DO UPDATE SET total_days = EXCLUDED.total_days;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Re-seed all existing users with firm-configured quotas ──────────────────
DO $$
DECLARE
  v_user RECORD;
BEGIN
  FOR v_user IN SELECT id FROM public.user_profiles LOOP
    PERFORM public.seed_leave_balances_for_user(v_user.id);
  END LOOP;
END;
$$;
