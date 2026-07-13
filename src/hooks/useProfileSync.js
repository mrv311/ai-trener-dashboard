import { useState, useEffect } from 'react';
import { supabase } from '../services/supabaseClient';

export function useProfileSync(initialValue, userId) {
  const [profile, setProfileState] = useState(initialValue);

  // Fetch initial profile from Supabase
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
          if (parsed && typeof parsed === 'object') setProfileState(parsed);
        }
      } catch (e) {}

      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('user_id', userId)
          .single();

        if (error) {
          if (error.code !== 'PGRST116') {
            // PGRST116 is "No rows found"
            console.error('Error fetching profile from Supabase:', error);
          }
          return;
        }

        if (data) {
          // Merge current local profile (which may have local-only fields like lastFtpUpdate)
          // with what is returned from Supabase
          setProfileState((prev) => {
            const merged = { ...(prev || initialValue) };
            for (const key in data) {
              if (data[key] !== null) {
                merged[key] = data[key];
              }
            }
            window.localStorage.setItem(`ai_trener_profile_${userId}`, JSON.stringify(merged));
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
      const updatedProfile = typeof newProfileData === 'function' ? newProfileData(profile) : newProfileData;

      // 1. Update component state
      setProfileState(updatedProfile);

      // 2. Update local storage (only if we have a userId to avoid guest pollution)
      if (userId) {
        window.localStorage.setItem(`ai_trener_profile_${userId}`, JSON.stringify(updatedProfile));
      }

      // 3. Upsert to Supabase
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
