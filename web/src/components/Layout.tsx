import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import Player from './Player'

export default function Layout() {
  return (
    <div className="flex h-screen bg-[#0f0f0f] overflow-hidden">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0">
        <main className="flex-1 overflow-y-auto pb-24">
          <Outlet />
        </main>
        <Player />
      </div>
    </div>
  )
}
