import { useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { useAuthStore } from './store/auth'
import { isAuthenticated } from './api/auth'
import Layout from './components/Layout'
import Login from './pages/Login'
import Library from './pages/Library'
import Playlists from './pages/Playlists'
import PlaylistDetail from './pages/PlaylistDetail'
import Radio from './pages/Radio'
import Admin from './pages/Admin'
import History from './pages/History'
import Upload from './pages/Upload'

function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!isAuthenticated()) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  const setFromToken = useAuthStore((s) => s.setFromToken)

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (token) setFromToken(token)
  }, [setFromToken])

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
        <Route path="playlists" element={<Playlists />} />
        <Route path="playlists/:id" element={<PlaylistDetail />} />
        <Route path="radio" element={<Radio />} />
        <Route path="history" element={<History />} />
        <Route path="upload" element={<Upload />} />
        <Route path="admin" element={<Admin />} />
      </Route>
    </Routes>
  )
}
