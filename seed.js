import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

const dummyWorkouts = [
  {
    title: 'Z2 Recovery & Base',
    description: 'Lagani trening izdržljivosti u Zoni 2 za građenje aerobne baze.',
    difficulty_score: 3,
    duration_seconds: 3600,
    steps: [
      { name: 'Zagrijavanje', duration: 600, power: 55 },
      { name: 'Z2 Aerobna Baza', duration: 2400, power: 70 },
      { name: 'Hlađenje', duration: 600, power: 45 }
    ]
  },
  {
    title: 'SweetSpot 3x10',
    description: 'Klasični SweetSpot intervali za podizanje FTP-a.',
    difficulty_score: 6,
    duration_seconds: 3600,
    steps: [
      { name: 'Zagrijavanje', duration: 600, power: 55 },
      { name: 'SweetSpot Interval 1', duration: 600, power: 90 },
      { name: 'Oporavak', duration: 180, power: 50 },
      { name: 'SweetSpot Interval 2', duration: 600, power: 90 },
      { name: 'Oporavak', duration: 180, power: 50 },
      { name: 'SweetSpot Interval 3', duration: 600, power: 90 },
      { name: 'Hlađenje', duration: 840, power: 45 }
    ]
  },
  {
    title: 'VO2 Max Boost',
    description: 'Kratki, oštri VO2 Max intervali za anaerobni kapacitet.',
    difficulty_score: 8,
    duration_seconds: 2400,
    steps: [
      { name: 'Zagrijavanje', duration: 600, power: 50 },
      { name: 'Z2', duration: 300, power: 65 },
      { name: 'VO2 Max 1', duration: 180, power: 110 },
      { name: 'Odmor', duration: 120, power: 50 },
      { name: 'VO2 Max 2', duration: 180, power: 110 },
      { name: 'Odmor', duration: 120, power: 50 },
      { name: 'VO2 Max 3', duration: 180, power: 110 },
      { name: 'Hlađenje', duration: 720, power: 40 }
    ]
  }
];

async function seed() {
  console.log('Spajanje na Supabase i dodavanje treninga...');
  const { data, error } = await supabase.from('workouts').insert(dummyWorkouts);
  if (error) {
    console.error('Greška:', error);
  } else {
    console.log('Uspješno dodano!');
  }
}

seed();
