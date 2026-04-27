# Quick Fix Guide - Duplicate Activities

## TL;DR

Duplicates are happening because we're not tracking which Intervals.icu activities have been synced to Supabase. The fix requires a database change.

## What You Need to Do

### Step 1: Add Database Field (5 minutes)

1. Open Supabase Dashboard
2. Go to SQL Editor
3. Run this SQL:

```sql
ALTER TABLE public.completed_activities 
ADD COLUMN IF NOT EXISTS intervals_activity_id bigint;

CREATE INDEX IF NOT EXISTS idx_completed_activities_intervals_id 
ON public.completed_activities(intervals_activity_id);
```

### Step 2: Re-Sync Activities (Optional but Recommended)

**Option A: Clean Slate (Recommended)**
1. In Supabase, delete all synced activities (keep local TrainerTab activities)
2. Use "Supabase Povijesni Sync" in the app to re-sync
3. All activities will now have proper ID tracking

**Option B: Keep Everything**
- Old activities will use date-based duplicate detection (less reliable)
- New activities will use ID-based detection (perfect)

### Step 3: Test

1. Open browser console (F12)
2. Look for: `[useIntervalsData] ✓ Preskačem Intervals.icu aktivnost`
3. Check calendar - no duplicates!
4. Verify Garmin workouts show "🟢 Garmin" label

## What Changed

### Before
```
Calendar shows:
- Activity from Intervals.icu API
- Same activity from Supabase (duplicate!)
```

### After
```
Calendar shows:
- Activity from Supabase only
- Intervals.icu version is automatically skipped
```

## How to Identify Duplicates

Look for workouts with:
- Same title
- Same date
- Same duration/TSS
- Different IDs (one starts with `act-`, other with `supabase-`)

## If You See Duplicates After Fix

1. Check console for: `[useIntervalsData] Mapiran Intervals.icu ID`
2. If you don't see this, the database field wasn't added
3. If you see it but still have duplicates, check if `intervals_activity_id` is NULL in database

## Files Changed

- `src/components/SupabaseSyncModule.jsx` - Now saves Intervals.icu ID
- `src/hooks/useIntervalsData.js` - New duplicate detection logic
- `src/components/CalendarTab.jsx` - Better source labels

## Need Help?

Check the console logs - they'll tell you exactly what's happening:
- Which activities are being skipped
- Which IDs are mapped
- If any duplicates are detected

## Rollback

If something breaks:
```sql
ALTER TABLE public.completed_activities DROP COLUMN intervals_activity_id;
```

Then revert the code changes in git.
