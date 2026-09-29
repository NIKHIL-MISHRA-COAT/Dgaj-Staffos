-- Fix substitute leave balances that were seeded with 0 total_days
-- This corrects existing rows where substitute leave shows 0 balance

-- Update substitute leave balances that have 0 total_days to the correct quota of 12
UPDATE public.leave_balances
SET total_days = 12
WHERE leave_type = 'substitute'
  AND total_days = 0;

-- Also ensure medical leave balances with 0 total_days get corrected to 8
UPDATE public.leave_balances
SET total_days = 8
WHERE leave_type = 'medical'
  AND total_days = 0;

-- Ensure paid leave is capped at 5 (in case any were set higher)
UPDATE public.leave_balances
SET total_days = 5
WHERE leave_type = 'paid'
  AND total_days != 5;
