export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Machine-readable reason, e.g. "access_frozen" (see lib/types.ts BlockedCode). */
    public code: string | null = null,
  ) {
    super(message);
  }
}

/** FastAPI puts errors in `detail`: a string, or `{code, message}` for broker denials. */
async function errorFrom(res: Response): Promise<ApiError> {
  const body = await res.json().catch(() => ({}));
  const detail = body.detail;
  if (detail && typeof detail === "object") {
    return new ApiError(res.status, detail.message ?? res.statusText, detail.code ?? null);
  }
  return new ApiError(res.status, detail ?? res.statusText, body.code ?? null);
}

/** JSON fetch against the FastAPI backend. Sends the session cookie; throws ApiError on !ok. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (res.status === 204) return undefined as T;
  if (!res.ok) throw await errorFrom(res);
  return (await res.json()) as T;
}

/** Multipart upload; the browser sets the boundary, so no Content-Type header here. */
export async function apiForm<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(path, { method: "POST", credentials: "same-origin", body: form });
  if (!res.ok) throw await errorFrom(res);
  return (await res.json()) as T;
}

/** Raw bytes (decrypted record content from the broker). */
export async function apiBlob(path: string): Promise<Blob> {
  const res = await fetch(path, { credentials: "same-origin" });
  if (!res.ok) throw await errorFrom(res);
  return res.blob();
}
