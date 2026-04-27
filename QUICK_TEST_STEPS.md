# 🧪 Brzi Test - FIT Import & Delete

## 1. Otvori aplikaciju
```
http://localhost:5176/
```

## 2. Idi na "Povijest" tab

## 3. Provjeri postojeće treninge
- Pronađi trening od **21.4.** (ili bilo koji s 0 metrikama)
- Klikni na njega da otvoriš detalje

## 4. Testiraj brisanje
- U detail modalu klikni **"Obriši"** (crveni gumb)
- Potvrdi brisanje
- Provjeri da li je trening uklonjen iz liste

## 5. Testiraj import
- Klikni **"Importaj .FIT"** (zeleni gumb u header-u)
- Odaberi bilo koju .FIT datoteku s računala
- Čekaj da se parsira i spremi

## 6. Provjeri rezultat
- Novi trening treba imati ispravne metrike
- Avg Power, NP, TSS trebaju biti > 0
- Graf treba prikazati power/HR podatke

## 🔍 Debug konzola
Otvori F12 → Console i provjeri logove:
```
[HistoryTab] handleViewDetail pozvan za aktivnost: {...}
[HistoryTab] handleDelete pozvan za ID: supabase-123
[FIT Parser] Uspješno parsirano: {...}
```

## ❌ Ako ne radi:
1. **Provjeri konzolu** za greške
2. **Osvježi stranicu** (F5)
3. **Provjeri da li je gumb vidljiv** (samo za Supabase treninge)
4. **Testiraj s manjom .FIT datotekom** (< 5MB)