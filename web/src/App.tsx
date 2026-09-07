import { Suspense, lazy } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/auth'
import Layout from './components/Layout'
import Login from './pages/Login'
import Library from './pages/Library'

// Split per route: Settings alone pulls in the whole admin surface, and Upload
// pulls the download UI, neither of which most sessions ever open. Library and
// Login stay in the main chunk because one of them is always the first paint.
const Playlists = lazy(() => import('./pages/Playlists'))
const PlaylistDetail = lazy(() => import('./pages/PlaylistDetail'))
const Radio = lazy(() => import('./pages/Radio'))
const Settings = lazy(() => import('./pages/Settings'))
const History = lazy(() => import('./pages/History'))
const Upload = lazy(() => import('./pages/Upload'))
const Search = lazy(() => import('./pages/Search'))
const Albums = lazy(() => import('./pages/Albums'))
const AlbumDetail = lazy(() => import('./pages/AlbumDetail'))

function RouteFallback() {
  return (
    <div className="p-4 sm:p-6 space-y-1" aria-busy="true" aria-label="Loading page">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="h-12 rounded-lg bg-surface-2 animate-pulse" />
      ))}
    </div>
  )
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const isAuthed = useAuthStore((s) => s.userId !== null)
  if (!isAuthed) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/library" replace />} />
        <Route path="library" element={<Library />} />
        <Route path="search" element={<Suspense fallback={<RouteFallback />}><Search /></Suspense>} />
        <Route path="albums" element={<Suspense fallback={<RouteFallback />}><Albums /></Suspense>} />
        <Route path="albums/:id" element={<Suspense fallback={<RouteFallback />}><AlbumDetail /></Suspense>} />
        <Route path="playlists" element={<Suspense fallback={<RouteFallback />}><Playlists /></Suspense>} />
        <Route path="playlists/:id" element={<Suspense fallback={<RouteFallback />}><PlaylistDetail /></Suspense>} />
        <Route path="radio" element={<Suspense fallback={<RouteFallback />}><Radio /></Suspense>} />
        <Route path="history" element={<Suspense fallback={<RouteFallback />}><History /></Suspense>} />
        <Route path="upload" element={<Suspense fallback={<RouteFallback />}><Upload /></Suspense>} />
        <Route path="settings" element={<Suspense fallback={<RouteFallback />}><Settings /></Suspense>} />
        <Route path="admin" element={<Navigate to="/settings" replace />} />
      </Route>
    </Routes>
  )
}
