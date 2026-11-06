/**
 * ErgVibe Document & Media Knowledge Parser
 * Podrška za automatsko izvlačenje teksta i znanja iz:
 * - PDF dokumenata (.pdf)
 * - EPUB e-knjiga (.epub)
 * - Tekstualnih i Markdown datoteka (.txt, .md)
 */

import JSZip from 'jszip';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Postavi URL za PDF.js web worker unutar Vite bundle-a
if (typeof window !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
}

const MAX_KNOWLEDGE_CHARS = 55000; // Sigurna granica za browser localStorage

/**
 * Parsira PDF datoteku i izvlači čisti tekst i metapodatke.
 */
export async function parsePdfFile(file, { maxPages = 40 } = {}) {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;

  let title = file.name.replace(/\.pdf$/i, '').replace(/[-_]/g, ' ');
  let author = '';

  try {
    const meta = await pdf.getMetadata();
    if (meta?.info?.Title?.trim()) {
      title = meta.info.Title.trim();
    }
    if (meta?.info?.Author?.trim()) {
      author = meta.info.Author.trim();
    }
  } catch {
    // fallback na ime datoteke
  }

  const totalPages = pdf.numPages;
  const pagesToRead = Math.min(totalPages, maxPages);
  const pageTexts = [];

  for (let i = 1; i <= pagesToRead; i++) {
    try {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageStr = textContent.items
        .map(item => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (pageStr) {
        pageTexts.push(`### Stranica ${i}\n${pageStr}`);
      }
    } catch (pageErr) {
      console.warn(`[documentParser] Greška pri čitanju PDF stranice ${i}:`, pageErr);
    }
  }

  let fullContent = pageTexts.join('\n\n');
  if (fullContent.length > MAX_KNOWLEDGE_CHARS) {
    fullContent = fullContent.slice(0, MAX_KNOWLEDGE_CHARS) + '\n\n... [Tekst je skraćen na maksimalnu veličinu za bazu znanja]';
  }

  return {
    title,
    author: author || 'PDF Literatura',
    category: 'PDF literatura',
    content: fullContent.trim(),
    totalPages,
    pagesRead: pagesToRead
  };
}

/**
 * Parsira EPUB datoteku i izvlači tekst poglavlja te naslov/autora iz OPF paketa.
 */
export async function parseEpubFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  let title = file.name.replace(/\.epub$/i, '').replace(/[-_]/g, ' ');
  let author = '';

  // 1. Pronađi OPF datoteku (glavni manifest e-knjige)
  const opfFilename = Object.keys(zip.files).find(name => name.endsWith('.opf'));
  if (opfFilename) {
    try {
      const opfXml = await zip.files[opfFilename].async('text');
      const titleMatch = opfXml.match(/<dc:title[^>]*>(.*?)<\/dc:title>/i);
      if (titleMatch) title = cleanXmlEntities(titleMatch[1]);

      const creatorMatch = opfXml.match(/<dc:creator[^>]*>(.*?)<\/dc:creator>/i);
      if (creatorMatch) author = cleanXmlEntities(creatorMatch[1]);
    } catch {
      // ignore opf parsing errors
    }
  }

  // 2. Pronađi sva poglavlja (.html / .xhtml), preskačući navigaciju i toc
  const chapterFiles = Object.keys(zip.files)
    .filter(name => /\.(x?html|htm)$/i.test(name) && !/(toc|nav|cover)\.x?html?$/i.test(name))
    .sort();

  const chapterTexts = [];
  let totalLength = 0;

  for (const chapName of chapterFiles) {
    if (totalLength >= MAX_KNOWLEDGE_CHARS) break;
    try {
      const rawHtml = await zip.files[chapName].async('text');
      const cleanText = stripHtmlToText(rawHtml);
      if (cleanText && cleanText.length > 80) { // ignoriraj prazne/premala poglavlja
        chapterTexts.push(cleanText);
        totalLength += cleanText.length;
      }
    } catch (chapErr) {
      console.warn(`[documentParser] Greška pri čitanju EPUB poglavlja ${chapName}:`, chapErr);
    }
  }

  let fullContent = chapterTexts.join('\n\n---\n\n');
  if (fullContent.length > MAX_KNOWLEDGE_CHARS) {
    fullContent = fullContent.slice(0, MAX_KNOWLEDGE_CHARS) + '\n\n... [Tekst je skraćen na maksimalnu veličinu za bazu znanja]';
  }

  return {
    title,
    author: author || 'EPUB Knjiga',
    category: 'EPUB knjiga',
    content: fullContent.trim(),
    chaptersCount: chapterFiles.length
  };
}

/**
 * Parsira običan tekstualni ili Markdown dokument (.txt, .md).
 */
export async function parseTextFile(file) {
  const text = await file.text();
  let title = file.name.replace(/\.(txt|md)$/i, '').replace(/[-_]/g, ' ');
  let author = '';

  // Pokušaj izvući naslov iz prvog H1 zaglavlja
  const firstH1 = text.match(/^#\s+(.+)$/m);
  if (firstH1) {
    title = firstH1[1].trim();
  }

  let content = text.trim();
  if (content.length > MAX_KNOWLEDGE_CHARS) {
    content = content.slice(0, MAX_KNOWLEDGE_CHARS) + '\n\n... [Tekst je skraćen na maksimalnu veličinu za bazu znanja]';
  }

  return {
    title,
    author,
    category: file.name.endsWith('.md') ? 'Markdown bilješke' : 'Tekstualni dokument',
    content
  };
}

function stripHtmlToText(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, '\n\n### $1\n')
    .replace(/<p[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[^>]+(>|$)/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim();
}

function cleanXmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}
