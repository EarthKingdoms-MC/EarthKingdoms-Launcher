import { useState, useRef, useEffect, FormEvent } from 'react'
import { Account } from '../hooks/useSkin'
import './LoginPage.css'

interface Props {
  onLogin: (account: Account) => void
}

export default function LoginPage({ onLogin }: Props) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const [rateLimit, setRateLimit] = useState(0) // secondes restantes
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Nettoyage interval à la destruction (ex: navigation)
  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current) }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (loading || rateLimit > 0) return
    if (!username.trim() || !password) {
      setError('Remplis tous les champs.')
      return
    }

    setLoading(true)
    setError('')

    const result = await window.api.authLogin(username.trim(), password)
    setLoading(false)

    if (result.ok) {
      onLogin(result.account)
      return
    }

    // Rate limiting → compte à rebours
    if (result.code === 429) {
      setRateLimit(120)
      if (timerRef.current) clearInterval(timerRef.current)
      timerRef.current = setInterval(() => {
        setRateLimit(v => {
          if (v <= 1) { clearInterval(timerRef.current!); return 0 }
          return v - 1
        })
      }, 1000)
    }

    setError(result.message)
  }

  return (
    <div className="login">
      <div className="login__bg" />
      <div className="login__card">
        <img src="./logo32.png" alt="EarthKingdoms" className="login__logo" />
        <h1 className="login__title">EARTH<span>KINGDOMS</span></h1>
        <p className="login__subtitle">Connexion à votre compte</p>

        <form className="login__form" onSubmit={handleSubmit}>
          <div className="login__field">
            <label className="login__label">Pseudo ou email</label>
            <input
              className="login__input"
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoComplete="username"
              disabled={loading}
              placeholder="ex: RinKaoru"
            />
          </div>

          <div className="login__field">
            <label className="login__label">Mot de passe</label>
            <input
              className="login__input"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
              disabled={loading}
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="login__error">
              {error}
              {rateLimit > 0 && <span className="login__countdown"> ({rateLimit}s)</span>}
            </div>
          )}

          <button
            type="submit"
            className="btn-play login__btn-play"
            disabled={loading || rateLimit > 0}
          >
            {loading ? 'Connexion…' : rateLimit > 0 ? `Patienter (${rateLimit}s)` : 'SE CONNECTER'}
          </button>
        </form>

        <a
          className="login__register"
          onClick={() => window.api.openExternal('https://earthkingdoms-mc.fr/auth.php')}
        >
          Pas encore de compte ? Créer un compte
        </a>
      </div>
    </div>
  )
}
