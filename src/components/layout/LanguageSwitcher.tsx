import { useTranslation } from 'react-i18next';
import { useUserStore, type Language } from '@/stores/userStore';
import { useAuthStore } from '@/stores/authStore';
import { updateProfile } from '@/services/auth.service';
import { cn } from '@/lib/cn';

const LANGS: { code: Language; label: string }[] = [
  { code: 'es', label: 'ES' },
  { code: 'en', label: 'EN' },
  { code: 'pt', label: 'PT' },
];

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const setLanguage = useUserStore((s) => s.setLanguage);
  const current = (i18n.resolvedLanguage ?? 'es') as Language;

  const change = (lang: Language) => {
    void i18n.changeLanguage(lang);
    setLanguage(lang);
    // Persist to Supabase profile so it survives across sessions and devices
    const userId = useAuthStore.getState().session?.user?.id;
    if (userId) void updateProfile(userId, { language: lang });
  };

  return (
    <div className="inline-flex items-center gap-0.5 rounded-full border border-line bg-surface p-0.5 text-[10px] sm:text-[11px] font-medium">
      {LANGS.map((l) => (
        <button
          key={l.code}
          onClick={() => change(l.code)}
          className={cn(
            'h-6 w-6 sm:h-7 sm:w-8 rounded-full transition-colors tracking-wider',
            current === l.code
              ? 'bg-text text-bg'
              : 'text-text-muted hover:text-text',
          )}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
