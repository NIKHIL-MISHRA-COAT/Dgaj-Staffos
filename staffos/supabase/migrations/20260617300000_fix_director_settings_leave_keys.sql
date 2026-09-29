-- Migration: Fix director_settings key-value seed rows for leave admin
-- Ensures carry_forward_settings and leave_quotas_by_fy keys exist in director_settings
-- The table uses a key-value store pattern (setting_key, setting_value)

-- Seed default carry_forward_settings if not present
INSERT INTO public.director_settings (setting_key, setting_value)
VALUES (
  'carry_forward_settings',
  '{"enabled": false, "max_days": 5, "expiry_days": 90}'::jsonb
)
ON CONFLICT (setting_key) DO NOTHING;

-- Seed default leave_quotas_by_fy if not present
INSERT INTO public.director_settings (setting_key, setting_value)
VALUES (
  'leave_quotas_by_fy',
  '{"2026-2027": {"substitute": 12, "paid": 5, "medical": 8, "half_day": 10, "unpaid": 0}}'::jsonb
)
ON CONFLICT (setting_key) DO NOTHING;

-- Seed default working_hours if not present
INSERT INTO public.director_settings (setting_key, setting_value)
VALUES (
  'working_hours',
  '{"standard_start": "09:00", "standard_end": "18:00", "break_minutes": 60, "weekly_hours": 40, "daily_hours": 8, "overtime_threshold_daily": 2, "overtime_threshold_weekly": 10, "overtime_threshold_monthly": 40}'::jsonb
)
ON CONFLICT (setting_key) DO NOTHING;
