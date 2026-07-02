import { NavLink, useNavigate } from 'react-router-dom'
import {
  Music, ListMusic, Radio,
  History, Settings, LogOut, Upload,
} from 'lucide-react'
import { useAuthStore } from '../store/auth'
import { logout } from '../api/auth'

const navItems = [
  { to: '/library', icon: Music, label: 'Library' },
  { to: '/playlists', icon: ListMusic, label: 'Playlists' },
  { to: '/radio', icon: Radio, label: 'Radio' },
  { to: '/history', icon: History, label: 'History' },
  { to: '/upload', icon: Upload, label: 'Upload' },
]

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const role = useAuthStore((s) => s.role)
  const clear = useAuthStore((s) => s.clear)
  const navigate = useNavigate()

  async function handleLogout() {
    await logout()
    clear()
    navigate('/login')
  }

  return (
    <>
      <nav className="flex-1 px-3 space-y-0.5">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            onClick={onNavigate}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-accent/10 text-accent'
                  : 'text-[#a1a1a1] hover:text-white hover:bg-white/5'
              }`
            }
          >
            <Icon size={16} />
            {label}
          </NavLink>
        ))}

        {role === 'admin' && (
          <NavLink
            to="/admin"
            onClick={onNavigate}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-accent/10 text-accent'
                  : 'text-[#a1a1a1] hover:text-white hover:bg-white/5'
              }`
            }
          >
            <Settings size={16} />
            Admin
          </NavLink>
        )}
      </nav>

      <div className="p-3 border-t border-[#222]">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2 w-full rounded-lg text-sm text-[#a1a1a1] hover:text-white hover:bg-white/5 transition-colors"
        >
          <LogOut size={16} />
          Sign out
        </button>
      </div>
    </>
  )
}

export default function Sidebar() {
  return (
    <aside className="hidden md:flex w-56 flex-shrink-0 bg-[#111] border-r border-[#222] flex-col">
      <div className="px-5 py-6 flex items-center gap-2.5">
        <img src="/podo_lg.png" alt="Podo" className="w-7 h-7 object-contain" />
        <span className="text-lg font-semibold tracking-tight">Podo</span>
      </div>
      <SidebarContent />
    </aside>
  )
}
