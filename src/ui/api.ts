/** Запрос к серверному API: текст ошибки сохраняется как есть. */
export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) { const text = await response.text(); throw new Error(text || `HTTP ${response.status}`); }
  return response.json() as Promise<T>;
}

/** JSON-запрос: заголовки и сериализация тела в одном месте. */
export const jsonOptions = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
