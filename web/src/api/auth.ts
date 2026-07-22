import { api, setTokens, clearTokens } from './client'

interface AuthResponse {
  access_token: string
  refresh_token: string
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const res = await api.post<AuthResponse>('/auth/login', { email, password })
  setTokens(res.access_token, res.refresh_token)
  return res
}

export async function bootstrap(name: string, email: string, password: string): Promise<AuthResponse> {
  const res = await api.post<AuthResponse>('/auth/bootstrap', { name, email, password })
  setTokens(res.access_token, res.refresh_token)
  return res
}

export async function register(name: string, email: string, password: string, invite_token: string): Promise<AuthResponse> {
  const res = await api.post<AuthResponse>('/auth/register', { name, email, password, invite_token })
  setTokens(res.access_token, res.refresh_token)
  return res
}

export async function logout(): Promise<void> {
  const refresh = localStorage.getItem('refresh_token')
  if (refresh) {
    await api.post('/auth/logout', { refresh_token: refresh }).catch(() => {})
  }
  clearTokens()
}

export function createInvite(): Promise<{ invite_token: string }> {
  return api.post('/auth/invite')
}

export interface Me {
  id: string
  name: string
  email: string
  role: string
  created_at: string
}

export function getMe(): Promise<Me> {
  return api.get('/auth/me')
}

export interface UpdateMeInput {
  name?: string
  current_password?: string
  new_password?: string
}

export function updateMe(data: UpdateMeInput): Promise<Me> {
  return api.patch('/auth/me', data)
}
