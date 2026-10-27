import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAttachmentManifest, verifyAttachmentManifest } from '../src/attachment-manifest';

const pdf = { id: 'p1', name: 'plan.pdf', dataBase64: Buffer.from('%PDF-1.4 test').toString('base64') };
const photo = { key: 'ph1', name: 'photo.jpg', mime: 'image/jpeg', dataBase64: Buffer.from([1, 2, 3, 4]).toString('base64') };

test('манифест: полный архив проходит проверку', async () => {
  const manifest = await buildAttachmentManifest([pdf], [photo]);
  assert.equal(manifest.files.length, 2);
  await verifyAttachmentManifest(manifest, [pdf], [photo]);
});

test('манифест: подмена данных и пропуск вложения отклоняются', async () => {
  const manifest = await buildAttachmentManifest([pdf], [photo]);
  assert.ok(manifest.files.every(entry => entry.size > 0 && /^[0-9a-f]{64}$/.test(entry.sha256)));
  await assert.rejects(verifyAttachmentManifest(manifest, [{ ...pdf, dataBase64: Buffer.from('%PDF-1.4 changed').toString('base64') }], [photo]), /повреждено/);
  await assert.rejects(verifyAttachmentManifest(manifest, [pdf], []), /Манифест неполный/);
});
