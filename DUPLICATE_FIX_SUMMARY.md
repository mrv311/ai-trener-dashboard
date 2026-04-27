# Duplicate Fix Summary - FINAL SOLUTION

## Problem
Duplicates were appearing in the calendar because the same Intervals.icu activity was showing up twice:
1. Once as a Supabase entry (synced from Intervals.icu)
2. Once as an Intervals.icu entry (fetched directly from API)

## Root Cause
The duplicate detection logic only compared **dates**, not activity IDs. This meant:
- If you synced an Intervals.icu activity to Supabase, it would appear in both sources
- The date-based check would fail if activities had slightly different timestamps
- Multiple activities on the same day couldn't be properly distinguished

## Solution: Activity ID Tracking

### Database Change (REQUIRED)
Added new field `intervals_activity_id` to `completed_activities` table to store the original Intervals.icu activity ID.

**See SUPABASE_MIGRATION_NEEDED.md for SQL migration script.**

### Code Changes

#### 1. SupabaseSyncModule.jsx
- **Added**: `intervals_activity_id: act.id` when syncing activities
- **Added**: Proper source detection (garmin, strava, wahoo, external)
- **Removed**: `workout_source: null` (now properly detects source)

#### 2. useIntervalsData.js
- **Added**: `supabaseIntervalsIdMap` to track Intervals.icu ID -> Supabase ID mappings
- **Added**: Two-level duplicate detection:
  1. **Primary**: Check if Intervals.icu activity ID exists in Supabase (by ID)
  2. **Fallback**: Check if date has Supabase activity (for old data without ID)
- **Added**: Comprehensive debug logging

#### 3. CalendarTab.jsx
- **Updated**: Source labels now show ALL external sources:
  - 🟢 Garmin
  - 🟠 Strava  
  - 🔵 Wahoo
  - 🌐 Vanjski
  - 📅 Kalendar
  - 📚 Knjižnica
  - 🚴 Slobodno

## How It Works Now

### Duplicate Detection Flow

```
1. Fetch Supabase activities
   └─> Build supabaseIntervalsIdMap: { intervals_id: supabase_id }
   └─> Build supabaseDateMap: { date: supabase_id }

2. Fetch Intervals.icu activities

3. For each Intervals.icu activity:
   ├─> Check supabaseIntervalsIdMap[activity.id]
   │   └─> If found: SKIP (already synced)
   │
   └─> Check supabaseDateMap[activity.date]
       └─> If found: SKIP (fallback for old data)
       
4. Add remaining Intervals.icu activities to calendar
```

### Example Scenario

**Before Fix:**
```
Intervals.icu: Activity #12345 (2026-04-24, Garmin workout)
Supabase:      Activity #67890 (2026-04-24, synced from #12345)
Calendar:      Shows BOTH (duplicate!)
```

**After Fix:**
```
Intervals.icu: Activity #12345 (2026-04-24, Garmin workout)
Supabase:      Activity #67890 (2026-04-24, intervals_activity_id: 12345)
Calendar:      Shows ONLY Supabase entry (Intervals.icu skipped)
```

## Testing Instructions

### 1. Run Database Migration
See `SUPABASE_MIGRATION_NEEDED.md` for SQL script.

### 2. Re-Sync Activities (Recommended)
- Delete old synced activities from Supabase (optional)
- Use "Supabase Povijesni Sync" module to re-sync
- All activities will now have `intervals_activity_id`

### 3. Check Console Logs
Look for these messages:
```
[useIntervalsData] Računam workouts. Supabase aktivnosti: X, Intervals aktivnosti: Y
[useIntervalsData] Mapiran Intervals.icu ID <ID> -> Supabase ID <ID>
[useIntervalsData] ✓ Preskačem Intervals.icu aktivnost <ID> jer je već sinkronizirana
[useIntervalsData] Završeno računanje. Ukupno workouts: Z, Intervals ID mapiranja: N
```

### 4. Verify Calendar
- ✅ No duplicate workouts for same activity
- ✅ Garmin workouts show "🟢 Garmin" label (not "Lokalno")
- ✅ Multiple activities per day work correctly
- ✅ Supabase activities take priority over Intervals.icu

## What Changed for Each Activity Type

### Local Activities (Created in TrainerTab)
- **Before**: `workout_source: 'calendar' | 'library' | 'free_ride'`
- **After**: Same, plus `intervals_activity_id: null`
- **Label**: 📅 Kalendar / 📚 Knjižnica / 🚴 Slobodno

### Synced Activities (From Intervals.icu)
- **Before**: `workout_source: null`, no ID tracking
- **After**: `workout_source: 'garmin' | 'strava' | 'wahoo' | 'external'`, `intervals_activity_id: <ID>`
- **Label**: 🟢 Garmin / 🟠 Strava / 🔵 Wahoo / 🌐 Vanjski

### Intervals.icu Activities (Direct API)
- **Before**: Always shown in calendar
- **After**: Skipped if already synced to Supabase (by ID or date)
- **Label**: Not shown (replaced by Supabase entry)

## Benefits

1. **No More Duplicates**: Each activity appears exactly once
2. **Clear Source Labels**: Know where each workout came from
3. **Multiple Activities Per Day**: Properly handled with ID-based detection
4. **Backward Compatible**: Old activities without ID still work (date fallback)
5. **Future-Proof**: Can add more sources (Zwift, TrainerRoad, etc.)

## Potential Issues & Solutions

### Issue: Old activities still show duplicates
**Solution**: Re-sync those activities to populate `intervals_activity_id`

### Issue: Migration fails
**Solution**: Check Supabase permissions, ensure table exists

### Issue: Source labels show "external" instead of "garmin"
**Solution**: Check Intervals.icu API response, may need to adjust detection logic

### Issue: Multiple activities on same day still duplicate
**Solution**: Verify `intervals_activity_id` is populated in database

## Next Steps

1. ✅ Run database migration
2. ✅ Test with existing data
3. ✅ Re-sync old activities (optional but recommended)
4. ✅ Verify no duplicates in calendar
5. ✅ Check source labels are correct
6. ✅ Test syncing new activities

## Rollback Plan

If issues occur:
1. Run rollback SQL (see SUPABASE_MIGRATION_NEEDED.md)
2. Revert code changes in git
3. Report issue with console logs
