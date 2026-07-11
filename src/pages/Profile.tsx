import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Camera, Loader2, Lock, Save } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useAuthStore } from '@/stores/authStore';
import { useUserStore } from '@/stores/userStore';
import { updateProfile, uploadAvatar, changePassword } from '@/services/auth.service';
import { Avatar } from '@/components/ui/Avatar';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { NeonBadge } from '@/components/ui/NeonBadge';
import { toast } from '@/stores/toastStore';

const MAX_AVATAR_BYTES = 3 * 1024 * 1024; // 3 MB: sobra para una foto y cuida el storage Free.

export default function Profile() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, profile, displayName, avatarUrl, isSuperAdmin, isCapacitador } = useAuth();
  const setProfile = useAuthStore((s) => s.setProfile);
  const setName = useUserStore((s) => s.setName);
  const fileRef = useRef<HTMLInputElement>(null);

  // Datos personales
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

  // Contraseña
  const [pwd, setPwd] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [savingPwd, setSavingPwd] = useState(false);

  const roleLabel = isSuperAdmin
    ? t('roles.superadmin')
    : isCapacitador
      ? t('roles.capacitador')
      : t('roles.learner');
  const roleColor = isSuperAdmin ? 'amber' : isCapacitador ? 'violet' : 'green';

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

  const handlePassword = async () => {
    if (pwd.length < 6) {
      toast.error(t('profile.pwd_short', 'La contraseña debe tener al menos 6 caracteres'));
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

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 pt-8 pb-24">
      <button
        onClick={() => navigate(-1)}
        className="mb-6 inline-flex items-center gap-1.5 text-[13px] text-text-muted transition-colors hover:text-text"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('common.back', 'Volver')}
      </button>

      <h1 className="mb-8 text-[28px] font-extrabold tracking-tight text-text">
        {t('profile.title', 'Mi perfil')}
      </h1>

      {/* Encabezado: foto + nombre + rol */}
      <div className={`${card} mb-6 flex flex-col items-center gap-5 text-center sm:flex-row sm:text-left`}>
        <div className="relative">
          <Avatar src={localAvatar} name={displayName} size={96} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            aria-label={t('profile.change_photo', 'Cambiar foto')}
            className="absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full border-2 border-surface bg-primary text-on-primary shadow-sm transition-transform hover:scale-105 disabled:opacity-60"
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatar} />
        </div>
        <div className="min-w-0">
          <div className="mb-1 text-[20px] font-bold tracking-tight text-text">
            {displayName || t('profile.no_name', 'Sin nombre')}
          </div>
          <div className="mb-2 truncate text-[13px] text-text-muted">{user?.email}</div>
          <NeonBadge color={roleColor as 'amber' | 'violet' | 'green'} className="text-[10px]">
            {roleLabel}
          </NeonBadge>
        </div>
      </div>

      {/* Datos personales */}
      <div className={`${card} mb-6`}>
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
                { value: 'CO', label: 'Colombia' },
                { value: 'MX', label: 'México' },
                { value: 'AR', label: 'Argentina' },
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

      {/* Cambiar contraseña */}
      <div className={card}>
        <h2 className="mb-1 flex items-center gap-2 text-[16px] font-semibold text-text">
          <Lock className="h-4 w-4 text-text-muted" />
          {t('profile.change_password', 'Cambiar contraseña')}
        </h2>
        <p className="mb-5 text-[13px] text-text-muted">
          {t('profile.password_hint', 'Ingresa una nueva contraseña de al menos 6 caracteres.')}
        </p>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <label className={label}>{t('profile.new_password', 'Nueva contraseña')}</label>
            <Input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} autoComplete="new-password" placeholder="••••••••" />
          </div>
          <div>
            <label className={label}>{t('profile.confirm_password', 'Confirmar contraseña')}</label>
            <Input type="password" value={pwd2} onChange={(e) => setPwd2(e.target.value)} autoComplete="new-password" placeholder="••••••••" />
          </div>
        </div>
        <div className="mt-6 flex justify-end">
          <Button variant="secondary" onClick={handlePassword} disabled={savingPwd || !pwd}>
            {savingPwd ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
            {t('profile.update_password', 'Actualizar contraseña')}
          </Button>
        </div>
      </div>
    </div>
  );
}
