# Test Delete Functionality

## Što testirati:

1. **Otvori aplikaciju**: http://localhost:5176/
2. **Idi na "Povijest" tab**
3. **Pronađi trening od 21.4.** (ili bilo koji Supabase trening)
4. **Klikni na trening** da otvoriš detalje
5. **Provjeri da li se prikazuje gumb "Obriši"** (crveni gumb)
6. **Klikni "Obriši"** i potvrdi
7. **Provjeri konzolu** za debug logove

## Debug logovi koje očekujemo:

```
[HistoryTab] handleViewDetail pozvan za aktivnost: {id: "supabase-123", source: "supabase", isSupabase: true, ...}
[HistoryTab] handleDelete pozvan za ID: supabase-123
[HistoryTab] Pronađena aktivnost za brisanje: {id: "supabase-123", source: "supabase", ...}
[HistoryTab] Brišem Supabase aktivnost ID: 123
[HistoryTab] Aktivnost uspješno obrisana iz Supabase
```

## Mogući problemi:

1. **Gumb se ne prikazuje** → `selectedActivity.source !== 'supabase'`
2. **Greška pri brisanju** → Problem s Supabase upitom
3. **Aktivnost se ne uklanja iz liste** → Problem s state update-om

## Alternativno testiranje:

Ako ne radi iz detail modala, testiraj iz liste:
1. **Pronađi Supabase trening u listi**
2. **Klikni trash ikonu** (desno od treninga)
3. **Potvrdi brisanje**