-- =============================================================================
-- ErgVibe: Sigurnosna migracija (RLS) + Javna/Privatna Knjižnica Treninga + Admin
-- =============================================================================
-- Uputa: Kopiraj i pokreni ovaj SQL u Supabase Dashboard -> SQL Editor -> New Query.
-- Skripta je idempotentna (sigurno ju je pokrenuti više puta).
-- =============================================================================

-- 1. Dodaj stupac `user_id` u tablicu `public.workouts`
--    NULL       = Javni ErgVibe Katalog (vidljiv svima, read-only za obične korisnike)
--    <user_id>  = Privatni trening korisnika (vidljiv i uređiv isključivo vlasniku)
ALTER TABLE public.workouts
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_workouts_user_id ON public.workouts (user_id);

-- 2. Sigurna funkcija za provjeru Admin uloge (čita isključivo zaštićeni JWT app_metadata)
--    Korisnici NIKADA ne mogu sami izmijeniti app_metadata putem klijentskog API-ja.
CREATE OR REPLACE FUNCTION public.is_ergvibe_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false);
$$;

-- 3. Stroga RLS pravila za `public.workouts`
ALTER TABLE public.workouts ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'workouts'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.workouts', pol.policyname);
  END LOOP;
END $$;

-- Čitanje: svi (uključujući goste preko anon ključa) vide javni katalog (user_id IS NULL),
-- a prijavljeni korisnici dodatno vide svoje privatne treninge (user_id = auth.uid()).
CREATE POLICY "workouts_select_public_and_own"
  ON public.workouts
  FOR SELECT
  TO anon, authenticated
  USING (user_id IS NULL OR user_id = auth.uid());

-- Unos: prijavljeni korisnik smije dodavati isključivo u svoju privatnu knjižnicu,
-- dok Admin smije dodavati i u javni katalog (user_id IS NULL).
CREATE POLICY "workouts_insert_own_or_admin_public"
  ON public.workouts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR (user_id IS NULL AND public.is_ergvibe_admin())
  );

-- Uređivanje: vlasnik uređuje svoje privatne treninge; Admin može uređivati i javne
-- te prebacivati treninge između javnog (NULL) i svog privatnog računa (auth.uid()).
CREATE POLICY "workouts_update_own_or_admin_public"
  ON public.workouts
  FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR (user_id IS NULL AND public.is_ergvibe_admin())
  )
  WITH CHECK (
    user_id = auth.uid()
    OR (user_id IS NULL AND public.is_ergvibe_admin())
  );

-- Brisanje: vlasnik briše svoje privatne treninge; Admin može brisati i javne.
CREATE POLICY "workouts_delete_own_or_admin_public"
  ON public.workouts
  FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR (user_id IS NULL AND public.is_ergvibe_admin())
  );

-- 4. Stroga RLS pravila za `public.profiles` (svaki korisnik vidi/uređuje samo svoj profil)
DO $$
DECLARE
  pol record;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'user_id'
  ) THEN
    EXECUTE 'ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY';

    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'profiles'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.profiles', pol.policyname);
    END LOOP;

    EXECUTE 'CREATE POLICY "profiles_own_all" ON public.profiles FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())';
  END IF;
END $$;

-- 5. Stroga RLS pravila za `public.completed_activities` (samo vlastite aktivnosti)
DO $$
DECLARE
  pol record;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'completed_activities' AND column_name = 'user_id'
  ) THEN
    EXECUTE 'ALTER TABLE public.completed_activities ENABLE ROW LEVEL SECURITY';

    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'completed_activities'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.completed_activities', pol.policyname);
    END LOOP;

    EXECUTE 'CREATE POLICY "completed_activities_own_all" ON public.completed_activities FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())';
  END IF;
END $$;

-- =============================================================================
-- KORAK NAKON MIGRACIJE (pokreni zasebno u SQL Editoru da sebi dodijeliš Admin ulogu):
-- =============================================================================
--
-- A) Pronađi svoj korisnički račun (email i UUID):
--    SELECT id, email, raw_user_meta_data->>'intervals_id' AS intervals_id, raw_app_meta_data
--    FROM auth.users
--    ORDER BY created_at ASC;
--
-- B) Dodijeli sebi Admin ulogu (zamijeni <TVOJ-EMAIL> ili koristi WHERE id = '<TVOJ-UUID>'):
--    UPDATE auth.users
--    SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || '{"role": "admin"}'::jsonb
--    WHERE email = '<TVOJ-EMAIL>';
--
--    NAPOMENA: Nakon toga se u ErgVibe aplikaciji jednom odjavi i ponovno prijavi
--    kako bi tvoj JWT token povukao `role: "admin"` (u Knjižnici će se pojaviti oznaka "ADMIN MOD").
--
-- C) (Kasnije, kad odabereš javni katalog od ~250 treninga)
--    Za prebacivanje SVIH postojećih treninga u svoju privatnu bazu (prije nego objaviš 250 čistih):
--    UPDATE public.workouts SET user_id = '<TVOJ-UUID>' WHERE user_id IS NULL;
-- =============================================================================
