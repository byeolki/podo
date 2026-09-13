import { useState, useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import Sidebar, { SidebarContent } from './Sidebar'
import Player from './Player'
import AssistantPanel from './AssistantPanel'

export default function Layout() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()

  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  return (
    <div className="flex h-screen bg-canvas overflow-hidden">
      {/* First focusable thing on every page: the nav is eight links deep and a
          keyboard user otherwise walked all of them again on every route. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:z-[70] focus:top-3 focus:left-3
                   focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:text-white"
      >
        Skip to content
      </a>
      <Sidebar />

      {drawerOpen && (
        <div className="fixed inset-0 z-[60] md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDrawerOpen(false)} />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="absolute left-0 top-0 bottom-0 w-64 bg-surface-1 border-r border-border flex flex-col"
          >
            <div className="px-5 py-5 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <img src="/podo_lg.png" alt="Podo" className="w-7 h-7 object-contain" />
                <span className="text-lg font-semibold tracking-tight">Podo</span>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close the menu"
                className="p-2 -mr-1 text-ink-secondary hover:text-white"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <SidebarContent onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex flex-col flex-1 min-w-0">
        <header className="md:hidden flex items-center gap-3 px-4 h-14 bg-surface-1 border-b border-border flex-shrink-0">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open the menu"
            aria-expanded={drawerOpen}
            className="p-2 -ml-1 text-ink-secondary hover:text-white"
          >
            <Menu size={20} aria-hidden="true" />
          </button>
          <div className="flex items-center gap-2">
            <img src="/podo_lg.png" alt="Podo" className="w-6 h-6 object-contain" />
            <span className="text-base font-semibold tracking-tight">Podo</span>
          </div>
        </header>

        {/* Every page is padded but unconstrained, so on a very wide display the
            content ran the full width: track rows stretched until the title and
            the duration sat at opposite ends of the screen with nothing between
            them, and the narrower panels left all their empty space piled on the
            right. Capping and centring here fixes every page at once, and changes
            nothing below the cap. 1280 rather than something wider because the
            row is the unit that has to stay readable, and a row wider than this
            is mostly the gap in its middle. */}
        <main id="main" tabIndex={-1} className="flex-1 overflow-y-auto pb-28">
          <div className="mx-auto w-full max-w-[1280px]">
            <Outlet />
          </div>
        </main>
        <Player />
      </div>

      {/* Rendered here rather than on a page so the conversation survives
          navigation — it sends you to playlists, which would otherwise reset it. */}
      <AssistantPanel />
    </div>
  )
}
