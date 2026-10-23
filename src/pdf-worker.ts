// Точка входа воркера PDF.js: сначала полифиллы, затем сам воркер.
// Без этого на WebView < Chrome 119 падал разбор PDF (Promise.withResolvers).
import './polyfills';
import 'pdfjs-dist/legacy/build/pdf.worker.min.mjs';
