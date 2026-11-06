import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabaseClient';

const syncHelperStorageKeys = (prof) => {
  try {
    if (prof?.ftp && Number(prof.ftp) > 0) {
      window.localStorage.setItem('ai_trener_user_ftp', String(prof.ftp));
    }
    if (prof?.weight && Number(prof.weight) > 0) {
      window.localStorage.setItem('ai_trener_user_weight', String(prof.weight));
    }
  } catch (e) {}
};

// Dozvoljeni stupci u Supabase tablici profiles (da spriječimo greške nepostojećih kolona)
const SUPABASE_PROFILE_COLUMNS = [
  'weight', 'ftp', 'maxHr', 'thresholdHr', 'birthYear', 
  'height', 'experience', 'riderType', 'hoursPerWeek', 
  'primaryGoal', 'goalDate', 'weakness', 'username'
];

export function useProfileSync(initialValue, userId) {
  const [profile, setProfileState] = useState(initialValue);

  // Fetch initial profile from localStorage + Supabase (samo za prijavljene korisnike)
  useEffect(() => {
    async function fetchSupabaseProfile() {
      if (!userId) {
        setProfileState(initialValue);
        return;
      }

      let localParsed = null;
      try {
        const item = window.localStorage.getItem(`ai_trener_profile_${userId}`);
        if (item) {
          localParsed = JSON.parse(item);
          if (localParsed && typeof localParsed === 'object') {
            const mergedLocal = { ...initialValue, ...localParsed };
            setProfileState(mergedLocal);
            syncHelperStorageKeys(mergedLocal);
          }
        } else {
          setProfileState(initialValue);
          syncHelperStorageKeys(initialValue);
        }
      } catch (e) {
        setProfileState(initialValue);
      }

      // Za Gosta ne šaljemo upit prema Supabase bazi (izbjegava UUID grešku)
      if (userId === 'guest') {
        return;
      }

      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('user_id', userId)
          .single();

        if (error) {
          if (error.code !== 'PGRST116') {
            console.error('Error fetching profile from Supabase:', error);
          }
          return;
        }

        if (data) {
          setProfileState((prev) => {
            const merged = { ...(prev || initialValue) };
            let hasChanged = false;
            for (const key in data) {
              if (data[key] !== null && data[key] !== undefined) {
                // Ako korisnik lokalno ima ručno postavljen FTP, ne dopusti da ga stari podaci iz baze prepišu
                if (key === 'ftp' && prev?.isManualFtp && prev?.ftp) {
                  continue;
                }
                if (merged[key] !== data[key]) {
                  merged[key] = data[key];
                  hasChanged = true;
                }
              }
            }
            if (!hasChanged) return prev;

            // Zadrži lokalne zastavice ručnog unosa
            if (prev?.isManualFtp !== undefined) merged.isManualFtp = prev.isManualFtp;
            if (prev?.isManualWeight !== undefined) merged.isManualWeight = prev.isManualWeight;
            if (prev?.isManualHr !== undefined) merged.isManualHr = prev.isManualHr;
            if (prev?.lastFtpUpdate) merged.lastFtpUpdate = prev.lastFtpUpdate;

            window.localStorage.setItem(`ai_trener_profile_${userId}`, JSON.stringify(merged));
            syncHelperStorageKeys(merged);
            return merged;
          });
        }
      } catch (err) {
        console.error('Network or unexpected error while fetching profile:', err);
      }
    }
    
    fetchSupabaseProfile();
  }, [userId]);

  // Update profile locally and remote - sa stabilnom referencom (useCallback)
  const setProfile = useCallback((newProfileData) => {
    setProfileState((prev) => {
      const baseProfile = prev || initialValue;
      const rawUpdated = typeof newProfileData === 'function' ? newProfileData(baseProfile) : newProfileData;
      const updatedProfile = { ...baseProfile, ...rawUpdated };

      // 1. Update helper keys
      syncHelperStorageKeys(updatedProfile);

      // 2. Update local storage (uključujući i 'guest' profil i sve zastavice)
      if (userId) {
        window.localStorage.setItem(`ai_trener_profile_${userId}`, JSON.stringify(updatedProfile));
      }

      // 3. Upsert to Supabase (samo za prijavljene korisnike i samo dopuštene stupce)
      if (userId && userId !== 'guest') {
        const payload = { user_id: userId };
        for (const col of SUPABASE_PROFILE_COLUMNS) {
          if (updatedProfile[col] !== undefined) {
            payload[col] = updatedProfile[col];
          }
        }

        supabase
          .from('profiles')
          .upsert(payload)
          .then(({ error }) => {
            if (error) {
              console.error('Error saving profile to Supabase:', error);
            }
          })
          .catch((err) => {
            console.error('Error updating profile in sync layer:', err);
          });
      }

      return updatedProfile;
    });
  }, [userId, initialValue]);

  return [profile, setProfile];
}
