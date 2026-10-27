import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_CATALOG_BYTES, readCatalogFile } from '../src/catalog-file';

test('импорт справочника: файл больше лимита отклоняется до разбора', async () => {
  const file = new File([new Uint8Array(MAX_CATALOG_BYTES + 1)], 'big.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  await assert.rejects(readCatalogFile(file), /больше 8 МБ/);
});
