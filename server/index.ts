import { createApp } from './app.js';

const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || '127.0.0.1';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);
const authToken = process.env.ANOOPLAN_TOKEN?.trim() || '';
// LAN-режим без токена не запускаем: иначе проекты заказчика доступны любому в сети.
if (!LOOPBACK.has(host) && authToken.length < 16) {
  console.error(
    `Отказ: HOST=${host} открывает API в сеть. Задайте ANOOPLAN_TOKEN (не короче 16 символов) `
    + 'и передайте его клиенту заголовком Authorization: Bearer <токен>. '
    + 'Для работы только на этом компьютере не задавайте HOST (по умолчанию 127.0.0.1).',
  );
  process.exit(1);
}
if (!LOOPBACK.has(host)) {
  console.log(`LAN-режим: откройте http://${host}:${port}/?token=${encodeURIComponent(authToken)} — токен сохранится в cookie сессии.`);
}

// Токен имеет смысл только в LAN: на loopback случайно оставленная переменная
// окружения ломала бы локальный UI без подсказки.
const app = createApp({ authToken: LOOPBACK.has(host) ? undefined : (authToken || undefined) });
const server = app.listen(port, host, () => {
  console.log(`API listening on http://${host}:${port}`);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => server.close(() => { app.locals.close(); process.exit(0); }));
}
