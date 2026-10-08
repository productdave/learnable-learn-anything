import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import mammoth from 'mammoth';
import yauzl from 'yauzl';

export const DOCUMENT_LIMITS = Object.freeze({ bytes: 10 * 1024 * 1024, characters: 48000, pages: 100, entries: 1000, expandedBytes: 20 * 1024 * 1024, xmlBytes: 5 * 1024 * 1024, timeoutMs: 8000 });
const fail = (code, message) => Object.assign(new Error(message), { code, safeToShow: true });
const count = text => Array.from(text).length;
let activeReaders = 0;
function checked(text) {
  if (!text.trim()) throw fail('empty', 'No readable text was found. Export a text version or paste the relevant text into Notes.');
  if (count(text) > DOCUMENT_LIMITS.characters) throw fail('text-limit', 'This file exceeds 48,000 text characters. Attach a shorter selection or paste relevant sections into Notes. Nothing was truncated.');
  return text;
}

// Inspect actual inflated bytes, not just ZIP headers. Nothing is written to disk.
async function checkDocxArchive(bytes) {
  if (bytes.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))) throw fail('protected-docx', 'This looks like an encrypted or older Word file. Save an unprotected DOCX copy, or paste its text into Notes.');
  await new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => {
      if (error) return reject(fail('invalid-docx', 'This DOCX could not be opened. Re-export it from Word or paste its text into Notes.'));
      let total = 0, entries = 0, done = false;
      const names = new Set();
      const stop = error => { if (done) return; done = true; zip.close(); reject(error); };
      zip.on('error', () => stop(fail('invalid-docx', 'This DOCX archive is damaged. Re-export it or paste its text into Notes.')));
      zip.on('entry', entry => {
        const xml = /\.(xml|rels)$/i.test(entry.fileName);
        if (++entries > DOCUMENT_LIMITS.entries || names.has(entry.fileName) || entry.generalPurposeBitFlag & 1 || /(^|\/)\.\.(\/|$)|^\/|\\/.test(entry.fileName)) return stop(fail('unsafe-docx', 'This DOCX has an unsupported archive structure or encryption. Re-export a plain DOCX copy.'));
        names.add(entry.fileName);
        if (entry.uncompressedSize > DOCUMENT_LIMITS.expandedBytes || (xml && entry.uncompressedSize > DOCUMENT_LIMITS.xmlBytes)) return stop(fail('archive-limit', 'This DOCX expands beyond the reading limit. Export a smaller document or paste selected text into Notes.'));
        if (entry.fileName.endsWith('/')) { zip.readEntry(); return; }
        zip.openReadStream(entry, (error, stream) => {
          if (error) return stop(fail('invalid-docx', 'This DOCX could not be read. Re-export it or paste its text into Notes.'));
          const chunks = []; let size = 0;
          stream.on('error', () => stop(fail('invalid-docx', 'This DOCX is damaged. Re-export it or paste its text into Notes.')));
          stream.on('data', chunk => {
            total += chunk.length; size += chunk.length;
            if (total > DOCUMENT_LIMITS.expandedBytes || (xml && size > DOCUMENT_LIMITS.xmlBytes)) { stream.destroy(); stop(fail('archive-limit', 'This DOCX expands beyond the reading limit. Export a smaller document or paste selected text into Notes.')); return; }
            if (xml) chunks.push(chunk);
          });
          stream.on('end', () => {
            if (done) return;
            // Null removal also catches UTF-16 encoded declarations. No DTD/entity processing.
            if (xml && /<!\s*(DOCTYPE|ENTITY)/i.test(Buffer.concat(chunks).toString('utf8').replace(/\0/g, ''))) return stop(fail('unsafe-xml', 'This DOCX contains unsupported XML declarations. Re-export it as a plain DOCX.'));
            zip.readEntry();
          });
        });
      });
      zip.on('end', () => {
        if (done) return;
        if (!names.has('word/document.xml') || !names.has('[Content_Types].xml')) return stop(fail('invalid-docx', 'This is not a readable DOCX document. Export a DOCX from your editor.'));
        done = true; resolve();
      });
      zip.readEntry();
    });
  });
}

async function extract(bytes, kind) {
  if (kind === 'txt') {
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw fail('encoding', 'This file is not UTF-8 text. Save it as UTF-8 or paste its text into Notes.'); }
    if (text.includes('\0')) throw fail('binary', 'This file contains binary content. Paste its text into Notes instead.');
    return { text: checked(text), warnings: [] };
  }
  if (kind === 'docx') {
    await checkDocxArchive(bytes);
    const result = await mammoth.extractRawText({ buffer: bytes });
    return { text: checked(result.value), warnings: ['Text only: images and complex layout are not included. Check that important content is present and in the right order.'] };
  }
  if (kind !== 'pdf') throw fail('unsupported', 'Use a PDF, DOCX or UTF-8 TXT file.');
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdfModule = import.meta.resolve('pdfjs-dist/legacy/build/pdf.mjs');
  class LocalPDFResources {
    async fetch({ kind, filename }) {
      const directory = { cMapUrl: 'cmaps', standardFontDataUrl: 'standard_fonts', wasmUrl: 'wasm' }[kind];
      if (!directory || !/^[a-zA-Z0-9_.-]+$/.test(filename) || filename.includes('..')) throw new Error('Unsupported PDF resource.');
      return new Uint8Array(await readFile(new URL(`../../${directory}/${filename}`, pdfModule)));
    }
  }
  const task = getDocument({ data: new Uint8Array(bytes), BinaryDataFactory: LocalPDFResources, useSystemFonts: false, disableFontFace: true, useWorkerFetch: false, isEvalSupported: false, enableXfa: false, stopAtErrors: true, verbosity: 0 });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > DOCUMENT_LIMITS.pages) throw fail('page-limit', 'This PDF has more than 100 pages. Export the relevant pages as a smaller PDF.');
    const pages = [], unreadable = []; let characters = 0;
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number), content = await page.getTextContent();
      const text = content.items.filter(item => typeof item.str === 'string').map(item => item.str + (item.hasEOL ? '\n' : ' ')).join('').trim();
      page.cleanup();
      if (!text) unreadable.push(number);
      characters += count(text) + (number > 1 ? 2 : 0);
      if (characters > DOCUMENT_LIMITS.characters) throw fail('text-limit', 'This PDF exceeds 48,000 text characters. Attach fewer pages. Nothing was truncated.');
      pages.push(text);
    }
    if (unreadable.length) throw fail('no-selectable-text', unreadable.length === pdf.numPages
      ? 'This PDF has no selectable text. Scanned pages and images need OCR first. Export a searchable PDF or paste a transcript into Notes.'
      : `Pages ${unreadable.slice(0, 12).join(', ')}${unreadable.length > 12 ? ' and more' : ''} have no selectable text; they may be blank or scanned. Remove blank pages or OCR scanned pages, then reattach. We have not skipped them.`);
    return { text: checked(pages.join('\n\n')), pages: pdf.numPages, warnings: ['Selectable text only: diagrams and images are not read. Columns, tables and reading order may differ from the original.'] };
  } catch (error) {
    if (error.name === 'PasswordException') throw fail('password', 'This PDF is password-protected. Export an unlocked copy or paste its text into Notes.');
    if (error.safeToShow) throw error;
    throw fail('invalid-pdf', 'This PDF could not be read completely. Re-export it as a searchable PDF or paste its text into Notes.');
  } finally { await task.destroy(); }
}

// One bounded worker per file keeps malformed documents off the API event loop.
// The same module is the worker entry, so dependency tracing sees all readers.
export async function readDocument(bytes, kind, { timeoutMs = DOCUMENT_LIMITS.timeoutMs } = {}) {
  if (!bytes.length || bytes.length > DOCUMENT_LIMITS.bytes) throw fail('file-limit', 'Use a non-empty file no larger than 10 MB.');
  if (activeReaders >= 2) throw fail('reader-busy', 'The file reader is busy. Try Check again in a moment; your original is saved.');
  return new Promise((resolve, reject) => {
    let worker;
    try { worker = new Worker(new URL(import.meta.url), { workerData: { learnableReader: true, bytes, kind }, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 32 }, stdout: true, stderr: true }); }
    catch { reject(fail('reader-unavailable', 'The file reader is unavailable. Try again, or paste relevant text into Notes.')); return; }
    activeReaders++;
    worker.stdout.resume(); worker.stderr.resume();
    let settled = false;
    const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); void worker.terminate().finally(() => { activeReaders--; error ? reject(error) : resolve(result); }); };
    const timer = setTimeout(() => finish(fail('timeout', 'Reading this file took too long. Try a smaller document, or paste relevant text into Notes.')), Math.max(1, timeoutMs));
    worker.once('message', message => message.error ? finish(fail(message.error.code, message.error.message)) : finish(null, message.result));
    worker.once('error', () => finish(fail('reader-failed', 'This file exceeded the reader’s resources or could not be opened. Try a smaller document or paste its text into Notes.')));
    worker.once('exit', () => { if (!settled) finish(fail('reader-failed', 'The file reader stopped. Retry or paste relevant text into Notes.')); });
  });
}

if (!isMainThread && workerData?.learnableReader) {
  try {
    const result = await extract(Buffer.from(workerData.bytes), workerData.kind);
    parentPort.postMessage({ result: { ...result, characters: count(result.text) } });
  } catch (error) {
    parentPort.postMessage({ error: { code: error.safeToShow ? error.code : 'invalid-document', message: error.safeToShow ? error.message : 'This document could not be read. Re-export it or paste its text into Notes.' } });
  }
}
