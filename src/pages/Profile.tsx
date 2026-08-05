import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft, Award, BookOpen, Briefcase, CalendarDays, CheckCircle2, IdCard,
  Loader2, Lock, Mail, MapPin, Pencil, Phone, Save, Sparkles, Trophy,
  User as UserIcon, Zap,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useAuthStore } from '@/stores/authStore';
import { useUserStore } from '@/stores/userStore';
import { useLearnerCourses } from '@/hooks/useLearnerCourses';
import { useProgressStore, useModuleDone, keyOfCourseModule } from '@/stores/progressStore';
import { updateProfile, uploadAvatar, changePassword } from '@/services/auth.service';
import { getUserCertificates, type UserCertificate } from '@/services/certification.service';
import { Input } from '@/components/ui/Input';
import { PasswordStrength } from '@/components/auth/PasswordStrength';
import { evaluatePassword } from '@/lib/password';
import { Select } from '@/components/ui/Select';
import { COUNTRY_OPTIONS, countryLabelWithFlag } from '@/lib/countries';
import { Button } from '@/components/ui/Button';
import { ProfileHero, type HeroStat } from '@/components/profile/ProfileHero';
import { ProfileTabs, type ProfileTab } from '@/components/profile/ProfileTabs';
import { CertificateWall } from '@/components/profile/CertificateWall';
import { AchievementsPanel } from '@/components/profile/AchievementsPanel';
import { PasskeyManager } from '@/components/profile/PasskeyManager';
import { PasskeySetupCard } from '@/components/auth/PasskeySetupCard';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { toast } from '@/stores/toastStore';
import type { Lang } from '@/stores/gamificationStore';

const MAX_AVATAR_BYTES = 3 * 1024 * 1024; // 3 MB: sobra para una foto y cuida el storage Free.

type TabId = 'trayectoria' | 'certificados' | 'datos' | 'seguridad';

/** Campos que cuentan para "perfil completo" (la foto va aparte, en el hero). */
const COMPLETABLE = ['display_name', 'job_title', 'national_id', 'phone', 'country'] as const;

export default function Profile() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const [params, setParams] = useSearchParams();
  const { user, profile, displayName, avatarUrl, isSuperAdmin, isCapacitador } = useAuth();
  const setProfile = useAuthStore((s) => s.setProfile);
  const setName = useUserStore((s) => s.setName);
  const fileRef = useRef<HTMLInputElement>(null);

  const lang = (i18n.resolvedLanguage ?? 'es') as Lang;

  // Pestaña activa reflejada en la URL: así "mis certificados" se puede
  // enlazar y compartir, y volver atrás no pierde el sitio donde estabas.
  const tabFromUrl = params.get('tab') as TabId | null;
  const [tab, setTab] = useState<TabId>(tabFromUrl ?? 'trayectoria');
  const changeTab = (id: string) => {
    setTab(id as TabId);
    const next = new URLSearchParams(params);
    next.set('tab', id);
    setParams(next, { replace: true });
  };

  // ── Datos personales ──
  const formFromProfile = () => ({
    display_name: profile?.display_name ?? '',
    job_title: profile?.job_title ?? '',
    national_id: profile?.national_id ?? '',
    phone: profile?.phone ?? '',
    country: (profile?.country ?? '') as string,
    bio: profile?.bio ?? '',
  });
  const [form, setForm] = useState(formFromProfile);
  // Si el perfil llega o cambia después (sesión que se rehidrata, edición desde
  // otra pestaña), el formulario se pone al día en vez de quedarse en blanco y
  // borrar datos buenos al guardar.
  const profileStamp = `${profile?.id ?? ''}|${profile?.updated_at ?? ''}`;
  const lastStamp = useRef(profileStamp);
  useEffect(() => {
    if (lastStamp.current === profileStamp) return;
    lastStamp.current = profileStamp;
    setForm(formFromProfile());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileStamp]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [localAvatar, setLocalAvatar] = useState<string | null>(avatarUrl);

  // ── Contraseña ──
  const [pwd, setPwd] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [savingPwd, setSavingPwd] = useState(false);
  // Cambia al activar la huella desde la tarjeta superior: remonta la sección
  // de dispositivos para que aparezca el recién añadido sin recargar la página.
  const [passkeyNonce, setPasskeyNonce] = useState(0);

  // ── Trayectoria: certificados, cursos, gamificación ──
  const [certs, setCerts] = useState<UserCertificate[]>([]);
  const [certsLoading, setCertsLoading] = useState(true);
  const [campaignName, setCampaignName] = useState<string | null>(null);
  const { courses } = useLearnerCourses();
  const { xp, streak, badges } = useProgressStore();
  const isModuleDone = useModuleDone();

  useEffect(() => {
    if (!user?.id) return;
    let alive = true;
    setCertsLoading(true);
    getUserCertificates(user.id)
      .then((rows) => { if (alive) setCerts(rows); })
      .catch(() => {})
      .finally(() => { if (alive) setCertsLoading(false); });
    return () => { alive = false; };
  }, [user?.id]);

  useEffect(() => {
    const cid = profile?.campaign_id;
    if (!cid) return;
    let alive = true;
    supabase.from('campaigns').select('name').eq('id', cid).maybeSingle()
      .then(({ data }) => { if (alive) setCampaignName(data?.name ?? null); });
    return () => { alive = false; };
  }, [profile?.campaign_id]);

  const assigned = useMemo(() => courses.filter((c) => c.isAssigned), [courses]);
  const completedCourses = useMemo(
    () => assigned.filter((c) => {
      const mods = c.modules ?? [];
      return mods.length > 0 && mods.every((m) => isModuleDone(keyOfCourseModule(m)));
    }).length,
    [assigned, isModuleDone],
  );

  const roleLabel = isSuperAdmin
    ? t('roles.superadmin')
    : isCapacitador
      ? t('roles.capacitador')
      : t('roles.learner');
  const roleTone = isSuperAdmin ? 'amber' : isCapacitador ? 'violet' : 'green';

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite re-elegir el mismo archivo
    if (!file || !user) return;
    if (!file.type.startsWith('image/')) {
      toast.error(t('profile.avatar_invalid', 'Elige un archivo de imagen'));
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      toast.error(t('profile.avatar_too_big', 'La imagen supera los 3 MB'));
      return;
    }
    setUploading(true);
    try {
      const url = await uploadAvatar(user.id, file);
      const updated = await updateProfile(user.id, { avatar_url: url });
      setProfile(updated);
      setLocalAvatar(url);
      toast.success(t('profile.avatar_saved', 'Foto actualizada'));
    } catch (err) {
      toast.error(t('profile.save_error', 'No se pudo guardar'), (err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!user) return;
    // Teléfono: solo dígitos, espacios, +, -, ( ) y mínimo 7 dígitos si se llenó
    const phone = form.phone.trim();
    if (phone && (!/^[+()\-\s\d]+$/.test(phone) || (phone.match(/\d/g)?.length ?? 0) < 7)) {
      toast.error(t('profile.phone_invalid', 'Teléfono inválido: usa solo números (mínimo 7 dígitos)'));
      return;
    }
    setSaving(true);
    try {
      const updated = await updateProfile(user.id, {
        display_name: form.display_name.trim() || null,
        job_title: form.job_title.trim() || null,
        national_id: form.national_id.trim() || null,
        phone: form.phone.trim() || null,
        country: form.country || null,
        bio: form.bio.trim() || null,
      });
      setProfile(updated);
      setName(updated.display_name ?? '');
      toast.success(t('profile.saved', 'Perfil actualizado'));
    } catch (err) {
      toast.error(t('profile.save_error', 'No se pudo guardar'), (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // Misma política que el restablecimiento desde el login: no tiene sentido
  // exigir una contraseña fuerte al recuperarla y aceptar una débil aquí.
  const pwdVerdict = evaluatePassword(pwd, { email: user?.email, name: form.display_name });

  const handlePassword = async () => {
    if (!pwdVerdict.valid) {
      toast.error(t('profile.pwd_weak', 'La contraseña no cumple los requisitos de seguridad'));
      return;
    }
    if (pwd !== pwd2) {
      toast.error(t('profile.pwd_mismatch', 'Las contraseñas no coinciden'));
      return;
    }
    setSavingPwd(true);
    try {
      await changePassword(pwd);
      setPwd('');
      setPwd2('');
      toast.success(t('profile.pwd_saved', 'Contraseña actualizada'));
    } catch (err) {
      toast.error(t('profile.save_error', 'No se pudo guardar'), (err as Error).message);
    } finally {
      setSavingPwd(false);
    }
  };

  // Ir a "Mis datos" y dejar el cursor en el campo que se pidió completar:
  // el objetivo es que llenar el dato cueste un clic, no una búsqueda.
  const goToData = (field?: string) => {
    changeTab('datos');
    setTimeout(() => {
      const el = field ? document.getElementById(`pf-${field}`) : null;
      if (el) {
        (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
        (el as HTMLInputElement).focus?.();
      } else {
        document.getElementById('pf-datos')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 80);
  };

  const missing = COMPLETABLE.filter((k) => !String(form[k] ?? '').trim());
  const completion = Math.round(((COMPLETABLE.length - missing.length) / COMPLETABLE.length) * 100);
  const dirty = (Object.keys(form) as (keyof typeof form)[]).some(
    (k) => form[k].trim() !== (formFromProfile()[k] ?? '').trim(),
  );

  const label = 'mb-1.5 block text-[12px] font-semibold uppercase tracking-wide text-text-subtle';
  const card = 'rounded-3xl border border-line bg-surface p-6 sm:p-8';

  const stats: HeroStat[] = [
    { id: 'certs', icon: Award, label: t('profile.stat_certificates', 'Certificados'), value: certs.length, accent: '#0ca23e' },
    { id: 'courses', icon: BookOpen, label: t('profile.stat_courses', 'Cursos asignados'), value: assigned.length },
    { id: 'done', icon: CheckCircle2, label: t('profile.stat_completed', 'Cursos completados'), value: completedCourses },
    { id: 'xp', icon: Zap, label: t('profile.stat_xp', 'Experiencia'), value: xp, suffix: ' XP', accent: '#B33D9E' },
  ];

  const tabs: ProfileTab[] = [
    { id: 'trayectoria', label: t('profile.tab_journey', 'Trayectoria'), icon: Trophy },
    { id: 'certificados', label: t('profile.tab_certificates', 'Certificados'), icon: Award, count: certs.length },
    { id: 'datos', label: t('profile.tab_data', 'Mis datos'), icon: UserIcon },
    { id: 'seguridad', label: t('profile.tab_security', 'Seguridad'), icon: Lock },
  ];

  const fmtDate = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleDateString(i18n.language, { day: '2-digit', month: 'short', year: 'numeric' }) : null;

  return (
    <div className="mx-auto max-w-5xl px-4 pb-24 pt-8 sm:px-6">
      <button
        onClick={() => navigate(-1)}
        className="mb-6 inline-flex items-center gap-1.5 text-[13px] text-text-muted transition-colors hover:text-text"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('common.back', 'Volver')}
      </button>

      <ProfileHero
        name={displayName || t('profile.no_name', 'Sin nombre')}
        jobTitle={profile?.job_title}
        email={user?.email}
        avatarUrl={localAvatar}
        roleLabel={roleLabel}
        roleTone={roleTone}
        campaignName={campaignName}
        canEditPhoto
        uploadingPhoto={uploading}
        onPickPhoto={() => fileRef.current?.click()}
        photoLabel={t('profile.change_photo', 'Cambiar foto')}
        stats={stats}
        actions={
          <Button variant="secondary" size="sm" onClick={() => goToData()}>
            <Pencil className="h-4 w-4" />
            {t('profile.edit_data', 'Editar mis datos')}
          </Button>
        }
        meta={[
          {
            id: 'job', icon: Briefcase, label: t('profile.job_title'),
            value: profile?.job_title ?? null,
            onFill: () => goToData('job_title'),
            fillLabel: t('profile.add_data', 'Completar'),
          },
          {
            id: 'id', icon: IdCard, label: t('profile.national_id'),
            value: profile?.national_id ?? null,
            onFill: () => goToData('national_id'),
            fillLabel: t('profile.add_data', 'Completar'),
          },
          {
            id: 'phone', icon: Phone, label: t('profile.phone'),
            value: profile?.phone ?? null,
            onFill: () => goToData('phone'),
            fillLabel: t('profile.add_data', 'Completar'),
          },
          {
            id: 'country', icon: MapPin, label: t('profile.country'),
            value: countryLabelWithFlag(profile?.country),
            onFill: () => goToData('country'),
            fillLabel: t('profile.add_data', 'Completar'),
          },
          { id: 'since', icon: CalendarDays, label: t('admin.users.member_since', 'Miembro desde'), value: fmtDate(profile?.created_at) },
        ]}
      />
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatar} />

      {/* Perfil incompleto: se avisa una vez, arriba, con el atajo para llenarlo.
          Los datos de la ficha (cargo, cédula, país) salen en el certificado y
          en los reportes, así que vale la pena pedirlos de frente. */}
      {missing.length > 0 && (
        <button
          type="button"
          onClick={() => goToData(missing[0])}
          className="mt-4 flex w-full items-center gap-4 rounded-2xl border border-line bg-surface p-4 text-left transition-colors hover:border-brand-green"
        >
          <div className="relative h-10 w-10 shrink-0">
            <svg viewBox="0 0 36 36" className="h-10 w-10 -rotate-90">
              <circle cx="18" cy="18" r="15" fill="none" strokeWidth="4" className="stroke-line" />
              <circle
                cx="18" cy="18" r="15" fill="none" strokeWidth="4" strokeLinecap="round"
                stroke="#10D451"
                strokeDasharray={`${(completion / 100) * 94.2} 94.2`}
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold tabular-nums text-text">
              {completion}%
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold text-text">
              {t('profile.incomplete_title', 'Completa tu perfil')}
            </div>
            <div className="truncate text-[13px] text-text-muted">
              {t('profile.incomplete_hint', 'Falta: {{fields}}', {
                fields: missing.map((k) => t(`profile.${k === 'display_name' ? 'full_name' : k}`)).join(' · '),
              })}
            </div>
          </div>
          <Pencil className="h-4 w-4 shrink-0 text-text-subtle" />
        </button>
      )}

      {/* Puerta visible para activar la huella. La invitación post-login se
          ofrece una sola vez; quien la descartó necesita poder volver, y
          buscarla dentro de una pestaña no cuenta como "poder volver".
          `passkeyNonce` fuerza a la sección de Seguridad a releer la lista
          cuando se activa desde aquí. */}
      {user?.id && (
        <PasskeySetupCard
          userId={user.id}
          email={user.email}
          onActivated={() => setPasskeyNonce((n) => n + 1)}
        />
      )}

      <div className="my-6">
        <ProfileTabs tabs={tabs} active={tab} onChange={changeTab} layoutGroup="my-profile" />
      </div>

      {/* Sin AnimatePresence a propósito: basta con remontar por `key` para que
          el contenido entre animado, y así no hay forma de que una salida a
          medias deje la pestaña en blanco. */}
      <motion.div
        key={tab}
        initial={reduce ? undefined : { opacity: 0, y: 14 }}
        animate={reduce ? undefined : { opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      >
          {tab === 'trayectoria' && (
            <div className="space-y-6">
              <AchievementsPanel xp={xp} streak={streak} earned={badges} lang={lang} />

              <section>
                <div className="mb-4 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-text-subtle" />
                  <h2 className="text-[15px] font-bold text-text">
                    {t('profile.certs_recent', 'Certificados recientes')}
                  </h2>
                </div>
                {certsLoading ? (
                  <CertsSkeleton />
                ) : (
                  <CertificateWall
                    items={certs.slice(0, 3)}
                    ownerName={displayName}
                    ownerNationalId={profile?.national_id}
                  />
                )}
                {certs.length > 3 && (
                  <div className="mt-4 flex justify-center">
                    <Button variant="secondary" size="sm" onClick={() => changeTab('certificados')}>
                      <Award className="h-4 w-4" />
                      {t('profile.certs_see_all', 'Ver los {{n}} certificados', { n: certs.length })}
                    </Button>
                  </div>
                )}
              </section>
            </div>
          )}

          {tab === 'certificados' && (
            certsLoading ? <CertsSkeleton /> : (
              <CertificateWall
                items={certs}
                ownerName={displayName}
                ownerNationalId={profile?.national_id}
              />
            )
          )}

          {tab === 'datos' && (
            <div id="pf-datos" className={card}>
              <h2 className="text-[16px] font-semibold text-text">
                {t('profile.personal_info', 'Información personal')}
              </h2>
              <p className="mb-5 mt-1 text-[13px] text-text-muted">
                {t('profile.personal_info_hint', 'Estos datos aparecen en tu certificado y en los reportes de tu capacitador. Puedes cambiarlos cuando quieras.')}
              </p>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className={label} htmlFor="pf-display_name">{t('profile.full_name', 'Nombre completo')}</label>
                  <Input id="pf-display_name" value={form.display_name} onChange={set('display_name')} autoComplete="name" placeholder={t('profile.full_name', 'Nombre completo')} />
                </div>
                <div>
                  <label className={label} htmlFor="pf-job_title">{t('profile.job_title', 'Cargo')}</label>
                  <Input id="pf-job_title" value={form.job_title} onChange={set('job_title')} autoComplete="organization-title" placeholder={t('profile.job_title_ph', 'Ej. Asesor comercial')} />
                </div>
                <div>
                  <label className={label} htmlFor="pf-national_id">{t('profile.national_id', 'Cédula / Documento')}</label>
                  <Input id="pf-national_id" value={form.national_id} onChange={set('national_id')} inputMode="numeric" placeholder="123456789" />
                </div>
                <div>
                  <label className={label} htmlFor="pf-phone">{t('profile.phone', 'Teléfono')}</label>
                  <Input id="pf-phone" value={form.phone} onChange={set('phone')} inputMode="tel" autoComplete="tel" placeholder="+57 300 000 0000" />
                </div>
                <div>
                  <label className={label} htmlFor="pf-country">{t('profile.country', 'País')}</label>
                  <Select
                    id="pf-country"
                    value={form.country}
                    onChange={(v) => setForm((f) => ({ ...f, country: v }))}
                    placeholder={t('profile.country_ph', 'Elige tu país')}
                    aria-label={t('profile.country', 'País')}
                    className="[&>button]:h-12 [&>button]:rounded-2xl [&>button]:px-4 [&>button]:text-[15px]"
                    options={COUNTRY_OPTIONS}
                  />
                </div>
                {/* El correo es la llave de la cuenta: se muestra para que la
                    ficha esté completa, pero no se cambia desde aquí. */}
                <div className="sm:col-span-2">
                  <label className={label}>{t('profile.email', 'Correo')}</label>
                  <div className="flex h-12 items-center gap-2 rounded-2xl border border-line bg-subtle/40 px-4 text-[15px] text-text-muted">
                    <Mail className="h-4 w-4 shrink-0 text-text-subtle" />
                    <span className="truncate">{user?.email}</span>
                  </div>
                  <p className="mt-1.5 text-[12px] text-text-subtle">
                    {t('profile.email_locked', 'Para cambiar tu correo, escríbele a tu capacitador.')}
                  </p>
                </div>
                <div className="sm:col-span-2">
                  <label className={label} htmlFor="pf-bio">{t('profile.bio', 'Acerca de mí')}</label>
                  <textarea
                    id="pf-bio"
                    value={form.bio}
                    onChange={set('bio')}
                    rows={3}
                    placeholder={t('profile.bio_ph', 'Cuéntanos algo sobre ti (opcional)')}
                    className="w-full resize-none rounded-2xl border border-line bg-surface px-4 py-3 text-[15px] text-text outline-none transition-colors placeholder:text-text-subtle/70 focus:border-brand-green"
                  />
                </div>
              </div>
              <div className="mt-6 flex items-center justify-end gap-3">
                {dirty && !saving && (
                  <button
                    type="button"
                    onClick={() => setForm(formFromProfile())}
                    className="text-[13px] text-text-muted transition-colors hover:text-text"
                  >
                    {t('profile.discard', 'Descartar cambios')}
                  </button>
                )}
                <Button onClick={handleSave} disabled={saving || !dirty}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {t('profile.save', 'Guardar cambios')}
                </Button>
              </div>
            </div>
          )}

          {tab === 'seguridad' && (
            <div className="space-y-6">
            {/* La biometría va primero: es lo que la persona usará a diario.
                La contraseña queda debajo, sin desaparecer nunca — es la red
                que sostiene el día en que se pierde el dispositivo. */}
            {user?.id && <PasskeyManager key={passkeyNonce} userId={user.id} email={user.email} />}

            <div className={card}>
              <h2 className="mb-1 flex items-center gap-2 text-[16px] font-semibold text-text">
                <Lock className="h-4 w-4 text-text-muted" />
                {t('profile.change_password', 'Cambiar contraseña')}
              </h2>
              <p className="mb-5 text-[13px] text-text-muted">
                {t('profile.password_hint_strong', 'Elige una contraseña larga y única: debe cumplir todos los requisitos.')}
              </p>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <div>
                  <label className={label}>{t('profile.new_password', 'Nueva contraseña')}</label>
                  <Input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} autoComplete="new-password" placeholder="••••••••••••" />
                  <PasswordStrength verdict={pwdVerdict} visible={pwd.length > 0} />
                </div>
                <div>
                  <label className={label}>{t('profile.confirm_password', 'Confirmar contraseña')}</label>
                  <Input type="password" value={pwd2} onChange={(e) => setPwd2(e.target.value)} autoComplete="new-password" placeholder="••••••••" />
                </div>
              </div>
              <div className="mt-6 flex justify-end">
                <Button
                  variant="secondary"
                  onClick={handlePassword}
                  disabled={savingPwd || !pwdVerdict.valid || pwd !== pwd2}
                >
                  {savingPwd ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                  {t('profile.update_password', 'Actualizar contraseña')}
                </Button>
              </div>
            </div>
            </div>
          )}
      </motion.div>
    </div>
  );
}

function CertsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-[168px] animate-pulse rounded-3xl border border-line bg-subtle/50" />
      ))}
    </div>
  );
}
