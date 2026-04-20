-- SQL skripta za kreiranje 'profiles' tablice u Supabase-u
-- Možeš ovo pokrenuti u Supabase SQL Editoru

CREATE TABLE IF NOT EXISTS public.profiles (
    id integer PRIMARY KEY DEFAULT 1,
    weight numeric,
    ftp integer,
    "maxHr" integer,
    "thresholdHr" integer,
    "birthYear" integer,
    height numeric,
    experience text,
    "riderType" text,
    "hoursPerWeek" integer,
    "primaryGoal" text,
    "goalDate" text,
    weakness text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);

-- Uključujemo Row Level Security (RLS) ili, u ovom slučaju, s obzirom na to da nema pravog auth-a, 
-- otvaramo pristup svima (ili anon anonimnom korisniku). 
-- OPREZ: Za produkciju bi trebalo koristiti pravo Supabase prepoznavanje!
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Dozvoli svima čitanje (ako nema Autha)
CREATE POLICY "Allow anon read" ON public.profiles FOR SELECT USING (true);

-- Dozvoli svima ažuriranje / unos
CREATE POLICY "Allow anon insert" ON public.profiles FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anon update" ON public.profiles FOR UPDATE USING (true);

-- Početni redak
INSERT INTO public.profiles (id, weight, ftp, "thresholdHr", "maxHr", "birthYear", height, experience, "riderType", "hoursPerWeek", "primaryGoal", "goalDate", weakness)
VALUES (1, 75.9, 270, 160, 180, 1985, 180, '3-5', 'all-rounder', 8, 'Istra 300', '2026-09-26', 'kratki usponi (VO2Max)')
ON CONFLICT (id) DO NOTHING;
