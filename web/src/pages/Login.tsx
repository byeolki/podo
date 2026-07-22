import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { login, bootstrap } from '../api/auth'
import { useAuthStore } from '../store/auth'

export default function Login() {
  const navigate = useNavigate()
  const setFromToken = useAuthStore((s) => s.setFromToken)
  const isAuthed = useAuthStore((s) => s.userId !== null)
  const [mode, setMode] = useState<'login' | 'bootstrap'>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (isAuthed) navigate('/library', { replace: true })
  }, [isAuthed, navigate])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      let res
      if (mode === 'bootstrap') {
        res = await bootstrap(name, email, password)
      } else {
        res = await login(email, password)
      }
      setFromToken(res.access_token)
      navigate('/library', { replace: true })
    } catch (err) {
      const msg = (err as Error).message
      if (msg.includes('already has users')) {
        setMode('login')
        setError('Server is already set up. Please log in.')
      } else {
        setError(msg)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img src="/podo_lg.png" alt="Podo" className="w-20 h-20 object-contain mb-4 mx-auto" />
          <h1 className="text-2xl font-semibold">Podo</h1>
          <p className="text-sm text-ink-secondary mt-1">
            {mode === 'bootstrap' ? 'Create your admin account' : 'Sign in to your library'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-surface-2 rounded-2xl p-6 border border-border space-y-4">
          {mode === 'bootstrap' && (
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1.5">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full bg-surface-2 border border-border-strong rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-accent transition-colors"
                placeholder="Your name"
              />
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-ink-secondary mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full bg-surface-2 border border-border-strong rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-accent transition-colors"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-secondary mb-1.5">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="w-full bg-surface-2 border border-border-strong rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-accent transition-colors"
              placeholder="Min. 8 characters"
            />
          </div>

          {error && (
            <p className="text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-accent hover:bg-accent-hover text-black font-medium text-sm transition-colors disabled:opacity-50"
          >
            {loading ? 'Please wait...' : mode === 'bootstrap' ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <p className="text-center text-xs text-ink-tertiary mt-4">
          {mode === 'login' ? (
            <>
              First time?{' '}
              <button onClick={() => setMode('bootstrap')} className="text-accent hover:underline">
                Set up server
              </button>
            </>
          ) : (
            <>
              Already set up?{' '}
              <button onClick={() => setMode('login')} className="text-accent hover:underline">
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  )
}
