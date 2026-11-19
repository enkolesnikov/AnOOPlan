import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { resolve, sep } from 'node:path';
import { existsSync } from 'node:fs';
import { Store, type PdfRecord } from './store.js';
import { ApiError, assertProject, decodePdf, isPdf } from './validation.js';
import { validateProject } from '../src/engine.js';

/** Сравнение токенов без утечки длины/позиции первого различия. */
function tokenMatches(header: string, expected: string): boolean {
  const given = Buffer.from(header, 'utf8');
  const wanted = Buffer.from(expected, 'utf8');
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

/**
 * Токен для доступа к /api. Нужен, когда сервер слушает не loopback:
 * без него любой в локальной сети читает и меняет проекты (F-08 аудита 2.8.1).
 */
function cookieValue(header: string | undefined, name: string): string {
  if (!header) return '';
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) {
      try { return decodeURIComponent(part.slice(index + 1).trim()); } catch { return ''; }
    }
  }
  return '';
}

/**
 * Токен доступа: заголовок Authorization/x-anooplan-token или cookie, которую
 * ставит страница при открытии ссылки с ?token=… (см. src/api-token.ts).
 */
function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const RATE_LIMIT_MESSAGE = 'Слишком много запросов';

/** Лимитер с JSON-ответом 429; MemoryStore создаётся на каждый вызов (на экземпляр приложения). */
function limitRequests(limit: number, windowMs: number, skip?: (req: express.Request) => boolean): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    ...(skip ? { skip } : {}),
    handler: (_req, res) => { res.status(429).json({ error: RATE_LIMIT_MESSAGE }); },
  });
}

/** Манифест вложений: набор, размеры и SHA-256 должны совпасть до записи. */
function verifyRestoreManifest(manifest: unknown, records: PdfRecord[]): void {
  if (!manifest || typeof manifest !== 'object' || !Array.isArray((manifest as { files?: unknown }).files)) {
    throw new ApiError(422, 'Некорректный манифест вложений');
  }
  const files = (manifest as { files: unknown[] }).files;
  const pdfs = files.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && (entry as Record<string, unknown>).kind === 'pdf');
  if (pdfs.length !== records.length) throw new ApiError(422, 'Манифест не соответствует набору PDF');
  const expected = new Map(pdfs.map(entry => [String(entry.id), entry]));
  for (const record of records) {
    const entry = expected.get(record.id);
    if (!entry) throw new ApiError(422, `PDF ${record.id} отсутствует в манифесте`);
    const digest = sha256(record.bytes);
    if (entry.size !== record.bytes.length || entry.sha256 !== digest) {
      throw new ApiError(409, `PDF ${record.id} повреждён: SHA-256 не совпал`);
    }
  }
}

function authMiddleware(token: string): RequestHandler {
  return (req, _res, next) => {
    if (req.path === '/health') { next(); return; }
    const authorization = req.get('authorization') ?? '';
    const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    const given = bearer || req.get('x-anooplan-token') || cookieValue(req.headers.cookie, 'anooplan_token');
    if (!given || !tokenMatches(given, token)) {
      next(new ApiError(401, 'Требуется токен доступа к API (Authorization: Bearer …)'));
      return;
    }
    next();
  };
}

export interface CreateAppOptions {
  dataDir?: string;
  authToken?: string;
  /** Каталог собранного SPA; по умолчанию `dist` в cwd. Переопределяется в тестах. */
  distDir?: string;
  /** Переопределения лимитов для тестов; windowMs по умолчанию 60000. */
  rateLimits?: { api?: number; restore?: number; spa?: number; windowMs?: number };
}

export function createApp(options?: CreateAppOptions) {
  const app = express();
  const store = new Store(options?.dataDir ?? resolve(process.cwd(), 'data'));
  app.locals.store = store;
  app.locals.close = () => store.close();
  app.disable('x-powered-by');
  // Базовые защитные заголовки для всех ответов (SPA и API): запрет MIME-sniffing
  // и утечки Referer. CSP статики задаётся мета-тегом в index.html.
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  // Лимиты создаются внутри createApp: у каждого приложения свой MemoryStore,
  // поэтому тесты не делят счётчики между собой.
  const windowMs = options?.rateLimits?.windowMs ?? 60_000;
  const apiLimiter = limitRequests(options?.rateLimits?.api ?? 120, windowMs,
    // /health не лимитируем: клиент по его ответу выбирает серверный режим, и 429
    // молча переключил бы приложение в локальный режим (см. use-app-effects).
    req => req.path === '/health');
  const restoreLimiter = limitRequests(options?.rateLimits?.restore ?? 10, windowMs);
  const spaLimiter = limitRequests(options?.rateLimits?.spa ?? 300, windowMs);
  // Лимит /api стоит до авторизации и разбора тела: отсекаем поток запросов,
  // не тратя память на 80 МБ JSON и не проверяя токен под нагрузкой.
  app.use('/api', apiLimiter);
  // Лимит restore — тоже до парсера: иначе 80 МБ JSON разбирались бы до
  // проверки лимита (route-level middleware выполняется после express.json).
  app.use('/api/restore', restoreLimiter);
  // Авторизация до разбора тела: иначе LAN-клиент без токена может прислать
  // 80 МБ JSON и занять память ещё до проверки.
  if (options?.authToken) app.use('/api', authMiddleware(options.authToken));
  // 80 МБ: запас под backup с PDF/фото, но не 150 МБ на memoryStorage.
  // Парсер — только на /api: SPA отдаётся GET-ом, а глобальный парсер позволял бы
  // любому в LAN без токена буферизовать 80 МБ на несуществующем пути.
  app.use('/api', express.json({ limit: '80mb' }));
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024, files: 1, fields: 0 } });
  const getProject = (id: string) => { const p = store.project(id); if (!p) throw new ApiError(404, 'Проект не найден'); return p; };
  const warnings = (res: express.Response, project: Parameters<typeof validateProject>[0]) => {
    res.setHeader('X-Project-Warnings', String(validateProject(project).length));
  };
  app.get('/api/health', (_req, res) => { res.json({ ok: true }); });
  app.get('/api/projects', (_req, res) => { res.json(store.list()); });
  app.post('/api/projects', (req, res) => {
    assertProject(req.body, id => store.hasPdf(id));
    if (store.project(req.body.id)) throw new ApiError(409, 'Проект с таким ID уже существует');
    const p = { ...req.body, updatedAt: new Date().toISOString() };
    store.save(p); warnings(res, p); res.status(201).json(p);
  });
  app.get('/api/projects/:id', (req, res) => { res.json(getProject(req.params.id)); });
  app.put('/api/projects/:id', (req, res) => {
    getProject(req.params.id);
    assertProject(req.body, id => store.hasPdf(id));
    if (req.body.id !== req.params.id) throw new ApiError(422, 'ID URL и проекта должны совпадать');
    const p = { ...req.body, updatedAt: new Date().toISOString() };
    store.save(p); warnings(res, p); res.json(p);
  });
  app.delete('/api/projects/:id', (req, res) => {
    const project = getProject(req.params.id);
    store.deleteProject(req.params.id);
    // Удаляем исходные PDF, на которые больше не ссылается ни один проект.
    const used = new Set<string>();
    for (const summary of store.list() as { id: string }[]) {
      const other = store.project(summary.id);
      if (other) for (const floor of other.floors) if (floor.pdfId && !floor.pdfId.startsWith('data:') && !floor.pdfId.startsWith('idb:')) used.add(floor.pdfId);
    }
    for (const floor of project.floors) {
      if (floor.pdfId && !floor.pdfId.startsWith('data:') && !floor.pdfId.startsWith('idb:') && !used.has(floor.pdfId)) store.deletePdf(floor.pdfId);
    }
    res.json({ ok: true });
  });
  app.post('/api/pdfs', upload.single('file'), (req, res) => {
    if (!req.file || !isPdf(req.file.buffer)) throw new ApiError(422, 'Требуется PDF в поле file (до 30 МБ)');
    const record = { id: randomUUID(), name: req.file.originalname.replace(/[\r\n\0]/g, '').slice(0, 250) || 'plan.pdf', bytes: req.file.buffer };
    store.savePdf(record); res.status(201).json({ id: record.id, name: record.name });
  });
  app.get('/api/pdfs/:id', (req, res) => {
    const record = store.pdf(req.params.id); if (!record) throw new ApiError(404, 'PDF не найден');
    res.setHeader('Content-Disposition', `inline; filename="plan.pdf"; filename*=UTF-8''${encodeURIComponent(record.name)}`);
    res.type('application/pdf').setHeader('X-Content-Type-Options', 'nosniff'); res.send(record.bytes);
  });
  app.get('/api/projects/:id/backup', (req, res) => {
    const project = getProject(req.params.id);
    const ids = [...new Set(project.floors.flatMap(f => f.pdfId && !f.pdfId.startsWith('data:') && !f.pdfId.startsWith('idb:') ? [f.pdfId] : []))];
    const records = ids.map(id => { const record = store.pdf(id); if (!record) throw new ApiError(409, `Отсутствует PDF: ${id}`); return record; });
    const pdfs = records.map(record => ({ id: record.id, name: record.name, dataBase64: record.bytes.toString('base64') }));
    // schemaVersion 2 требует манифест при восстановлении: без него серверная
    // копия стала бы невосстановимой. Формат — src/attachment-manifest.ts.
    const manifest = { version: 1 as const, files: records.map(record => ({ kind: 'pdf' as const, id: record.id, size: record.bytes.length, sha256: sha256(record.bytes) })) };
    res.setHeader('Content-Disposition', 'attachment; filename="project-backup.json"');
    res.setHeader('X-Backup-Warnings', 'server-backup-excludes-photos');
    res.json({ schemaVersion: 2, project, pdfs, manifest, warnings: ['Серверная копия не содержит фотографии; для полной копии используйте .anooplan.'] });
  });
  app.post('/api/restore', (req, res) => {
    const backup = req.body;
    if (!backup || typeof backup !== 'object' || (backup.schemaVersion !== undefined && backup.schemaVersion !== 1 && backup.schemaVersion !== 2) || !Array.isArray(backup.pdfs) || backup.pdfs.length > 1000) throw new ApiError(422, 'Некорректный backup');
    // Сервер хранит только PDF: фото сюда не помещаются. Лучше честная ошибка,
    // чем «успешное» восстановление без фотографий.
    if (Array.isArray(backup.photos) && backup.photos.length > 0) {
      throw new ApiError(422, 'Серверное восстановление не хранит фотографии. Откройте .anooplan в приложении или браузере — фото сохранятся на устройстве.');
    }
    const ids = new Set<string>();
    const records: PdfRecord[] = backup.pdfs.map((raw: any) => {
      if (!raw || typeof raw.id !== 'string' || !raw.id.trim() || raw.id.length > 10000 || ids.has(raw.id) || typeof raw.name !== 'string' || raw.name.length > 10000) throw new ApiError(422, 'Некорректный или повторяющийся PDF ID');
      ids.add(raw.id); return { id: raw.id, name: raw.name, bytes: decodePdf(raw.dataBase64) };
    });
    // v2 обязан нести манифест: без него нельзя проверить целостность PDF, а
    // клиент мог бы «успешно» восстановить повреждённую копию. Legacy v1 (и
    // отсутствие schemaVersion) разрешены осознанно: старые копии не содержат
    // манифеста; если он всё же передан — проверяем и их.
    if (backup.schemaVersion === 2) {
      if (backup.manifest === undefined) throw new ApiError(422, 'Для schemaVersion 2 обязателен manifest вложений: без него нельзя проверить целостность PDF. Откройте старую копию в приложении и экспортируйте заново — новый экспорт содержит манифест.');
      verifyRestoreManifest(backup.manifest, records);
    } else if (backup.manifest !== undefined) {
      verifyRestoreManifest(backup.manifest, records);
    }
    // A portable backup must supply every referenced original, even if one exists locally.
    assertProject(backup.project, id => ids.has(id));
    // PDF из IndexedDB (idb:) клиент ищет в браузере, поэтому сервер сохраняет их под
    // своим id и переписывает ссылки этажей. Обычные серверные id не меняются.
    const remap = new Map<string, string>();
    // Сохраняем только PDF, на которые ссылается хотя бы один этаж: вложения
    // без ссылок остались бы сиротами, а GC серверных проектов появится в 3.0.
    const referenced = new Set<string>(backup.project.floors.flatMap((floor: { pdfId?: string }) =>
      floor.pdfId && !floor.pdfId.startsWith('data:') ? [floor.pdfId] : []));
    const storedRecords = records.filter(record => referenced.has(record.id)).map(record => {
      if (!record.id.startsWith('idb:')) return record;
      // Содержимое-адресный id: повторное восстановление того же файла
      // переиспользует PDF, а не плодит сирот с новым randomUUID.
      const id = sha256(record.bytes);
      remap.set(record.id, id);
      return { ...record, id };
    });
    const project = remap.size
      ? { ...backup.project, floors: backup.project.floors.map((floor: { pdfId?: string }) => floor.pdfId && remap.has(floor.pdfId) ? { ...floor, pdfId: remap.get(floor.pdfId) } : floor) }
      : backup.project;
    store.transaction(() => {
      for (const record of storedRecords) {
        const existing = store.pdf(record.id);
        // Для content-addressed id (sha256) имя — метаданные: байты уже те же.
        // Обычный серверный id с другим именем — конфликт, как раньше.
        const contentAddressed = /^[0-9a-f]{64}$/.test(record.id);
        if (existing && (!existing.bytes.equals(record.bytes) || (!contentAddressed && existing.name !== record.name))) {
          throw new ApiError(409, `Конфликт PDF ID: ${record.id}`);
        }
        if (!existing) store.savePdf(record);
      }
      store.save(project);
    });
    warnings(res, project); res.status(201).json(project);
  });
  app.use('/api', (_req, _res, next) => { next(new ApiError(404, 'API endpoint не найден')); });
  const dist = options?.distDir ? resolve(options.distDir) : resolve(process.cwd(), 'dist');
  if (existsSync(resolve(dist, 'index.html'))) {
    // Хешированные ассеты Vite (assets/*) кэшируем надолго и immutable, index.html —
    // no-cache, чтобы обновление подхватывалось без ручной очистки кэша.
    app.use(express.static(dist, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
        else if (filePath.split(sep).includes('assets')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      },
    }));
    // Лимит только на fallback index.html: статика выше им не ограничивается.
    app.use((req, res, next) => {
      if (req.method === 'GET' && req.accepts('html')) {
        spaLimiter(req, res, () => {
          res.setHeader('Cache-Control', 'no-cache');
          res.sendFile(resolve(dist, 'index.html'));
        });
      } else next();
    });
  }
  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (res.headersSent) return;
    const status = error instanceof ApiError ? error.status : error instanceof multer.MulterError ? (error.code === 'LIMIT_FILE_SIZE' ? 413 : 422) : error.type === 'entity.too.large' ? 413 : error.type === 'entity.parse.failed' ? 400 : 500;
    res.status(status).json({ error: status === 500 ? 'Внутренняя ошибка сервера' : error.message });
  };
  app.use(errorHandler);
  return app;
}
