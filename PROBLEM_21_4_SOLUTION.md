# 🔧 Rješenje za trening od 21.4. i brisanje

## 🎯 Problem:
- Trening od 21.4. ima sve metrike na 0 (0:00, 0W, 0 TSS)
- Ne može se brisati jer je Intervals.icu aktivnost
- Kvari tjedni sažetak

## ✅ Rješenja:

### **Opcija 1: Kloniraj u lokalnu bazu (PREPORUČENO)**
1. **Otvori trening od 21.4.** u detaljnom prikazu
2. **Klikni "Kloniraj lokalno"** (narančasti gumb s Database ikonom)
3. **Potvrdi kloniranje** - kreirati će se Supabase kopija
4. **Nova kopija će imati iste podatke** ali će se moći brisati/ažurirati
5. **Importiraj .FIT datoteku** u novu kopiju za ispravne podatke

### **Opcija 2: Direktno brisanje iz konzole**
1. **Otvori Developer Tools** (F12)
2. **Idi na Console tab**
3. **Pokreni:**
   ```javascript
   // Lista svih aktivnosti
   window.supabaseDebug.listAll()
   
   // Obriši sve aktivnosti za 21.4.
   window.supabaseDebug.deleteByDate("2026-04-21")
   
   // Ili obriši po ID-u (ako znaš ID)
   window.supabaseDebug.deleteById(123)
   ```

### **Opcija 3: Import nove .FIT datoteke**
1. **Klikni "Importaj .FIT"** (zeleni gumb u header-u)
2. **Odaberi originalnu .FIT datoteku** s Garmin-a za 21.4.
3. **Nova aktivnost će biti kreirana** s ispravnim podacima
4. **Stara će ostati** ali nova će imati prioritet u prikazu

## 🔍 Debug brisanja:

Ako se gumb za brisanje ne prikazuje:
1. **Provjeri konzolu** za logove:
   ```
   [HistoryTab] handleViewDetail pozvan za aktivnost: {source: "supabase"}
   [HistoryTab] Postavljam deleteConfirm za: supabase-123
   ```

2. **Provjeri da li je aktivnost Supabase:**
   - Mora imati **ljubičastu "Lokalno" oznaku**
   - `source` mora biti `"supabase"`

## 🚀 Novi gumbovi dodani:

### **U listi aktivnosti:**
- 🗃️ **Database ikona** (narančasta) - kloniraj Intervals aktivnost u Supabase
- 🗑️ **Trash ikona** (crvena) - obriši Supabase aktivnost

### **U detail modalu:**
- 🗃️ **"Kloniraj lokalno"** - za Intervals aktivnosti
- 🗑️ **"Obriši"** - za Supabase aktivnosti
- 📤 **"Importaj .FIT"** / **"Zamijeni .FIT"** - za sve aktivnosti

## 📊 Što se događa nakon kloniranja:

1. **Kreira se nova Supabase aktivnost** s istim podacima
2. **Označava se kao `workout_source: "intervals_clone"`**
3. **Sprema se `intervals_activity_id`** za detekciju duplikata
4. **Dohvaćaju se stream podaci** iz Intervals.icu (ako su dostupni)
5. **Nova aktivnost ima prioritet** u prikazu (Supabase > Intervals)

## 🎯 Rezultat:
- ✅ Možeš brisati problematične aktivnosti
- ✅ Možeš importirati ispravne .FIT datoteke
- ✅ Tjedni sažetak će biti ispravan
- ✅ Zadržavaš sve postojeće podatke