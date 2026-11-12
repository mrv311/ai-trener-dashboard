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
 * Čita korisnički odabranu ili zalijepljenu datoteku (File / Blob),
 * provjerava tip i veličinu, te vraća strukturirani objekt spreman za spremanje.
 */
export async function processFileForAi(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('Datoteka nije odabrana.'));

    const MAX_SIZE_MB = 15;
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      return reject(
        new Error(`Datoteka '${file.name || 'Prilog'}' je prevelika (${(file.size / (1024 * 1024)).toFixed(1)} MB). Maksimalna dopuštena veličina je ${MAX_SIZE_MB} MB.`)
      );
    }

    const type = file.type || '';
    const isImage = type.startsWith('image/');
    const isPdf = type === 'application/pdf' || (file.name && file.name.toLowerCase().endsWith('.pdf'));

    if (!isImage && !isPdf) {
      return reject(new Error(`Format datoteke '${file.name || ''}' nije podržan. Možete priložiti slike (JPG, PNG, WEBP) ili PDF dokumente.`));
    }

    const resolvedMime = isPdf ? 'application/pdf' : type;

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
