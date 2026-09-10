export interface ApiOk<T> { ok: true; data: T }
export interface ApiErr { ok: false; error: string; detail?: unknown }

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly detail: unknown) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let payload: ApiOk<T> | ApiErr;
  try {
    payload = (await res.json()) as ApiOk<T> | ApiErr;
  } catch {
    throw new ApiError(res.status, 'The server sent something that was not readable.', null);
  }
  if (!res.ok || payload.ok === false) {
    const err = payload as ApiErr;
    throw new ApiError(res.status, err.error ?? 'Request failed.', err.detail ?? null);
  }
  return (payload as ApiOk<T>).data;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};
