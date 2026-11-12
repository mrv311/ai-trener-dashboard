/**
 * ErgVibe AI Files Storage Service
 * 
 * Pohranjuje slike i PDF datoteke isključivo lokalno u pregledniku (IndexedDB)
 * radi maksimalne privatnosti korisnika. Datoteke se NIKADA ne šalju na vanjske servere
 * za pohranu, već se šalju samo izravno u Gemini API poziv dok traje analiza.
 */

const DB_NAME = 'ergvibe_ai_files';
const DB_VERSION = 1;
const STORE_NAME = 'attachments';

function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return reject(new Error('IndexedDB nije podržan u ovom pregledniku.'));
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Greška pri otvaranju lokalne baze.'));
  });
}

/**
 * Sprema privitak (sa čistim base64 podacima i dataUrl) u lokalni IndexedDB.
 */
export async function saveAttachmentToLocalDB(attachment) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(attachment);
    req.onsuccess = () => resolve(attachment.id);
    req.onerror = () => reject(req.error || new Error('Neuspjelo spremanje privitka u IndexedDB.'));
  });
}

/**
 * Dohvaća jedan privitak po ID-ju iz IndexedDB-a.
 */
export async function getAttachmentFromLocalDB(id) {
  if (!id) return null;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error || new Error('Greška pri čitanju privitka.'));
  });
}

/**
 * Dohvaća više privitaka po listi ID-jeva.
 */
export async function getAttachmentsFromLocalDB(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const results = [];
  for (const id of ids) {
    try {
      const item = await getAttachmentFromLocalDB(id);
      if (item) results.push(item);
    } catch (e) {
      console.warn('[aiFilesStorage] Neuspjelo dohvaćanje privitka:', id, e);
    }
  }
  return results;
}

/**
 * Briše privitak iz IndexedDB-a.
 */
export async function deleteAttachmentFromLocalDB(id) {
  if (!id) return true;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error || new Error('Neuspjelo brisanje privitka.'));
  });
}

/**
 * Čisti sve privitke iz IndexedDB-a (npr. pri čišćenju chata).
 */
export async function clearAllAttachmentsFromLocalDB() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.clear();
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error || new Error('Neuspjelo pražnjenje tablice privitaka.'));
  });
}

/**
 * Pomoćna funkcija za optimizaciju i proporcionalno smanjenje prevelikih slika.
 * Osigurava maksimalnu oštrinu teksta i grafikona za AI, uz drastično brže slanje i manji payload.
 */
async function optimizeImageForAi(file) {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return resolve(null);
    }

    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX_DIM = 1920;
      let { width, height } = img;

      // Ako je slika već manja od 1920px i manja od 2MB, nema potrebe za rekodiranjem
      if (width <= MAX_DIM && height <= MAX_DIM && file.size <= 2 * 1024 * 1024) {
        const reader = new FileReader();
        reader.onload = () => {
          const resultStr = String(reader.result || '');
          const base64Index = resultStr.indexOf(';base64,');
          resolve({
            dataUrl: resultStr,
            dataBase64: base64Index !== -1 ? resultStr.slice(base64Index + 8) : resultStr,
            type: file.type || 'image/jpeg',
            size: file.size
          });
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
        return;
      }

      // Proporcionalno skaliraj ako premašuje maksimalnu dimenziju
      if (width > MAX_DIM || height > MAX_DIM) {
        if (width > height) {
          height = Math.round((height * MAX_DIM) / width);
          width = MAX_DIM;
        } else {
          width = Math.round((width * MAX_DIM) / height);
          height = MAX_DIM;
        }
      }

      try {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(null);

        ctx.drawImage(img, 0, 0, width, height);
        const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        const quality = mime === 'image/jpeg' ? 0.88 : undefined;
        const dataUrl = canvas.toDataURL(mime, quality);
        const base64Index = dataUrl.indexOf(';base64,');
        const dataBase64 = base64Index !== -1 ? dataUrl.slice(base64Index + 8) : dataUrl;
        const approxBytes = Math.round((dataBase64.length * 3) / 4);

        resolve({
          dataUrl,
          dataBase64,
          type: mime,
          size: approxBytes
        });
      } catch (err) {
        console.warn('[aiFilesStorage] Canvas optimizacija greška, fallback:', err);
        resolve(null);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };

    img.src = url;
  });
}

/**
 * Čita korisnički odabranu ili zalijepljenu datoteku (File / Blob),
 * provjerava tip i veličinu, te vraća strukturirani objekt spreman za spremanje.
 */
export async function processFileForAi(file) {
  if (!file) throw new Error('Datoteka nije odabrana.');

  const MAX_SIZE_MB = 20;
  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    throw new Error(
      `Datoteka '${file.name || 'Prilog'}' je prevelika (${(file.size / (1024 * 1024)).toFixed(1)} MB). Maksimalna dopuštena veličina je ${MAX_SIZE_MB} MB.`
    );
  }

  const type = file.type || '';
  const isImage = type.startsWith('image/');
  const isPdf = type === 'application/pdf' || (file.name && file.name.toLowerCase().endsWith('.pdf'));

  if (!isImage && !isPdf) {
    throw new Error(`Format datoteke '${file.name || ''}' nije podržan. Možete priložiti slike (JPG, PNG, WEBP) ili PDF dokumente.`);
  }

  const resolvedMime = isPdf ? 'application/pdf' : type;

  // 1. Za slike: pokušaj optimizaciju i skaliranje na max 1920px za kristalno jasnu OCR detekciju bez kašnjenja
  if (isImage) {
    try {
      const optimized = await optimizeImageForAi(file);
      if (optimized?.dataBase64) {
        const id = 'att_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
        return {
          id,
          name: file.name || 'slika.png',
          type: optimized.type || resolvedMime,
          size: optimized.size || file.size,
          dataBase64: optimized.dataBase64,
          dataUrl: optimized.dataUrl,
          createdAt: new Date().toISOString()
        };
      }
    } catch (e) {
      console.warn('[processFileForAi] Optimizacija slike zabilježila iznimku, nastavljam s izvornom:', e);
    }
  }

  // 2. Standardno učitavanje za PDF ili fallback za slike
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const resultStr = String(reader.result || '');
      const base64Index = resultStr.indexOf(';base64,');
      const dataBase64 = base64Index !== -1 ? resultStr.slice(base64Index + 8) : resultStr;

      const id = 'att_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
      const attachment = {
        id,
        name: file.name || (isPdf ? 'dokument.pdf' : 'slika.png'),
        type: resolvedMime,
        size: file.size,
        dataBase64,
        dataUrl: resultStr,
        createdAt: new Date().toISOString()
      };

      resolve(attachment);
    };
    reader.onerror = () => reject(new Error('Greška pri čitanju datoteke s vašeg uređaja.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Formatira veličinu datoteke u čitljiv oblik (KB / MB).
 */
export function formatFileSize(bytes) {
  if (!bytes || isNaN(bytes)) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
