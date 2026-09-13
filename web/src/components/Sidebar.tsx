import { NavLink, useNavigate } from 'react-router-dom'
import {
  Music, ListMusic, Radio, Search, Disc3,
  History, Settings, LogOut, Upload,
} from 'lucide-react'
import { useAuthStore } from '../store/auth'
import { logout } from '../api/auth'

const navItems = [
  { to: '/library', icon: Music, label: 'Library' },
  { to: '/search', icon: Search, label: 'Search' },
  { to: '/albums', icon: Disc3, label: 'Albums' },
  { to: '/playlists', icon: ListMusic, label: 'Playlists' },
  { to: '/radio', icon: Radio, label: 'Radio' },
  { to: '/history', icon: History, label: 'History' },
  { to: '/upload', icon: Upload, label: 'Upload' },
  { to: '/settings', icon: Settings, label: 'Settings' },
]

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const clear = useAuthStore((s) => s.clear)
  const navigate = useNavigate()

  async function handleLogout() {
    await logout()
    clear()
    navigate('/login')
  }

  return (
    <>
      <nav aria-label="Main" className="flex-1 px-3 space-y-0.5">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            onClick={onNavigate}
            className={({ isActive }) =>
              `relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-150 ${
                isActive
                  ? 'bg-accent/10 text-accent-text before:absolute before:left-0 before:top-1/2 before:h-4 before:w-[3px] before:-translate-y-1/2 before:rounded-r-full before:bg-accent'
                  : 'text-ink-secondary hover:text-ink-primary hover:bg-white/[0.06]'
              }`
            }
          >
            <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="p-3 border-t border-border">
        <button
          type="button"
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2 w-full rounded-lg text-sm text-ink-secondary hover:text-ink-primary hover:bg-white/[0.06] transition-colors duration-150"
        >
          <LogOut size={16} strokeWidth={1.5} aria-hidden="true" />
          Sign out
        </button>
      </div>
    </>
  )
}

export default function Sidebar() {
  return (
    <aside className="hidden md:flex w-56 flex-shrink-0 bg-surface-1 border-r border-border flex-col">
      <div className="px-5 py-6 flex items-center gap-2.5">
        <img src="/podo_lg.png" alt="Podo" className="w-7 h-7 object-contain" />
        <span className="text-lg font-semibold tracking-tight">Podo</span>
      </div>
      <SidebarContent />
    </aside>
  )
}
