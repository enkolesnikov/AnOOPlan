import type { ProjectPdfAttachment, ProjectPhotoAttachment } from './project-file';

/** Манифест вложений архива: позволяет отличить полную копию от повреждённой. */
export interface AttachmentManifestEntry {
  kind: 'pdf' | 'photo';
  id: string;
  size: number;
  sha256: string;
}

export interface AttachmentManifest {
  version: 1;
  files: AttachmentManifestEntry[];
}

const hex = (buffer: ArrayBuffer): string => [...new Uint8Array(buffer)].map(value => value.toString(16).padStart(2, '0')).join('');
const bytesOf = (base64: string): Uint8Array => Uint8Array.from(atob(base64), char => char.charCodeAt(0));

async function digest(base64: string): Promise<{ size: number; sha256: string }> {
  const bytes = bytesOf(base64);
  const hash = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return { size: bytes.byteLength, sha256: hex(hash) };
}

/** Строит манифест по фактическим вложениям архива. */
export async function buildAttachmentManifest(
  pdfs: ProjectPdfAttachment[],
  photos: ProjectPhotoAttachment[],
): Promise<AttachmentManifest> {
  const files: AttachmentManifestEntry[] = [];
  for (const pdf of pdfs) files.push({ kind: 'pdf', id: pdf.id, ...(await digest(pdf.dataBase64)) });
  for (const photo of photos) files.push({ kind: 'photo', id: photo.key, ...(await digest(photo.dataBase64)) });
  return { version: 1, files };
}

/** Проверяет манифест: набор, размеры и SHA-256 должны совпасть с вложениями. */
export async function verifyAttachmentManifest(
  manifest: AttachmentManifest,
  pdfs: ProjectPdfAttachment[],
  photos: ProjectPhotoAttachment[],
): Promise<void> {
  const expected = new Map(manifest.files.map(entry => [`${entry.kind}:${entry.id}`, entry]));
  const actual = [...pdfs.map(pdf => ({ kind: 'pdf' as const, id: pdf.id, dataBase64: pdf.dataBase64 })),
    ...photos.map(photo => ({ kind: 'photo' as const, id: photo.key, dataBase64: photo.dataBase64 }))];
  if (expected.size !== actual.length) throw new Error(`Манифест неполный: вложений в файле ${actual.length}, в манифесте ${expected.size}.`);
  for (const item of actual) {
    const entry = expected.get(`${item.kind}:${item.id}`);
    if (!entry) throw new Error(`Вложение ${item.kind}:${item.id} отсутствует в манифесте.`);
    const { size, sha256 } = await digest(item.dataBase64);
    if (entry.size !== size || entry.sha256 !== sha256) throw new Error(`Вложение ${item.kind}:${item.id} повреждено (SHA-256 не совпал).`);
  }
}
