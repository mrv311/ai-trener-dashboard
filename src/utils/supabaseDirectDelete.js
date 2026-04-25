/**
 * Direktno brisanje iz Supabase baze - za debug i hitne slučajeve
 */

import { supabase } from '../services/supabaseClient';

/**
 * Briše sve aktivnosti za određeni datum
 * @param {string} date - Datum u formatu YYYY-MM-DD
 */
export const deleteActivitiesByDate = async (date) => {
  try {
    console.log('[DirectDelete] Brišem sve aktivnosti za datum:', date);
    
    const dayStart = `${date}T00:00:00`;
    const dayEnd = `${date}T23:59:59`;

    // Prvo dohvati aktivnosti za pregled
    const { data: activities, error: fetchError } = await supabase
      .from('completed_activities')
      .select('id, title, started_at, avg_power, np, tss')
      .gte('started_at', dayStart)
      .lte('started_at', dayEnd);

    if (fetchError) throw fetchError;

    console.log('[DirectDelete] Pronađene aktivnosti za brisanje:', activities);

    if (activities.length === 0) {
      console.log('[DirectDelete] Nema aktivnosti za brisanje');
      return { success: true, deleted: 0 };
    }

    // Briši sve aktivnosti
    const { error: deleteError } = await supabase
      .from('completed_activities')
      .delete()
      .gte('started_at', dayStart)
      .lte('started_at', dayEnd);

    if (deleteError) throw deleteError;

    console.log('[DirectDelete] Uspješno obrisano', activities.length, 'aktivnosti');
    return { success: true, deleted: activities.length, activities };
  } catch (error) {
    console.error('[DirectDelete] Greška:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Briše aktivnost po ID-u
 * @param {number} id - Supabase ID aktivnosti
 */
export const deleteActivityById = async (id) => {
  try {
    console.log('[DirectDelete] Brišem aktivnost ID:', id);
    
    // Prvo dohvati aktivnost za pregled
    const { data: activity, error: fetchError } = await supabase
      .from('completed_activities')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError) throw fetchError;

    console.log('[DirectDelete] Pronađena aktivnost za brisanje:', activity);

    // Briši aktivnost
    const { error: deleteError } = await supabase
      .from('completed_activities')
      .delete()
      .eq('id', id);

    if (deleteError) throw deleteError;

    console.log('[DirectDelete] Uspješno obrisana aktivnost:', activity.title);
    return { success: true, activity };
  } catch (error) {
    console.error('[DirectDelete] Greška:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Lista svih aktivnosti s osnovnim podacima
 */
export const listAllActivities = async () => {
  try {
    const { data, error } = await supabase
      .from('completed_activities')
      .select('id, title, started_at, avg_power, np, tss, workout_source')
      .order('started_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    console.log('[DirectDelete] Lista aktivnosti:', data);
    return { success: true, activities: data };
  } catch (error) {
    console.error('[DirectDelete] Greška:', error);
    return { success: false, error: error.message };
  }
};

// Dodaj funkcije u window objekt za lakše korištenje u konzoli
if (typeof window !== 'undefined') {
  window.supabaseDebug = {
    deleteByDate: deleteActivitiesByDate,
    deleteById: deleteActivityById,
    listAll: listAllActivities
  };
  
  console.log('🔧 Supabase debug funkcije dostupne u window.supabaseDebug:');
  console.log('- window.supabaseDebug.deleteByDate("2026-04-21")');
  console.log('- window.supabaseDebug.deleteById(123)');
  console.log('- window.supabaseDebug.listAll()');
}