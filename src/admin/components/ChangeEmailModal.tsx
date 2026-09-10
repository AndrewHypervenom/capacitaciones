import { useState } from 'react'
import { AtSign, ArrowRight, Check, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Modal } from '@/components/ui/Modal'
import { cn } from '@/lib/cn'
import { toast } from '@/stores/toastStore'
import { checkEmailAvailable, updateUserEmail, type ExistingAccount } from '@/services/userEmail.service'
import type { Profile } from '@/types/database'

interface Props {
  user: Profile
  /** El correo que hoy se ve en la fila (perfil o credencial temporal). */
  currentEmail: string | null
  /** El superadmin se está cambiando el suyo: al guardar entrará con el nuevo. */
  isSelf: boolean
  onClose: () => void
  onSaved: (email: string) => void
  /** Traduce el `existing` que devuelve el servidor a una frase entendible. */
  describeTaken: (existing?: ExistingAccount) => string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Los rechazos del servidor que el panel sabe decir en cristiano. */
const ERROR_KEYS: Record<string, string> = {
  invalid_email: 'admin.users.edit_email_invalid',
  same_email: 'admin.users.edit_email_same',
  user_not_found: 'admin.users.edit_email_not_found',
  target_is_superadmin: 'admin.users.edit_email_superadmin',
}

/**
 * Cambia el correo con el que alguien inicia sesión. Solo superadmin.
 *
 * Antes esto se hacía en el panel de Supabase, y ahí el cambio deja el correo
 * anterior colgando de la identidad: nunca vuelve a quedar libre y dar de alta
 * esa dirección falla para siempre. La Edge Function lo cambia en los dos
 * sitios a la vez, así que el viejo queda liberado de verdad.
 *
 * La contraseña NO se toca: la persona entra igual que antes, solo que con la
 * dirección nueva.
 */
export function ChangeEmailModal({ user, currentEmail, isSelf, onClose, onSaved, describeTaken }: Props) {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [check, setCheck] = useState<
    { state: 'checking' } | { state: 'free' } | { state: 'taken'; message: string } | null
  >(null)

  const value = email.trim().toLowerCase()
  const malformed = value.length > 0 && !EMAIL_RE.test(value)
  const unchanged = value.length > 0 && value === (currentEmail ?? '').toLowerCase()
  const canSave =
    !saving && EMAIL_RE.test(value) && !unchanged && check?.state !== 'taken' && check?.state !== 'checking'

  /**
   * Pregunta al servidor si esa dirección está libre. Se hace al salir del
   * campo, no en cada tecla: por dentro es un barrido sobre `auth.users`.
   */
  const runCheck = async () => {
    if (!EMAIL_RE.test(value) || unchanged) {
      setCheck(null)
      return
    }
    setCheck({ state: 'checking' })
    try {
      const { available, existing } = await checkEmailAvailable(value)
      // Un servidor sin soporte de comprobación no bloquea nada: al guardar se
      // vuelve a decidir, y ahí sí es la palabra final.
      if (available === null) {
        setCheck(null)
        return
      }
      setCheck(available ? { state: 'free' } : { state: 'taken', message: describeTaken(existing) })
    } catch {
      setCheck(null)
    }
  }

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const saved = await updateUserEmail(user.id, value)
      onSaved(saved)
      toast.success(
        t('admin.users.email_changed', { name: user.display_name ?? saved }),
        isSelf ? t('admin.users.email_changed_self') : t('admin.users.email_changed_hint'),
      )
      onClose()
    } catch (err) {
      const e = err as Error & { existing?: ExistingAccount; code?: string }
      if (e.code === 'email_exists') setError(describeTaken(e.existing))
      else if (e.code && ERROR_KEYS[e.code]) setError(t(ERROR_KEYS[e.code]))
      else setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      onClose={onClose}
      title={t('admin.users.edit_email')}
      subtitle={user.display_name ?? currentEmail ?? user.id.slice(0, 8)}
      icon={<AtSign className="h-4 w-4" />}
      accent="violet"
      size="md"
      dismissible={!saving}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg px-3 py-2 text-[13px] font-medium text-text-muted transition-colors hover:bg-glass/10 hover:text-text disabled:opacity-40"
          >
            {t('common.cancel', 'Cancelar')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="inline-flex items-center gap-2 rounded-lg bg-primary/12 px-3.5 py-2 text-[13px] font-semibold text-primary transition-colors hover:bg-primary/18 disabled:opacity-40"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t('admin.users.edit_email_save')}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2 rounded-xl bg-subtle px-3 py-2.5">
          <span className="shrink-0 text-[10px] uppercase tracking-wider text-text-muted">
            {t('admin.users.edit_email_current')}
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-text">
            {currentEmail ?? t('admin.users.email_unknown')}
          </span>
          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-text-subtle" />
        </div>

        <div>
          <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-text-muted">
            {t('admin.users.edit_email_new')}
          </label>
          <input
            type="email"
            autoFocus
            value={email}
            onChange={(e) => { setEmail(e.target.value); setError(null); setCheck(null) }}
            onBlur={runCheck}
            placeholder={t('admin.users.ph_email')}
            className={cn(
              'w-full min-h-[44px] rounded-xl border bg-subtle px-4 py-2.5 text-[14px] text-text outline-none',
              malformed || check?.state === 'taken' || error ? 'border-red-500/60' : 'border-line',
            )}
          />
          {malformed && (
            <p className="mt-1.5 text-[11.5px] text-red-500">{t('admin.users.edit_email_invalid')}</p>
          )}
          {unchanged && (
            <p className="mt-1.5 text-[11.5px] text-text-muted">{t('admin.users.edit_email_same')}</p>
          )}
          {check?.state === 'checking' && (
            <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-text-muted">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t('admin.users.email_checking')}
            </p>
          )}
          {check?.state === 'free' && (
            <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px]" style={{ color: '#16a34a' }}>
              <Check className="h-3 w-3" />
              {t('admin.users.email_free')}
            </p>
          )}
          {check?.state === 'taken' && (
            <p className="mt-1.5 text-[11.5px] text-red-500">{check.message}</p>
          )}
          {error && <p className="mt-1.5 text-[11.5px] text-red-500">{error}</p>}
        </div>

        {/* Lo que hay que saber ANTES de guardar: qué cambia y qué no. */}
        <p className="text-[12px] leading-relaxed text-text-muted">
          {t('admin.users.edit_email_note')}
        </p>
        {isSelf && (
          <p className="text-[12px] leading-relaxed text-amber-500">
            {t('admin.users.edit_email_self')}
          </p>
        )}
      </div>
    </Modal>
  )
}
