import { useState, useEffect } from 'react';
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

export function useProfileSync(initialValue, userId) {
  const [profile, setProfileState] = useState(initialValue);

  // Fetch initial profile from localStorage + Supabase (samo za prijavljene korisnike)
  useEffect(() => {
    async function fetchSupabaseProfile() {
      if (!userId) {
        setProfileState(initialValue);
        return;
      }

      try {
        const item = window.localStorage.getItem(`ai_trener_profile_${userId}`);
        if (item) {
          const parsed = JSON.parse(item);
          if (parsed && typeof parsed === 'object') {
            const mergedLocal = { ...initialValue, ...parsed };
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
            for (const key in data) {
              if (data[key] !== null) {
                merged[key] = data[key];
              }
            }
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

  // Update profile locally and remote
  const setProfile = async (newProfileData) => {
    try {
      const baseProfile = profile || initialValue;
      const rawUpdated = typeof newProfileData === 'function' ? newProfileData(baseProfile) : newProfileData;
      const updatedProfile = { ...baseProfile, ...rawUpdated };

      // 1. Update component state
      setProfileState(updatedProfile);
      syncHelperStorageKeys(updatedProfile);

      // 2. Update local storage (uključujući i 'guest' profil)
      if (userId) {
        window.localStorage.setItem(`ai_trener_profile_${userId}`, JSON.stringify(updatedProfile));
      }

      // 3. Upsert to Supabase (samo za prijavljene korisnike)
      if (!userId || userId === 'guest') return;

      const payload = { user_id: userId };
      for (const key in initialValue) {
        if (updatedProfile[key] !== undefined) {
          payload[key] = updatedProfile[key];
        }
      }

      const { error } = await supabase
        .from('profiles')
        .upsert(payload);

      if (error) {
        console.error('Error saving profile to Supabase:', error);
      }
    } catch (error) {
      console.error('Error updating profile in sync layer:', error);
    }
  };

  return [profile, setProfile];
}
