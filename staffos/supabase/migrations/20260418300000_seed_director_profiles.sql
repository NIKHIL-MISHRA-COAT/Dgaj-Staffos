-- ============================================================
-- Seed Director Profiles
-- Run this in Supabase SQL Editor (requires service role)
-- Safe to run multiple times (idempotent)
-- ============================================================

DO $$
DECLARE
  v_id_1 UUID;
  v_id_2 UUID;
BEGIN

  -- ── Profile 1: krrishdubeofficial@gmail.com ──────────────

  -- Check if auth.users entry already exists
  SELECT id INTO v_id_1
  FROM auth.users
  WHERE email = 'krrishdubeofficial@gmail.com'
  LIMIT 1;

  -- Create auth.users entry if missing
  IF v_id_1 IS NULL THEN
    v_id_1 := gen_random_uuid();
    INSERT INTO auth.users (
      id,
      instance_id,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      role,
      aud
    ) VALUES (
      v_id_1,
      '00000000-0000-0000-0000-000000000000',
      'krrishdubeofficial@gmail.com',
      '',
      NOW(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Krrish Dube","role":"director"}'::jsonb,
      NOW(),
      NOW(),
      'authenticated',
      'authenticated'
    );
  END IF;

  -- Upsert user_profiles for Profile 1
  INSERT INTO public.user_profiles (
    id,
    email,
    full_name,
    role,
    pin_hash,
    is_active,
    approval_status,
    created_at,
    updated_at
  ) VALUES (
    v_id_1,
    'krrishdubeofficial@gmail.com',
    'Krrish Dube',
    'director',
    '6969',
    true,
    'approved',
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    email          = EXCLUDED.email,
    full_name      = EXCLUDED.full_name,
    role           = EXCLUDED.role,
    pin_hash       = EXCLUDED.pin_hash,
    is_active      = EXCLUDED.is_active,
    approval_status = EXCLUDED.approval_status,
    updated_at     = NOW();

  RAISE NOTICE 'Profile 1 (krrishdubeofficial@gmail.com) seeded with id: %', v_id_1;

  -- ── Profile 2: dgajconsultancyservices@gmail.com ─────────

  -- Check if auth.users entry already exists
  SELECT id INTO v_id_2
  FROM auth.users
  WHERE email = 'dgajconsultancyservices@gmail.com'
  LIMIT 1;

  -- Create auth.users entry if missing
  IF v_id_2 IS NULL THEN
    v_id_2 := gen_random_uuid();
    INSERT INTO auth.users (
      id,
      instance_id,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      role,
      aud
    ) VALUES (
      v_id_2,
      '00000000-0000-0000-0000-000000000000',
      'dgajconsultancyservices@gmail.com',
      '',
      NOW(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"DGaj Consultancy Services","role":"director"}'::jsonb,
      NOW(),
      NOW(),
      'authenticated',
      'authenticated'
    );
  END IF;

  -- Upsert user_profiles for Profile 2
  INSERT INTO public.user_profiles (
    id,
    email,
    full_name,
    role,
    pin_hash,
    is_active,
    approval_status,
    created_at,
    updated_at
  ) VALUES (
    v_id_2,
    'dgajconsultancyservices@gmail.com',
    'DGaj Consultancy Services',
    'director',
    '6969',
    true,
    'approved',
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    email          = EXCLUDED.email,
    full_name      = EXCLUDED.full_name,
    role           = EXCLUDED.role,
    pin_hash       = EXCLUDED.pin_hash,
    is_active      = EXCLUDED.is_active,
    approval_status = EXCLUDED.approval_status,
    updated_at     = NOW();

  RAISE NOTICE 'Profile 2 (dgajconsultancyservices@gmail.com) seeded with id: %', v_id_2;

END $$;
