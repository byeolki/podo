import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/auth'
import Layout from './components/Layout'
import Login from './pages/Login'
import Library from './pages/Library'
import Playlists from './pages/Playlists'
import PlaylistDetail from './pages/PlaylistDetail'
import Radio from './pages/Radio'
import Settings from './pages/Settings'
import History from './pages/History'
import Upload from './pages/Upload'
import Search from './pages/Search'
import Albums from './pages/Albums'
import AlbumDetail from './pages/AlbumDetail'

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
        <Route path="search" element={<Search />} />
        <Route path="albums" element={<Albums />} />
        <Route path="albums/:id" element={<AlbumDetail />} />
        <Route path="playlists" element={<Playlists />} />
        <Route path="playlists/:id" element={<PlaylistDetail />} />
        <Route path="radio" element={<Radio />} />
        <Route path="history" element={<History />} />
        <Route path="upload" element={<Upload />} />
        <Route path="settings" element={<Settings />} />
        <Route path="admin" element={<Navigate to="/settings" replace />} />
      </Route>
    </Routes>
  )
}
