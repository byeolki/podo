const BASE = '/api/v1'

function getToken(): string | null {
  return localStorage.getItem('access_token')
}

export function setTokens(access: string, refresh: string) {
  localStorage.setItem('access_token', access)
  localStorage.setItem('refresh_token', refresh)
}

export function clearTokens() {
  localStorage.removeItem('access_token')
  localStorage.removeItem('refresh_token')
}

export function getStreamUrl(trackId: string, normalize?: boolean): string {
  const token = getToken()
  const params = new URLSearchParams()
  if (normalize) params.set('normalize', '1')
  if (token) params.set('token', token)
  const qs = params.toString()
  return `${BASE}/stream/${trackId}${qs ? `?${qs}` : ''}`
}

export function getVideoStreamUrl(trackId: string): string {
  const token = getToken()
  return `${BASE}/stream/${trackId}?media_kind=video${token ? `&token=${token}` : ''}`
}

export function getArtworkUrl(id: string | null | undefined): string | null {
  if (!id) return null
  return `${BASE}/artwork/${id}`
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> || {}),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${BASE}${path}`, { ...init, headers })

  if (res.status === 401) {
    // try refresh
    const refreshToken = localStorage.getItem('refresh_token')
    if (refreshToken) {
      const r = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      })
      if (r.ok) {
        const data = await r.json() as { access_token: string; refresh_token: string }
        setTokens(data.access_token, data.refresh_token)
        headers['Authorization'] = `Bearer ${data.access_token}`
        const retried = await fetch(`${BASE}${path}`, { ...init, headers })
        if (!retried.ok) throw new Error(await retried.text())
        if (retried.status === 204) return undefined as T
        return retried.json() as Promise<T>
      }
    }
    clearTokens()
    window.location.href = '/login'
    throw new Error('Unauthorized')
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }))
    throw new Error((err as { message: string }).message || res.statusText)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body !== undefined ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body !== undefined ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}
