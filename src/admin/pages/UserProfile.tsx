import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import {
  ArrowLeft, Loader2, Award, CheckCircle2, BookOpen, GraduationCap,
  IdCard, Phone, MapPin, Briefcase, CalendarDays, BarChart3,
  Pencil, Save, X, Trophy, User as UserIcon,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { greetingFor, visitNote } from '@/lib/greeting'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { RichText } from '@/components/ui/RichText'
import { RichTextArea } from '@/components/ui/RichTextArea'
import { ProfileHero, type HeroStat } from '@/components/profile/ProfileHero'
import { ProfileTabs, type ProfileTab } from '@/components/profile/ProfileTabs'
import { CertificateWall } from '@/components/profile/CertificateWall'
import { AchievementsPanel } from '@/components/profile/AchievementsPanel'
import { PasskeyManager } from '@/components/profile/PasskeyManager'
import { updateProfile, uploadAvatar } from '@/services/auth.service'
import { getUserCoursesAdmin, type AdminUserCourse } from '@/services/courses.service'
import { getUserCertificates, type UserCertificate } from '@/services/certification.service'
import { getUserGamification, type GamificationSummary } from '@/services/progress.service'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { toast } from '@/stores/toastStore'
import type { Profile } from '@/types/database'
import type { Lang } from '@/stores/gamificationStore'
import { cn } from '@/lib/cn'

import { COUNTRY_OPTIONS, countryLabelWithFlag } from '@/lib/countries'
import { rowText } from '@/lib/contentLang'

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

type TabId = 'trayectoria' | 'certificados' | 'cursos' | 'datos'

/**
 * Reintento corto para las lecturas de esta hoja de vida.
 *
 * Por qué existe: la lectura del perfil no distinguía "esta persona no existe"
 * de "la petición falló". Un 500 del gateway (la firma clásica es el 57014,
 * `canceling statement due to statement timeout`) o un 401 justo mientras
 * supabase-js renueva el token dejaba `data` en null y la pantalla pintaba el
 * vacío de "sin resultados" —el capacitador entraba a su propio perfil, lo veía
 * en blanco, y al volver a entrar salía completo—. Un fallo así es pasajero:
 * se reintenta un par de veces y, si insiste, se dice que NO se pudo cargar
 * (con botón para reintentar), que no es lo mismo que decir que no hay nadie.
 */
async function withRetry<T>(fn: () => Promise<T>, tries = 3, waitMs = 400): Promise<T> {
  let last: unknown
  for (let i = 0; i < tries; i++) {
    try {
      return await fn()
    } catch (err) {
      last = err
      if (i < tries - 1) await new Promise((r) => setTimeout(r, waitMs * (i + 1)))
    }
  }
  throw last
}

/**
 * Hoja de vida de una persona para el panel de gestión: encabezado con sus
 * cifras, trayectoria (XP, racha, insignias), vitrina de certificados —que se
 * pueden ver aquí mismo— cursos con desempeño y datos personales editables.
 * Comparte componentes con /profile para que consultar y editar se vean igual.
 * Superadmin ve a cualquiera; capacitador solo a los de su campaña (RLS).
 */
export default function UserProfile() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()
  const { isSuperAdmin, displayName } = useAuth()
  const reduce = useReducedMotion()

  const lang = (i18n.resolvedLanguage ?? 'es') as Lang

  const [profile, setProfile] = useState<Profile | null>(null)
  const [campaignName, setCampaignName] = useState<string | null>(null)
  const [email, setEmail] = useState<string | null>(null)
  const [courses, setCourses] = useState<AdminUserCourse[]>([])
  const [coursesDenied, setCoursesDenied] = useState(false)
  const [certs, setCerts] = useState<UserCertificate[]>([])
  const [game, setGame] = useState<GamificationSummary | null>(null)
  const [loading, setLoading] = useState(true)
  // La lectura falló (red/gateway/token), que no es lo mismo que "no existe".
  const [loadFailed, setLoadFailed] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [tab, setTab] = useState<TabId>('trayectoria')

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
    setTab('datos')
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
        bio: form.bio.trim() ? form.bio : null, // preserva saltos/espacio del editor enriquecido
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

  // Un solo camino para la foto, venga del selector o de soltarla encima.
  const uploadPhoto = async (file: File) => {
    if (!profile) return
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
    setLoadFailed(false)
    ;(async () => {
      let prof: Profile | null = null
      try {
        prof = await withRetry(async () => {
          const { data, error } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle()
          if (error) throw error
          return data as Profile | null
        })
      } catch {
        // Ni siquiera con reintentos: se avisa, en vez de fingir que no existe.
        if (alive) {
          setLoadFailed(true)
          setLoading(false)
        }
        return
      }
      if (!alive) return
      setProfile(prof)

      if (prof?.campaign_id) {
        supabase.from('campaigns').select('name').eq('id', prof.campaign_id).maybeSingle()
          .then(({ data }) => alive && setCampaignName(data?.name ?? null))
      }
      // El correo sale de `profiles.email`, que un trigger mantiene al día con
      // auth.users. Antes se leía de `user_temp_credentials`, que solo existe
      // mientras la persona no haya entrado: a quien ya usaba la plataforma se le
      // veía el UUID en lugar del correo.
      supabase.from('profiles').select('email').eq('id', id).maybeSingle()
        .then(({ data }) => alive && setEmail(data?.email ?? null))

      // Certificados y gamificación: ambos degradan solos si la RLS no autoriza
      // (devuelven [] / null), así que nunca tumban la hoja de vida.
      getUserCertificates(id).then((rows) => alive && setCerts(rows)).catch(() => {})
      getUserGamification(id).then((g) => alive && setGame(g)).catch(() => {})

      // Cursos + progreso vía RPC (superadmin). Si el rol no tiene permiso, se
      // degrada con un aviso en vez de romper la página.
      try {
        const cs = await withRetry(() => getUserCoursesAdmin(id))
        if (alive) setCourses(cs)
      } catch {
        if (alive) setCoursesDenied(true)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [id, reloadKey])

  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(i18n.language, { day: '2-digit', month: 'short', year: 'numeric' }) : null

  const assigned = useMemo(() => courses.filter((c) => c.is_assigned), [courses])
  const stats = useMemo(() => {
    // `completed_at` es la última actividad, no una finalización: contar con él
    // daba por terminados cursos con 1 de 5 módulos (ver courseState).
    const completed = assigned.filter((c) => c.certified).length
    const certsCount = assigned.filter((c) => c.certified).length
    const scored = assigned.filter((c) => c.score != null)
    const avg = scored.length ? Math.round(scored.reduce((a, c) => a + (c.score ?? 0), 0) / scored.length) : null
    return { total: assigned.length, completed, certs: certsCount, avg }
  }, [assigned])

  /**
   * Vitrina de certificados. La fuente buena es `certifications` (trae cert_id,
   * así que el visor puede pintar el QR verificable). Si la RLS no dejó leer esa
   * tabla —típico del capacitador— se reconstruye desde el RPC de cursos: sin
   * cert_id no hay enlace público, pero el certificado se sigue viendo.
   */
  const certItems = useMemo<UserCertificate[]>(() => {
    if (certs.length > 0) return certs
    return assigned
      .filter((c) => c.certified)
      .map((c) => ({
        certId: '',
        courseId: c.course_id,
        slug: c.slug,
        titleEs: rowText(c),
        titleEn: null,
        titlePt: null,
        icon: c.icon,
        score: c.score ?? 0,
        issuedAt: c.completed_at ?? new Date().toISOString(),
      }))
  }, [certs, assigned])

  const roleLabel = profile ? t(`roles.${profile.role}`) : ''
  const roleTone = profile?.role === 'superadmin'
    ? 'amber'
    : profile?.role === 'capacitador' ? 'violet' : 'green'

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-text-subtle" />
      </div>
    )
  }

  if (loadFailed) {
    return (
      <div className="p-8">
        <button onClick={() => navigate('/admin/users')} className="mb-6 inline-flex items-center gap-1.5 text-[13px] text-text-muted hover:text-text">
          <ArrowLeft className="h-4 w-4" /> {t('admin.users.title')}
        </button>
        <div className="rounded-3xl border border-dashed border-line bg-surface px-6 py-12 text-center">
          <p className="text-[14px] text-text">
            {t('admin.users.profile_load_failed', 'No se pudo cargar el perfil.')}
          </p>
          <p className="mx-auto mt-1 max-w-md text-[13px] text-text-muted">
            {t('admin.users.profile_load_failed_hint', 'Fue un problema momentáneo de conexión, no es que la persona no exista.')}
          </p>
          <Button variant="secondary" size="sm" className="mt-5" onClick={() => setReloadKey((k) => k + 1)}>
            {t('admin.users.profile_load_retry', 'Reintentar')}
          </Button>
        </div>
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

  const heroStats: HeroStat[] = coursesDenied ? [] : [
    { id: 'total', icon: BookOpen, label: t('admin.users.assigned_courses'), value: stats.total },
    { id: 'completed', icon: CheckCircle2, label: t('admin.users.courses_completed'), value: stats.completed },
    { id: 'certs', icon: Award, label: t('admin.users.certifications'), value: stats.certs, accent: '#0ca23e' },
    { id: 'avg', icon: BarChart3, label: t('admin.users.avg_score'), value: stats.avg, suffix: '%', accent: '#B33D9E' },
  ]

  const tabs: ProfileTab[] = [
    { id: 'trayectoria', label: t('profile.tab_journey', 'Trayectoria'), icon: Trophy },
    { id: 'certificados', label: t('profile.tab_certificates', 'Certificados'), icon: Award, count: certItems.length },
    { id: 'cursos', label: t('admin.users.courses_progress'), icon: GraduationCap, count: assigned.length },
    { id: 'datos', label: t('profile.tab_data', 'Datos'), icon: UserIcon },
  ]

  const editLabel = 'mb-1.5 block text-[12px] font-semibold uppercase tracking-wide text-text-subtle'

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-8">
      <button
        onClick={() => navigate('/admin/users')}
        className="mb-6 inline-flex items-center gap-1.5 text-[13px] text-text-muted transition-colors hover:text-text"
      >
        <ArrowLeft className="h-4 w-4" /> {t('admin.users.title')}
      </button>

      <ProfileHero
        name={profile.display_name || t('profile.no_name')}
        jobTitle={profile.job_title}
        email={email}
        avatarUrl={profile.avatar_url}
        roleLabel={roleLabel}
        roleTone={roleTone}
        campaignName={campaignName}
        canEditPhoto={isSuperAdmin}
        uploadingPhoto={uploading}
        onPickPhoto={() => fileRef.current?.click()}
        onDropPhoto={uploadPhoto}
        // El saludo del globo es para QUIEN MIRA, no para la ficha que está en
        // pantalla: por eso aquí va el nombre de quien consulta.
        dailyNote={{ greeting: greetingFor(displayName), note: visitNote() }}
        photoLabel={t('profile.change_photo', 'Cambiar foto')}
        stats={heroStats}
        meta={[
          { id: 'job_title', icon: Briefcase, label: t('profile.job_title'), value: profile.job_title },
          { id: 'national_id', icon: IdCard, label: t('profile.national_id'), value: profile.national_id },
          { id: 'phone', icon: Phone, label: t('profile.phone'), value: profile.phone },
          {
            id: 'country', icon: MapPin, label: t('profile.country'),
            value: countryLabelWithFlag(profile.country),
          },
          { id: 'member_since', icon: CalendarDays, label: t('admin.users.member_since'), value: fmtDate(profile.created_at) },
        ]}
        actions={isSuperAdmin && !editing ? (
          <Button variant="secondary" size="sm" onClick={startEdit}>
            <Pencil className="h-3.5 w-3.5" />
            {t('admin.users.edit_profile', 'Editar perfil')}
          </Button>
        ) : undefined}
      />
      {isSuperAdmin && (
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void uploadPhoto(f)
          }}
        />
      )}

      <div className="my-6">
        <ProfileTabs tabs={tabs} active={tab} onChange={(v) => setTab(v as TabId)} layoutGroup="admin-user-profile" />
      </div>

      <motion.div
        key={tab}
        initial={reduce ? undefined : { opacity: 0, y: 14 }}
        animate={reduce ? undefined : { opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      >
        {tab === 'trayectoria' && (
          game ? (
            <AchievementsPanel
              xp={game.xp}
              streak={game.streak}
              earned={game.badges}
              lang={lang}
              hideLocked
            />
          ) : (
            <p className="rounded-3xl border border-dashed border-line bg-surface px-6 py-12 text-center text-[13px] text-text-muted">
              {t('profile.journey_unavailable', 'Todavía no hay actividad registrada para esta persona.')}
            </p>
          )
        )}

        {tab === 'certificados' && (
          <CertificateWall
            items={certItems}
            ownerName={profile.display_name || t('profile.no_name')}
            ownerNationalId={profile.national_id}
            targetUserId={profile.id}
            emptyHint={t('profile.certs_empty_hint_other', 'Cuando complete un curso y apruebe su evaluación, su certificado aparecerá aquí.')}
          />
        )}

        {tab === 'cursos' && (
          <div className="rounded-3xl border border-line bg-surface p-6">
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
                {assigned.map((c, i) => {
                  const completed = fmtDate(c.completed_at)
                  // Un curso certificado está, por definición, completado: el certificado
                  // manda sobre la ausencia de progreso en user_progress (que puede quedar
                  // desincronizado). Evita el estado contradictorio "Certificado" + "Pendiente".
                  const isDone = c.certified || !!completed
                  return (
                    <motion.div
                      key={c.course_id}
                      initial={reduce ? undefined : { opacity: 0, x: -10 }}
                      animate={reduce ? undefined : { opacity: 1, x: 0 }}
                      transition={{ duration: 0.35, delay: i * 0.04, ease: [0.16, 1, 0.3, 1] }}
                      className="flex items-center gap-3 rounded-xl border border-line px-4 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[13px] font-medium text-text truncate">{rowText(c)}</span>
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
                          <span>{t('courses.modules_count', { count: c.total_modules })}</span>
                          {completed && <span>{t('admin.users.col_completed')}: {completed}</span>}
                        </div>
                      </div>
                      <div className={cn(
                        'shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-semibold',
                        isDone ? 'bg-[rgba(34,197,94,0.15)] text-[#16a34a]' : 'bg-subtle text-text-muted',
                      )}>
                        {isDone ? t('admin.users.status_done') : t('admin.users.status_pending')}
                      </div>
                    </motion.div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {tab === 'datos' && (
          <div className="space-y-6">
          <div className="rounded-3xl border border-line bg-surface p-6">
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
                      placeholder={t('profile.country_ph', 'Elige tu país')}
                      className="[&>button]:h-12 [&>button]:rounded-2xl [&>button]:px-4 [&>button]:text-[15px]"
                      options={COUNTRY_OPTIONS}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className={editLabel}>{t('profile.bio', 'Acerca de mí')}</label>
                    <RichTextArea
                      value={form.bio}
                      onChange={(v) => setForm((f) => ({ ...f, bio: v }))}
                      rows={3}
                      placeholder={t('profile.bio_ph', 'Cuéntanos algo sobre ti (opcional)')}
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
                  {[
                    { id: 'job_title', icon: Briefcase, label: t('profile.job_title'), value: profile.job_title },
                    { id: 'national_id', icon: IdCard, label: t('profile.national_id'), value: profile.national_id },
                    { id: 'phone', icon: Phone, label: t('profile.phone'), value: profile.phone },
                    {
                      id: 'country', icon: MapPin, label: t('profile.country'),
                      value: countryLabelWithFlag(profile.country),
                    },
                    { id: 'member_since', icon: CalendarDays, label: t('admin.users.member_since'), value: fmtDate(profile.created_at) },
                  ].map(({ id, icon: Icon, label, value }) => (
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
                    <RichText text={profile.bio} className="text-[14px] text-text-muted" />
                  </div>
                )}
              </>
            )}
          </div>

          {/* Revocar el ingreso biométrico de otra persona es cosa del
              superadmin: la RLS de `user_passkeys` no se lo permite a nadie
              más, así que mostrarlo a un capacitador sería enseñar un botón
              que siempre falla. */}
          {isSuperAdmin && <PasskeyManager userId={profile.id} manageOnly />}
          </div>
        )}
      </motion.div>
    </div>
  )
}
