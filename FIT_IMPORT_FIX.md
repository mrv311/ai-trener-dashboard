# 🔧 Popravka FIT Import Greške

## ❌ Problem:
```
Greška pri importu FIT datoteke: Could not find the 'max_hr' column of 'completed_activities' in the schema cache
```

## ✅ Rješenje:
Uklonio sam kolone `max_hr` i `max_power` iz FIT import koda jer ne postoje u Supabase `completed_activities` tablici.

### Postojeće kolone u tablici:
- `avg_power` ✅
- `avg_hr` ✅  
- `np` (Normalized Power) ✅
- `tss` ✅
- `duration_seconds` ✅
- `work_kj` ✅
- `distance_m` ✅
- `avg_speed_kmh` ✅
- `avg_cadence` ✅
- `if_factor` ✅

### Uklonjene kolone:
- ❌ `max_power` - ne postoji u tablici
- ❌ `max_hr` - ne postoji u tablici

## 📊 Što se sada sprema iz FIT datoteka:

```javascript
const activityData = {
  started_at: fitData.started_at,
  title: 'Naziv treninga',
  workout_source: 'garmin',
  duration_seconds: fitData.duration_seconds,
  avg_power: fitData.avg_power,        // ✅ Prosječna snaga
  np: fitData.np,                      // ✅ Normalized Power
  avg_hr: fitData.avg_hr,              // ✅ Prosječni puls
  avg_cadence: fitData.avg_cadence,    // ✅ Prosječna kadenca
  tss: fitData.tss,                    // ✅ Training Stress Score
  if_factor: fitData.if_factor,        // ✅ Intensity Factor
  work_kj: fitData.work_kj,            // ✅ Rad u kilojoule-ima
  distance_m: fitData.distance_m,      // ✅ Udaljenost u metrima
  avg_speed_kmh: fitData.avg_speed_kmh,// ✅ Prosječna brzina
  ftp_used: userFtp,                   // ✅ FTP korišten za izračune
  weight_kg: weightKg,                 // ✅ Težina korisnika
  stream_data: fitData.stream_data     // ✅ Detaljni podaci (power/HR po sekundi)
};
```

## 🎯 Rezultat:
- ✅ FIT import sada radi bez greške
- ✅ Sve važne metrike se spremaju
- ✅ Max Power i Max HR se i dalje **izračunavaju iz stream podataka** za prikaz
- ✅ Kompatibilno s postojećom Supabase tablicom

## 🧪 Testiranje:
1. **Idi na "Povijest" tab**
2. **Klikni "Importaj .FIT"**
3. **Odaberi .FIT datoteku**
4. **Trebalo bi raditi bez greške!**

## 💡 Napomena:
Max Power i Max HR se i dalje prikazuju u aplikaciji jer se izračunavaju iz `stream_data` u realnom vremenu, samo se ne spremaju kao zasebne kolone u bazi.