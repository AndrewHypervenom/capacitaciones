import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft, Loader2, Award, CheckCircle2, BookOpen, GraduationCap,
  IdCard, Phone, MapPin, Briefcase, CalendarDays, BarChart3,
  Pencil, Save, X, Camera,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Avatar } from '@/components/ui/Avatar'
import { GlassCard } from '@/components/ui/GlassCard'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { updateProfile, uploadAvatar } from '@/services/auth.service'
import { getUserCoursesAdmin, type AdminUserCourse } from '@/services/courses.service'
import { toast } from '@/stores/toastStore'
import type { Profile } from '@/types/database'
import { cn } from '@/lib/cn'

const COUNTRY_LABEL: Record<string, string> = { CO: 'simulator.countries.CO', MX: 'simulator.countries.MX', AR: 'simulator.countries.AR' }

interface EditForm {
  display_name: string
  job_title: string
  national_id: string
  phone: string
  country: string
  bio: string
}
const emptyForm: EditForm = { display_name: '', job_title: '', national_id: '', phone: '', country: 'CO', bio: '' }
const MAX_AVATAR_BYTES = 3 * 1024 * 1024 // 3 MB

/**
 * Hoja de vida de una persona para el panel de gestión: datos personales +
 * cursos asignados con su desempeño, finalización y certificación.
 * Superadmin ve a cualquiera; capacitador solo a los de su campaña (RLS).
 */
export default function UserProfile() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()
  const { isSuperAdmin } = useAuth()

  const [profile, setProfile] = useState<Profile | null>(null)
  const [campaignName, setCampaignName] = useState<string | null>(null)
  const [email, setEmail] = useState<string | null>(null)
  const [courses, setCourses] = useState<AdminUserCourse[]>([])
  const [coursesDenied, setCoursesDenied] = useState(false)
  const [loading, setLoading] = useState(true)

  // Edición del perfil (solo superadmin). El servicio updateProfile ya recibe el
  // userId destino; la RLS profiles_update_superadmin autoriza filas ajenas.
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<EditForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const startEdit = () => {
    if (!profile) return
    setForm({
      display_name: profile.display_name ?? '',
      job_title: profile.job_title ?? '',
      national_id: profile.national_id ?? '',
      phone: profile.phone ?? '',
      country: profile.country ?? 'CO',
      bio: profile.bio ?? '',
    })
    setEditing(true)
  }

  const set = (k: keyof EditForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const handleSave = async () => {
    if (!profile) return
    setSaving(true)
    try {
      const updated = await updateProfile(profile.id, {
        display_name: form.display_name.trim() || null,
        job_title: form.job_title.trim() || null,
        national_id: form.national_id.trim() || null,
        phone: form.phone.trim() || null,
        country: form.country || null,
        bio: form.bio.trim() || null,
      })
      setProfile(updated as Profile)
      setEditing(false)
      toast.success(t('profile.saved', 'Perfil actualizado'))
    } catch (err) {
      toast.error(t('profile.save_error', 'No se pudo guardar'), (err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const handleAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !profile) return
    if (!file.type.startsWith('image/')) {
      toast.error(t('profile.avatar_invalid', 'Elige un archivo de imagen'))
      return
    }
    if (file.size > MAX_AVATAR_BYTES) {
      toast.error(t('profile.avatar_too_big', 'La imagen supera los 3 MB'))
      return
    }
    setUploading(true)
    try {
      const url = await uploadAvatar(profile.id, file)
      const updated = await updateProfile(profile.id, { avatar_url: url })
      setProfile(updated as Profile)
      toast.success(t('profile.avatar_saved', 'Foto actualizada'))
    } catch (err) {
      toast.error(t('profile.save_error', 'No se pudo guardar'), (err as Error).message)
    } finally {
      setUploading(false)
    }
  }

  useEffect(() => {
    let alive = true
    setLoading(true)
    ;(async () => {
      const { data: prof } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle()
      if (!alive) return
      setProfile(prof as Profile | null)

      if (prof?.campaign_id) {
        supabase.from('campaigns').select('name').eq('id', prof.campaign_id).maybeSingle()
          .then(({ data }) => alive && setCampaignName(data?.name ?? null))
      }
      // El correo no vive en profiles; lo mostramos si hay credencial temporal
      // pendiente (solo el superadmin recibe esas filas por RLS).
      supabase.from('user_temp_credentials').select('email').eq('user_id', id).maybeSingle()
        .then(({ data }) => alive && setEmail(data?.email ?? null))

      // Cursos + progreso vía RPC (superadmin). Si el rol no tiene permiso, se
      // degrada con un aviso en vez de romper la página.
      try {
        const cs = await getUserCoursesAdmin(id)
        if (alive) setCourses(cs)
      } catch {
        if (alive) setCoursesDenied(true)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [id])

  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(i18n.language, { day: '2-digit', month: 'short', year: 'numeric' }) : null

  const assigned = useMemo(() => courses.filter((c) => c.is_assigned), [courses])
  const stats = useMemo(() => {
    const completed = assigned.filter((c) => c.completed_at != null).length
    const certs = assigned.filter((c) => c.certified).length
    const scored = assigned.filter((c) => c.score != null)
    const avg = scored.length ? Math.round(scored.reduce((a, c) => a + (c.score ?? 0), 0) / scored.length) : null
    return { total: assigned.length, completed, certs, avg }
  }, [assigned])

  const roleLabel = profile
    ? t(`roles.${profile.role}`)
    : ''
  const roleColor: Record<Profile['role'], { bg: string; text: string }> = {
    superadmin: { bg: 'rgba(245,158,11,0.15)', text: '#d97706' },
    capacitador: { bg: 'rgba(139,92,246,0.15)', text: '#7c3aed' },
    learner: { bg: 'rgba(34,197,94,0.15)', text: '#16a34a' },
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-text-subtle" />
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="p-8">
        <button onClick={() => navigate('/admin/users')} className="mb-6 inline-flex items-center gap-1.5 text-[13px] text-text-muted hover:text-text">
          <ArrowLeft className="h-4 w-4" /> {t('admin.users.title')}
        </button>
        <p className="text-text-muted text-[14px]">{t('admin.users.no_results')}</p>
      </div>
    )
  }

  const dataRows: { id: string; icon: typeof IdCard; label: string; value: string | null }[] = [
    { id: 'job_title', icon: Briefcase, label: t('profile.job_title'), value: profile.job_title },
    { id: 'national_id', icon: IdCard, label: t('profile.national_id'), value: profile.national_id },
    { id: 'phone', icon: Phone, label: t('profile.phone'), value: profile.phone },
    { id: 'country', icon: MapPin, label: t('profile.country'), value: profile.country ? (COUNTRY_LABEL[profile.country] ? t(COUNTRY_LABEL[profile.country]) : profile.country) : null },
    { id: 'member_since', icon: CalendarDays, label: t('admin.users.member_since'), value: fmtDate(profile.created_at) },
  ]

  const editLabel = 'mb-1.5 block text-[12px] font-semibold uppercase tracking-wide text-text-subtle'

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-8">
      <button
        onClick={() => navigate('/admin/users')}
        className="mb-6 inline-flex items-center gap-1.5 text-[13px] text-text-muted transition-colors hover:text-text"
      >
        <ArrowLeft className="h-4 w-4" /> {t('admin.users.title')}
      </button>

      {/* Encabezado tipo hoja de vida */}
      <GlassCard intensity="subtle" rounded="2xl" padding="none" className="mb-6">
        <div className="flex flex-col items-center gap-5 p-6 text-center sm:flex-row sm:items-center sm:text-left sm:p-8">
          <div className="relative shrink-0">
            <Avatar src={profile.avatar_url} name={profile.display_name} size={88} />
            {isSuperAdmin && (
              <>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  aria-label={t('profile.change_photo', 'Cambiar foto')}
                  className="absolute -bottom-1 -right-1 flex h-10 w-10 items-center justify-center rounded-full border-2 border-surface bg-primary text-on-primary shadow-sm transition-transform hover:scale-105 disabled:opacity-60"
                >
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                </button>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatar} />
              </>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-[22px] font-extrabold tracking-tight text-text">
              {profile.display_name || t('profile.no_name')}
            </h1>
            {profile.job_title && (
              <p className="text-[14px] text-text-muted">{profile.job_title}</p>
            )}
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              <span
                className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                style={{ background: roleColor[profile.role].bg, color: roleColor[profile.role].text }}
              >
                {roleLabel}
              </span>
              {campaignName && (
                <span className="rounded-full bg-subtle px-2.5 py-0.5 text-[11px] text-text-muted">
                  {campaignName}
                </span>
              )}
              {email && <span className="text-[12px] text-text-subtle">{email}</span>}
            </div>
          </div>
          {isSuperAdmin && !editing && (
            <Button variant="secondary" size="sm" onClick={startEdit} className="shrink-0 self-start">
              <Pencil className="h-3.5 w-3.5" />
              {t('admin.users.edit_profile', 'Editar perfil')}
            </Button>
          )}
        </div>
      </GlassCard>

      {/* Tiles de resumen */}
      {!coursesDenied && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { id: 'total', icon: BookOpen, label: t('admin.users.assigned_courses'), value: stats.total },
            { id: 'completed', icon: CheckCircle2, label: t('admin.users.courses_completed'), value: stats.completed },
            { id: 'certs', icon: Award, label: t('admin.users.certifications'), value: stats.certs },
            { id: 'avg', icon: BarChart3, label: t('admin.users.avg_score'), value: stats.avg != null ? `${stats.avg}%` : '—' },
          ].map(({ id, icon: Icon, label, value }) => (
            <div key={id} className="rounded-2xl border border-line bg-surface p-4">
              <Icon className="mb-2 h-4 w-4 text-text-muted" />
              <div className="text-[22px] font-bold tabular-nums text-text">{value}</div>
              <div className="text-[11px] text-text-muted">{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Datos personales */}
      <div className="mb-6 rounded-2xl border border-line bg-surface p-6">
        <h2 className="mb-4 text-[15px] font-semibold text-text">{t('profile.personal_info')}</h2>

        {editing ? (
          <>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className={editLabel}>{t('profile.full_name', 'Nombre completo')}</label>
                <Input value={form.display_name} onChange={set('display_name')} placeholder={t('profile.full_name', 'Nombre completo')} />
              </div>
              <div>
                <label className={editLabel}>{t('profile.job_title', 'Cargo')}</label>
                <Input value={form.job_title} onChange={set('job_title')} placeholder={t('profile.job_title_ph', 'Ej. Asesor comercial')} />
              </div>
              <div>
                <label className={editLabel}>{t('profile.national_id', 'Cédula / Documento')}</label>
                <Input value={form.national_id} onChange={set('national_id')} inputMode="numeric" placeholder="123456789" />
              </div>
              <div>
                <label className={editLabel}>{t('profile.phone', 'Teléfono')}</label>
                <Input value={form.phone} onChange={set('phone')} inputMode="tel" placeholder="+57 300 000 0000" />
              </div>
              <div>
                <label className={editLabel}>{t('profile.country', 'País')}</label>
                <Select
                  value={form.country}
                  onChange={(v) => setForm((f) => ({ ...f, country: v }))}
                  className="[&>button]:h-12 [&>button]:rounded-2xl [&>button]:px-4 [&>button]:text-[15px]"
                  options={[
                    { value: 'CO', label: t('simulator.countries.CO') },
                    { value: 'MX', label: t('simulator.countries.MX') },
                    { value: 'AR', label: t('simulator.countries.AR') },
                  ]}
                />
              </div>
              <div className="sm:col-span-2">
                <label className={editLabel}>{t('profile.bio', 'Acerca de mí')}</label>
                <textarea
                  value={form.bio}
                  onChange={set('bio')}
                  rows={3}
                  placeholder={t('profile.bio_ph', 'Cuéntanos algo sobre ti (opcional)')}
                  className="w-full resize-none rounded-2xl border border-line bg-surface px-4 py-3 text-[15px] text-text outline-none transition-colors placeholder:text-text-subtle/70 focus:border-brand-green"
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={saving}>
                <X className="h-4 w-4" /> {t('confirm.cancel', 'Cancelar')}
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {t('profile.save', 'Guardar cambios')}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
              {dataRows.map(({ id, icon: Icon, label, value }) => (
                <div key={id} className="flex items-start gap-3">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-text-subtle" />
                  <div className="min-w-0">
                    <div className="text-[11px] uppercase tracking-wide text-text-subtle">{label}</div>
                    <div className="text-[14px] text-text">{value || <span className="text-text-subtle">—</span>}</div>
                  </div>
                </div>
              ))}
            </div>
            {profile.bio && (
              <div className="mt-5 border-t border-line pt-4">
                <div className="mb-1 text-[11px] uppercase tracking-wide text-text-subtle">{t('profile.bio')}</div>
                <p className="text-[14px] leading-relaxed text-text-muted">{profile.bio}</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Cursos y progreso */}
      <div className="rounded-2xl border border-line bg-surface p-6">
        <h2 className="mb-4 flex items-center gap-2 text-[15px] font-semibold text-text">
          <GraduationCap className="h-4 w-4 text-text-muted" />
          {t('admin.users.courses_progress')}
        </h2>

        {coursesDenied ? (
          <p className="py-6 text-center text-[13px] text-text-muted">
            {t('admin.users.courses_only_superadmin')}
          </p>
        ) : assigned.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-text-muted">
            {t('admin.users.no_courses_assigned')}
          </p>
        ) : (
          <div className="space-y-2">
            {assigned.map((c) => {
              const completed = fmtDate(c.completed_at)
              // Un curso certificado está, por definición, completado: el certificado
              // manda sobre la ausencia de progreso en user_progress (que puede quedar
              // desincronizado). Evita el estado contradictorio "Certificado" + "Pendiente".
              const isDone = c.certified || !!completed
              return (
                <div key={c.course_id} className="flex items-center gap-3 rounded-xl border border-line px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-medium text-text truncate">{c.title_es}</span>
                      <span className="shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-[rgba(34,197,94,0.15)] text-[#16a34a]">
                        {c.is_mandatory ? t('admin.users.mandatory_badge') : t('admin.users.assigned_badge')}
                      </span>
                      {c.certified && (
                        <span className="shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-[rgba(245,158,11,0.15)] text-[#d97706]">
                          <Award className="h-3 w-3" /> {t('admin.users.certified_badge')}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-text-muted">
                      {c.score != null ? (
                        <span className="inline-flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3 text-green-500" />
                          {t('admin.users.col_score')}: <b className="text-text">{c.score}%</b>
                        </span>
                      ) : !c.certified ? (
                        <span>{t('admin.users.no_activity')}</span>
                      ) : null}
                      <span>{t('courses.modules_count', { n: c.total_modules })}</span>
                      {completed && <span>{t('admin.users.col_completed')}: {completed}</span>}
                    </div>
                  </div>
                  <div className={cn(
                    'shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-semibold',
                    isDone ? 'bg-[rgba(34,197,94,0.15)] text-[#16a34a]' : 'bg-subtle text-text-muted',
                  )}>
                    {isDone ? t('admin.users.status_done') : t('admin.users.status_pending')}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
