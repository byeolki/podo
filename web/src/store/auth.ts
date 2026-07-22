import { create } from 'zustand'

interface AuthState {
  role: string | null
  userId: string | null
  setFromToken: (token: string) => void
  clear: () => void
}

function parseToken(token: string): { role: string; sub: string } | null {
  try {
    return JSON.parse(atob(token.split('.')[1]))
  } catch {
    return null
  }
}

const initialToken = typeof localStorage !== 'undefined' ? localStorage.getItem('access_token') : null
const initialPayload = initialToken ? parseToken(initialToken) : null

export const useAuthStore = create<AuthState>((set) => ({
  role: initialPayload?.role ?? null,
  userId: initialPayload?.sub ?? null,
  setFromToken: (token) => {
    const p = parseToken(token)
    if (p) set({ role: p.role, userId: p.sub })
  },
  clear: () => set({ role: null, userId: null }),
}))
