/**
 * LAN-режим: сервер принимает токен из cookie. Ссылка, которую печатает
 * server/index.ts, содержит ?token=…; сохраняем его в cookie и убираем из адреса,
 * чтобы токен не оставался в истории браузера и закладках.
 */
export function installApiTokenFromUrl(search: string, cookie: Document): boolean {
  try {
    const params = new URLSearchParams(search);
    const token = params.get('token');
    if (!token) return false;
    cookie.cookie = `anooplan_token=${encodeURIComponent(token)}; path=/; SameSite=Strict`;
    params.delete('token');
    const next = params.toString();
    const url = `${window.location.pathname}${next ? `?${next}` : ''}${window.location.hash}`;
    window.history.replaceState(null, '', url);
    return true;
  } catch {
    return false;
  }
}
