import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Eye, EyeOff, KeyRound } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'

export function Onboarding() {
  const { t } = useTranslation()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const profile = useAuthStore((s) => s.profile)
  const setProfile = useAuthStore((s) => s.setProfile)

  const isValid = password.length >= 8 && password === confirm

  const handleSubmit = async () => {
    if (!isValid || !profile) return
    setLoading(true)
    setError(null)

    try {
      // Cambiar la contraseña PRIMERO. Solo si esto tiene éxito marcamos
      // onboarded=true y redirigimos. De lo contrario la cuenta se quedaría
      // con la contraseña temporal pero el usuario creería que ya la cambió,
      // y al volver a entrar con la "nueva" obtendría un error.
      const { error: authError } = await supabase.auth.updateUser({ password })
      if (authError) throw authError

      const { error: dbError } = await supabase
        .from('profiles')
        .update({ onboarded: true })
        .eq('id', profile.id)
      if (dbError) throw dbError

      setProfile({ ...profile, onboarded: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('onboarding.error_generic'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg">
      <div className="w-full max-w-sm mx-4 rounded-3xl p-8 bg-surface border border-line shadow-2xl">
        <div className="flex items-center justify-center w-12 h-12 rounded-2xl mb-6 mx-auto"
          style={{ background: 'rgba(0,194,40,0.12)', border: '1px solid rgba(0,194,40,0.2)' }}
        >
          <KeyRound className="h-5 w-5 text-green-500" />
        </div>

        <h1 className="text-[20px] font-bold text-text text-center mb-1">{t('onboarding.title')}</h1>
        <p className="text-[13px] text-text-muted text-center mb-8">
          {t('onboarding.subtitle')}
        </p>

        <div className="space-y-3">
          <div className="relative">
            <input
              type={showPass ? 'text' : 'password'}
              placeholder={t('onboarding.new_password')}
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(null) }}
              className="w-full rounded-xl px-4 py-3 text-[14px] text-text bg-subtle border border-line outline-none pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPass((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-subtle hover:text-text-muted"
            >
              {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          <input
            type={showPass ? 'text' : 'password'}
            placeholder={t('onboarding.confirm_password')}
            value={confirm}
            onChange={(e) => { setConfirm(e.target.value); setError(null) }}
            className="w-full rounded-xl px-4 py-3 text-[14px] text-text bg-subtle border border-line outline-none"
          />

          {password.length > 0 && password.length < 8 && (
            <p className="text-[12px] text-amber-500">{t('onboarding.min_chars')}</p>
          )}
          {confirm.length > 0 && password !== confirm && (
            <p className="text-[12px] text-red-500">{t('onboarding.mismatch')}</p>
          )}
          {error && <p className="text-[12px] text-red-500">{error}</p>}

          <button
            onClick={handleSubmit}
            disabled={!isValid || loading}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[14px] font-semibold text-black disabled:opacity-40 transition-opacity mt-2"
            style={{ background: '#00C228' }}
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('onboarding.submit')}
          </button>
        </div>
      </div>
    </div>
  )
}
