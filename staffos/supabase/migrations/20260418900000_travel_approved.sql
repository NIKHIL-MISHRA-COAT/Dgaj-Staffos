-- Add travel_approved column to user_profiles
-- Employees with travel_approved = true bypass radius restrictions,
-- auto-logout triggers, and location alerts to directors.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS travel_approved boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.user_profiles.travel_approved IS
  'When true, this employee is exempt from radius restrictions, location alerts, and auto-logout triggers.';
