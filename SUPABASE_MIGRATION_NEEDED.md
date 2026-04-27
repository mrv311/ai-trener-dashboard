# Supabase Database Migration Required

## New Field Added: `intervals_activity_id`

To properly prevent duplicates in the calendar, we need to add a new field to the `completed_activities` table in Supabase.

## SQL Migration Script

Run this SQL in your Supabase SQL Editor:

```sql
-- Add intervals_activity_id field to track original Intervals.icu activity ID
ALTER TABLE public.completed_activities 
ADD COLUMN IF NOT EXISTS intervals_activity_id bigint;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_completed_activities_intervals_id 
ON public.completed_activities(intervals_activity_id);

-- Add comment for documentation
COMMENT ON COLUMN public.completed_activities.intervals_activity_id 
IS 'Original Intervals.icu activity ID for synced activities. Used to prevent duplicates.';
```

## Why This Is Needed

### Previous Approach (Date-Based)
- Compared dates only: `2026-04-24`
- Problem: Multiple activities on same day caused issues
- Problem: Couldn't distinguish between synced and local activities

### New Approach (ID-Based)
- Stores original Intervals.icu activity ID
- Duplicate detection checks ID first, then falls back to date
- Allows multiple activities per day
- Clear distinction between:
  - **Synced activities** (have `intervals_activity_id`)
  - **Local activities** (no `intervals_activity_id`, created in TrainerTab)

## What Happens After Migration

### For New Activities
- All newly synced activities will have `intervals_activity_id` set
- Duplicate detection will work perfectly

### For Old Activities (Already Synced)
- Old Supabase activities won't have `intervals_activity_id` (will be NULL)
- Fallback date-based detection will still work for these
- **Recommendation**: Re-sync old activities to populate the field

## How to Re-Sync Old Activities

1. **Option A: Delete and Re-Sync**
   - Go to Supabase dashboard
   - Delete old synced activities from `completed_activities` table
   - Use the "Supabase Povijesni Sync" module in the app to re-sync
   - All activities will now have `intervals_activity_id`

2. **Option B: Keep Old Data**
   - Leave old activities as-is
   - Only new syncs will have `intervals_activity_id`
   - Duplicate detection will use date-based fallback for old activities

## Testing After Migration

1. **Check Console Logs**
   ```
   [useIntervalsData] Mapiran Intervals.icu ID <ID> -> Supabase ID <ID>
   [useIntervalsData] ✓ Preskačem Intervals.icu aktivnost <ID> jer je već sinkronizirana
   ```

2. **Verify No Duplicates**
   - Check calendar for duplicate workouts
   - Should see only ONE entry per activity

3. **Test New Sync**
   - Sync a new activity from Intervals.icu
   - Verify it appears only once in calendar
   - Check that `intervals_activity_id` is populated in database

## Rollback Plan

If you need to rollback:

```sql
-- Remove the field (data will be lost)
ALTER TABLE public.completed_activities 
DROP COLUMN IF EXISTS intervals_activity_id;

-- Remove the index
DROP INDEX IF EXISTS idx_completed_activities_intervals_id;
```

Then revert the code changes in:
- `src/components/SupabaseSyncModule.jsx`
- `src/hooks/useIntervalsData.js`
