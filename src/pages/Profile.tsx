import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft, Award, BookOpen, Briefcase, CalendarDays, CheckCircle2, IdCard,
  Loader2, Lock, MapPin, Phone, Save, Sparkles, Trophy, User as UserIcon, Zap,
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
import { Button } from '@/components/ui/Button';
import { ProfileHero, type HeroStat } from '@/components/profile/ProfileHero';
import { ProfileTabs, type ProfileTab } from '@/components/profile/ProfileTabs';
import { CertificateWall } from '@/components/profile/CertificateWall';
import { AchievementsPanel } from '@/components/profile/AchievementsPanel';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { toast } from '@/stores/toastStore';
import type { Lang } from '@/stores/gamificationStore';

const MAX_AVATAR_BYTES = 3 * 1024 * 1024; // 3 MB: sobra para una foto y cuida el storage Free.

const COUNTRY_LABEL: Record<string, string> = {
  CO: 'simulator.countries.CO',
  MX: 'simulator.countries.MX',
  AR: 'simulator.countries.AR',
};

type TabId = 'trayectoria' | 'certificados' | 'datos' | 'seguridad';

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
  const [form, setForm] = useState({
    display_name: profile?.display_name ?? '',
    job_title: profile?.job_title ?? '',
    national_id: profile?.national_id ?? '',
    phone: profile?.phone ?? '',
    country: (profile?.country ?? 'CO') as string,
    bio: profile?.bio ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [localAvatar, setLocalAvatar] = useState<string | null>(avatarUrl);

  // ── Contraseña ──
  const [pwd, setPwd] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [savingPwd, setSavingPwd] = useState(false);

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
        meta={[
          { id: 'job', icon: Briefcase, label: t('profile.job_title'), value: profile?.job_title ?? null },
          { id: 'id', icon: IdCard, label: t('profile.national_id'), value: profile?.national_id ?? null },
          { id: 'phone', icon: Phone, label: t('profile.phone'), value: profile?.phone ?? null },
          {
            id: 'country', icon: MapPin, label: t('profile.country'),
            value: profile?.country
              ? (COUNTRY_LABEL[profile.country] ? t(COUNTRY_LABEL[profile.country]) : profile.country)
              : null,
          },
          { id: 'since', icon: CalendarDays, label: t('admin.users.member_since', 'Miembro desde'), value: fmtDate(profile?.created_at) },
        ]}
      />
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatar} />

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
            <div className={card}>
              <h2 className="mb-5 text-[16px] font-semibold text-text">
                {t('profile.personal_info', 'Información personal')}
              </h2>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className={label}>{t('profile.full_name', 'Nombre completo')}</label>
                  <Input value={form.display_name} onChange={set('display_name')} placeholder={t('profile.full_name', 'Nombre completo')} />
                </div>
                <div>
                  <label className={label}>{t('profile.job_title', 'Cargo')}</label>
                  <Input value={form.job_title} onChange={set('job_title')} placeholder={t('profile.job_title_ph', 'Ej. Asesor comercial')} />
                </div>
                <div>
                  <label className={label}>{t('profile.national_id', 'Cédula / Documento')}</label>
                  <Input value={form.national_id} onChange={set('national_id')} inputMode="numeric" placeholder="123456789" />
                </div>
                <div>
                  <label className={label}>{t('profile.phone', 'Teléfono')}</label>
                  <Input value={form.phone} onChange={set('phone')} inputMode="tel" placeholder="+57 300 000 0000" />
                </div>
                <div>
                  <label className={label}>{t('profile.country', 'País')}</label>
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
                  <label className={label}>{t('profile.bio', 'Acerca de mí')}</label>
                  <textarea
                    value={form.bio}
                    onChange={set('bio')}
                    rows={3}
                    placeholder={t('profile.bio_ph', 'Cuéntanos algo sobre ti (opcional)')}
                    className="w-full resize-none rounded-2xl border border-line bg-surface px-4 py-3 text-[15px] text-text outline-none transition-colors placeholder:text-text-subtle/70 focus:border-brand-green"
                  />
                </div>
              </div>
              <div className="mt-6 flex justify-end">
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {t('profile.save', 'Guardar cambios')}
                </Button>
              </div>
            </div>
          )}

          {tab === 'seguridad' && (
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
