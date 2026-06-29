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

export const useAuthStore = create<AuthState>((set) => ({
  role: null,
  userId: null,
  setFromToken: (token) => {
    const p = parseToken(token)
    if (p) set({ role: p.role, userId: p.sub })
  },
  clear: () => set({ role: null, userId: null }),
}))
