#!/usr/bin/env node
/** Локальный read-only клиент RuStore Public API. Не изменяет данные в консоли. */
import {
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API_ROOT = process.env.RUSTORE_API_ROOT || 'https://public-api.rustore.ru';
if (!['https://public-api.rustore.ru', 'https://public-api-m.rustore.ru'].includes(API_ROOT)) {
  throw new Error('RUSTORE_API_ROOT допускает только официальные домены RuStore Public API.');
}
const PACKAGE_NAME = 'com.anooplan.app';
const DEFAULT_KEY_FILE = resolve(ROOT, 'keystore/rustore/api-private-key.txt');
const DEFAULT_KEY_ID_FILE = resolve(ROOT, 'keystore/rustore/api-key-id.txt');
const action = process.argv[2] || 'check-key';

function readPrivateKey() {
  const path = process.env.RUSTORE_PRIVATE_KEY_FILE || DEFAULT_KEY_FILE;
  let encoded;
  try {
    encoded = readFileSync(path, 'utf8').trim();
  } catch {
    throw new Error(`Не найден файл приватного ключа: ${path}`);
  }
  try {
    const der = Buffer.from(encoded, 'base64');
    if (!encoded || der.toString('base64') !== encoded) throw new Error('Base64');
    const key = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
    if (key.asymmetricKeyType !== 'rsa') throw new Error('RSA');
    return key;
  } catch {
    throw new Error('Приватный ключ RuStore API должен быть RSA-ключом PKCS#8 в Base64.');
  }
}

function readKeyId() {
  const keyId = (process.env.RUSTORE_KEY_ID || '').trim()
    || (() => {
      try { return readFileSync(DEFAULT_KEY_ID_FILE, 'utf8').trim(); } catch { return ''; }
    })();
  if (!keyId) {
    throw new Error(
      'Не задан ID ключа RuStore API. Укажите RUSTORE_KEY_ID или сохраните ID в '
      + 'keystore/rustore/api-key-id.txt (каталог исключён из Git).',
    );
  }
  return keyId;
}

function checkKey(key) {
  const message = Buffer.from('AnOOPlan local RuStore key check', 'utf8');
  const signature = sign('RSA-SHA512', message, key);
  if (!verify('RSA-SHA512', message, createPublicKey(key), signature)) {
    throw new Error('Локальная проверка подписи RSA-SHA512 не пройдена.');
  }
  return {
    valid: true,
    type: 'RSA',
    format: 'PKCS#8',
    bits: key.asymmetricKeyDetails?.modulusLength || null,
    signatureAlgorithm: 'SHA512withRSA',
    keyIdConfigured: Boolean(
      (process.env.RUSTORE_KEY_ID || '').trim()
      || (() => { try { return readFileSync(DEFAULT_KEY_ID_FILE, 'utf8').trim(); } catch { return ''; } })(),
    ),
  };
}

async function apiRequest(path, { token, method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { 'Public-Token': token } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error('Не удалось связаться с RuStore API. Проверьте сеть и повторите попытку позже.');
  }
  const text = await response.text();
  let result;
  try { result = JSON.parse(text); } catch {
    throw new Error(`RuStore API вернул не JSON (HTTP ${response.status}).`);
  }
  if (!response.ok || String(result.code).toUpperCase() !== 'OK') {
    throw new Error(
      `RuStore API: HTTP ${response.status}, код ${result.code || 'UNKNOWN'}: `
      + `${result.message || 'запрос не выполнен'}`,
    );
  }
  return result;
}

async function getToken(key, keyId) {
  const timestamp = new Date().toISOString();
  const signature = sign('RSA-SHA512', Buffer.from(keyId + timestamp, 'utf8'), key)
    .toString('base64');
  const result = await apiRequest('/public/auth', {
    method: 'POST',
    body: { keyId, timestamp, signature },
  });
  if (!result.body?.jwe) throw new Error('RuStore API не вернул JWE-токен.');
  return result.body.jwe;
}

async function listApps(token) {
  const result = await apiRequest('/public/v1/application', { token });
  const apps = result.body?.content;
  if (!Array.isArray(apps)) throw new Error('Неожиданный формат списка приложений RuStore.');
  return apps.map(app => ({
    appId: app.appId,
    packageName: app.packageName,
    appName: app.appName,
    appStatus: app.appStatus,
    versionName: app.versionName,
    versionCode: app.versionCode,
    paid: app.paid,
  }));
}

async function listVersions(token, versionId) {
  const query = versionId
    ? `?ids=${encodeURIComponent(versionId)}`
    : '?page=0&size=100';
  const result = await apiRequest(
    `/public/v1/application/${encodeURIComponent(PACKAGE_NAME)}/version${query}`,
    { token },
  );
  const versions = result.body?.content;
  if (!Array.isArray(versions)) throw new Error('Неожиданный формат списка версий RuStore.');
  return versions.map(version => ({
    versionId: version.versionId,
    versionName: version.versionName,
    versionCode: version.versionCode,
    versionStatus: version.versionStatus,
    publishType: version.publishType,
    sendDateForModer: version.sendDateForModer,
    publishDateTime: version.publishDateTime,
    partialValue: version.partialValue,
    whatsNew: version.whatsNew,
  }));
}

function usage() {
  console.log(`Использование:
  node scripts/rustore-api.mjs check-key          локальная проверка ключа, без сети
  node scripts/rustore-api.mjs apps               только чтение списка приложений
  node scripts/rustore-api.mjs versions [id]      только чтение версий AnOOPlan

Приватный ключ: keystore/rustore/api-private-key.txt
ID ключа: переменная RUSTORE_KEY_ID или keystore/rustore/api-key-id.txt
Операции создания, изменения, загрузки, модерации и публикации не поддерживаются.`);
}

try {
  const key = readPrivateKey();
  if (action === 'check-key') {
    console.log(JSON.stringify(checkKey(key), null, 2));
  } else if (action === 'apps' || action === 'versions') {
    const token = await getToken(key, readKeyId());
    const data = action === 'apps'
      ? await listApps(token)
      : await listVersions(token, process.argv[3]);
    console.log(JSON.stringify(data, null, 2));
  } else {
    usage();
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Неизвестная ошибка RuStore API.');
  process.exitCode = 1;
}
