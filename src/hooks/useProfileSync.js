import { useState, useEffect } from 'react';
import { supabase } from '../services/supabaseClient';

export function useProfileSync(initialValue) {
  const [profile, setProfileState] = useState(() => {
    try {
      const item = window.localStorage.getItem('ai_trener_profile');
      if (item !== null) {
        try {
          return JSON.parse(item);
        } catch {
          return initialValue;
        }
      }
      return initialValue;
    } catch (error) {
      console.warn('Error reading localStorage key "ai_trener_profile":', error);
      return initialValue;
    }
  });

  // Fetch initial profile from Supabase
  useEffect(() => {
    async function fetchSupabaseProfile() {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', 1)
          .single();

        if (error) {
          if (error.code !== 'PGRST116') {
            // PGRST116 is "No rows found"
            console.error('Error fetching profile from Supabase:', error);
          }
          return;
        }

        if (data) {
          // Merge local defaults with what is returned from Supabase
          const merged = { ...initialValue, ...data };
          setProfileState(merged);
          window.localStorage.setItem('ai_trener_profile', JSON.stringify(merged));
        }
      } catch (err) {
        console.error('Network or unexpected error while fetching profile:', err);
      }
    }
    
    fetchSupabaseProfile();
  }, []);

  // Update profile locally and remote
  const setProfile = async (newProfileData) => {
    try {
      const updatedProfile = typeof newProfileData === 'function' ? newProfileData(profile) : newProfileData;

      // 1. Update component state
      setProfileState(updatedProfile);

      // 2. Update local storage
      window.localStorage.setItem('ai_trener_profile', JSON.stringify(updatedProfile));

      // 3. Upsert to Supabase
      const { error } = await supabase
        .from('profiles')
        .upsert({ id: 1, ...updatedProfile });

      if (error) {
        console.error('Error saving profile to Supabase:', error);
      }
    } catch (error) {
      console.error('Error updating profile in sync layer:', error);
    }
  };

  return [profile, setProfile];
}
