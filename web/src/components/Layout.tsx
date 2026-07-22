import { useState, useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import Sidebar, { SidebarContent } from './Sidebar'
import Player from './Player'

export default function Layout() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()

  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  return (
    <div className="flex h-screen bg-canvas overflow-hidden">
      <Sidebar />

      {drawerOpen && (
        <div className="fixed inset-0 z-[60] md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-64 bg-surface-1 border-r border-border flex flex-col">
            <div className="px-5 py-5 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <img src="/podo_lg.png" alt="Podo" className="w-7 h-7 object-contain" />
                <span className="text-lg font-semibold tracking-tight">Podo</span>
              </div>
              <button onClick={() => setDrawerOpen(false)} className="p-1 text-ink-secondary hover:text-white">
                <X size={18} />
              </button>
            </div>
            <SidebarContent onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex flex-col flex-1 min-w-0">
        <header className="md:hidden flex items-center gap-3 px-4 h-14 bg-surface-1 border-b border-border flex-shrink-0">
          <button onClick={() => setDrawerOpen(true)} className="p-1 -ml-1 text-ink-secondary hover:text-white">
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2">
            <img src="/podo_lg.png" alt="Podo" className="w-6 h-6 object-contain" />
            <span className="text-base font-semibold tracking-tight">Podo</span>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto pb-24">
          <Outlet />
        </main>
        <Player />
      </div>
    </div>
  )
}
