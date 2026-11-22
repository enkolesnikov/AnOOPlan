// Закрепление шапки в XLSX без внешних зависимостей.
//
// SheetJS Community жёстко пишет <sheetView workbookViewId="0"/> и игнорирует
// ws['!freeze'], поэтому после сборки книги правим ZIP вручную: находим листы
// xl/worksheets/sheetN.xml, добавляем в них <pane ... state="frozen"/> и
// пересобираем архив с новыми CRC-32, размерами и центральным каталогом.

/**
 * Тег закрепления N строк: шапка остаётся на месте при прокрутке.
 * Для листа с шапкой не в первой строке (КП) закрепляем и строки над ней:
 * ySplit = fromRow + 1, данные начинаются с A(fromRow + 2).
 */
function frozenPane(rows: number): string {
  const count = Math.max(1, rows);
  return `<pane ySplit="${count}" topLeftCell="A${count + 1}" activePane="bottomLeft" state="frozen"/>`;
}

/** Сколько строк листа закрепить: шапка — первая строка автофильтра, иначе первая строка. */
function headerRowCount(xml: string): number {
  const filter = /<autoFilter[^>]*\bref="[A-Z]+(\d+)/.exec(xml);
  return filter ? Math.max(1, Number(filter[1])) : 1;
}

/** CRC-32 (IEEE 802.3), таблица считается один раз при загрузке модуля. */
const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
    table[n] = value >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let index = 0; index < data.length; index += 1) crc = CRC_TABLE[(crc ^ data[index]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/** Байты как ArrayBuffer: BlobPart в DOM-типах не принимает Uint8Array с чужим буфером. */
function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return new Uint8Array(data).buffer;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([toArrayBuffer(data)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([toArrayBuffer(data)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

interface ZipEntry {
  name: string;
  nameBytes: Uint8Array;
  localExtra: Uint8Array;
  centralExtra: Uint8Array;
  comment: Uint8Array;
  versionMadeBy: number;
  versionNeeded: number;
  flags: number;
  method: number;
  time: number;
  date: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  internalAttrs: number;
  externalAttrs: number;
  localHeaderOffset: number;
  data: Uint8Array;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const FLAG_DATA_DESCRIPTOR = 0x0008;
const FLAG_UTF8 = 0x0800;
const FLAG_ENCRYPTED = 0x0001;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

function u16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function u32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function slice(data: Uint8Array, start: number, end: number): Uint8Array {
  return data.slice(start, end);
}

/** Найти EOCD в конце архива; -1 — архив без корректного оглавления. */
function findEndOfCentralDirectory(view: DataView): number {
  const lowest = Math.max(0, view.byteLength - 0xFFFF - 22);
  for (let offset = view.byteLength - 22; offset >= lowest; offset -= 1) {
    if (u32(view, offset) === EOCD_SIGNATURE) return offset;
  }
  return -1;
}

function readEntries(bytes: Uint8Array): ZipEntry[] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfCentralDirectory(view);
  if (eocd < 0) return null;
  const count = u16(view, eocd + 10);
  const centralSize = u32(view, eocd + 12);
  const centralOffset = u32(view, eocd + 16);
  // ZIP64 и пустые архивы не поддерживаем: вызывающий вернёт исходные байты.
  if (count === 0xFFFF || centralSize === 0xFFFFFFFF || centralOffset === 0xFFFFFFFF) return null;
  if (centralOffset + centralSize > bytes.length) return null;

  const entries: ZipEntry[] = [];
  let cursor = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > bytes.length || u32(view, cursor) !== CENTRAL_SIGNATURE) return null;
    const nameLength = u16(view, cursor + 28);
    const extraLength = u16(view, cursor + 30);
    const commentLength = u16(view, cursor + 32);
    const localOffset = u32(view, cursor + 42);
    const compressedSize = u32(view, cursor + 20);
    const uncompressedSize = u32(view, cursor + 24);
    if (compressedSize === 0xFFFFFFFF || uncompressedSize === 0xFFFFFFFF || localOffset === 0xFFFFFFFF) return null;
    if (cursor + 46 + nameLength + extraLength + commentLength > bytes.length) return null;

    const nameBytes = slice(bytes, cursor + 46, cursor + 46 + nameLength);
    const centralExtra = slice(bytes, cursor + 46 + nameLength, cursor + 46 + nameLength + extraLength);
    const comment = slice(bytes, cursor + 46 + nameLength + extraLength, cursor + 46 + nameLength + extraLength + commentLength);
    if (localOffset + 30 > bytes.length || u32(view, localOffset) !== LOCAL_SIGNATURE) return null;
    const localNameLength = u16(view, localOffset + 26);
    const localExtraLength = u16(view, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    if (dataStart + compressedSize > bytes.length) return null;

    entries.push({
      name: new TextDecoder().decode(nameBytes),
      nameBytes,
      localExtra: slice(bytes, localOffset + 30 + localNameLength, dataStart),
      centralExtra,
      comment,
      versionMadeBy: u16(view, cursor + 4),
      versionNeeded: u16(view, cursor + 6),
      flags: u16(view, cursor + 8),
      method: u16(view, cursor + 10),
      time: u16(view, cursor + 12),
      date: u16(view, cursor + 14),
      crc: u32(view, cursor + 16),
      compressedSize,
      uncompressedSize,
      internalAttrs: u16(view, cursor + 36),
      externalAttrs: u32(view, cursor + 38),
      localHeaderOffset: localOffset,
      data: slice(bytes, dataStart, dataStart + compressedSize),
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function writeU16(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xFF;
  target[offset + 1] = (value >>> 8) & 0xFF;
}

function writeU32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xFF;
  target[offset + 1] = (value >>> 8) & 0xFF;
  target[offset + 2] = (value >>> 16) & 0xFF;
  target[offset + 3] = (value >>> 24) & 0xFF;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

/** Собрать ZIP заново: локальные заголовки, данные и центральный каталог. */
function writeZip(entries: ZipEntry[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    // Бит 3 (data descriptor) снимаем: размеры и CRC пишем в локальный заголовок.
    const flags = (entry.flags & ~FLAG_DATA_DESCRIPTOR) | (entry.nameBytes.some(byte => byte > 0x7F) ? FLAG_UTF8 : 0);
    const versionNeeded = Math.max(entry.versionNeeded, entry.method === METHOD_DEFLATE ? 20 : 10);

    const local = new Uint8Array(30 + entry.nameBytes.length + entry.localExtra.length);
    writeU32(local, 0, LOCAL_SIGNATURE);
    writeU16(local, 4, versionNeeded);
    writeU16(local, 6, flags);
    writeU16(local, 8, entry.method);
    writeU16(local, 10, entry.time);
    writeU16(local, 12, entry.date);
    writeU32(local, 14, entry.crc);
    writeU32(local, 18, entry.compressedSize);
    writeU32(local, 22, entry.uncompressedSize);
    writeU16(local, 26, entry.nameBytes.length);
    writeU16(local, 28, entry.localExtra.length);
    local.set(entry.nameBytes, 30);
    local.set(entry.localExtra, 30 + entry.nameBytes.length);
    localParts.push(local, entry.data);

    const central = new Uint8Array(46 + entry.nameBytes.length + entry.centralExtra.length + entry.comment.length);
    writeU32(central, 0, CENTRAL_SIGNATURE);
    writeU16(central, 4, entry.versionMadeBy);
    writeU16(central, 6, versionNeeded);
    writeU16(central, 8, flags);
    writeU16(central, 10, entry.method);
    writeU16(central, 12, entry.time);
    writeU16(central, 14, entry.date);
    writeU32(central, 16, entry.crc);
    writeU32(central, 20, entry.compressedSize);
    writeU32(central, 24, entry.uncompressedSize);
    writeU16(central, 28, entry.nameBytes.length);
    writeU16(central, 30, entry.centralExtra.length);
    writeU16(central, 32, entry.comment.length);
    writeU16(central, 34, 0);
    writeU16(central, 36, entry.internalAttrs);
    writeU32(central, 38, entry.externalAttrs);
    writeU32(central, 42, localOffset);
    central.set(entry.nameBytes, 46);
    central.set(entry.centralExtra, 46 + entry.nameBytes.length);
    central.set(entry.comment, 46 + entry.nameBytes.length + entry.centralExtra.length);
    centralParts.push(central);

    localOffset += local.length + entry.data.length;
  }

  const centralOffset = localOffset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  writeU32(end, 0, EOCD_SIGNATURE);
  writeU16(end, 8, entries.length);
  writeU16(end, 10, entries.length);
  writeU32(end, 12, centralSize);
  writeU32(end, 16, centralOffset);
  return concat([...localParts, ...centralParts, end]);
}

/**
 * Вставить дочерний <pane> в <sheetView>. Уже закреплённый лист не трогаем,
 * чтобы повторный вызов был идемпотентным.
 */
export function addFrozenPane(xml: string, frozenRows = 1): string {
  if (/<pane\b/.test(xml)) return xml;
  const pane = frozenPane(frozenRows);
  const view = /<sheetView\b([^>]*?)(\/?)>/.exec(xml);
  if (!view) {
    // Нет ни одного sheetView — вставляем целый блок перед данными листа.
    if (!xml.includes('<sheetData')) return xml;
    return xml.replace('<sheetData', `<sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews><sheetData`);
  }
  const start = view.index;
  const end = start + view[0].length;
  if (view[2] === '/') return `${xml.slice(0, start)}<sheetView${view[1]}>${pane}</sheetView>${xml.slice(end)}`;
  return `${xml.slice(0, end)}${pane}${xml.slice(end)}`;
}

/** Есть ли в окружении потоковые компрессоры (старый WebView их не имеет). */
function hasCompressionStreams(): boolean {
  return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
}

async function patchWorksheets(bytes: Uint8Array): Promise<Uint8Array> {
  const entries = readEntries(bytes);
  if (!entries || entries.length === 0) return bytes;

  let patched = false;
  const encoder = new TextEncoder();
  for (const entry of entries) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(entry.name)) continue;
    if (entry.flags & FLAG_ENCRYPTED) continue;

    let xmlBytes: Uint8Array;
    if (entry.method === METHOD_STORED) xmlBytes = entry.data;
    else if (entry.method === METHOD_DEFLATE) xmlBytes = await inflateRaw(entry.data);
    else continue;

    const xml = new TextDecoder().decode(xmlBytes);
    const updated = addFrozenPane(xml, headerRowCount(xml));
    if (updated === xml) continue;

    const output = encoder.encode(updated);
    entry.data = await deflateRaw(output);
    entry.method = METHOD_DEFLATE;
    entry.flags &= ~FLAG_DATA_DESCRIPTOR;
    entry.crc = crc32(output);
    entry.compressedSize = entry.data.length;
    entry.uncompressedSize = output.length;
    entry.versionNeeded = Math.max(entry.versionNeeded, 20);
    patched = true;
  }
  return patched ? writeZip(entries) : bytes;
}

/**
 * Закрепить шапку на всех листах книги: одна строка, а у листа с шапкой ниже
 * (коммерческое предложение) — все строки до неё включительно.
 *
 * Возвращает исходные байты без исключения, если потоковые компрессоры
 * недоступны (старый WebView) или архив не разобрался: книга остаётся
 * читаемой, просто без закрепления.
 */
export async function freezeHeaderRows(bytes: Uint8Array): Promise<Uint8Array> {
  if (!hasCompressionStreams()) return bytes;
  try {
    return await patchWorksheets(bytes);
  } catch {
    return bytes;
  }
}
