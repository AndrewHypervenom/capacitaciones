import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Profile } from '@/types/database';

export type Country = 'CO' | 'MX' | 'AR';
export type Language = 'es' | 'en' | 'pt';

interface UserState {
  name: string;
  country: Country;
  language: Language;
  // True once the user explicitly picked a language this session (via the
  // switcher). Not persisted: a fresh load/device re-seeds from the profile.
  languageChosen: boolean;
  setName: (name: string) => void;
  setCountry: (country: Country) => void;
  setLanguage: (language: Language) => void;
  syncFromProfile: (profile: Profile) => void;
  reset: () => void;
}

export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      name: '',
      country: 'CO',
      language: 'es',
      languageChosen: false,
      setName: (name) => set({ name }),
      setCountry: (country) => set({ country }),
      setLanguage: (language) => set({ language, languageChosen: true }),
      syncFromProfile: (profile) =>
        set((state) => ({
          name: profile.display_name ?? '',
          country: (profile.country ?? 'CO') as Country,
          // Don't override the user's explicit in-session choice. A profile
          // re-sync (token refresh, onAuthStateChange) can arrive with stale
          // data right after a switch and would otherwise revert the language.
          // Also: a null profile.language means no DB choice yet → keep local.
          language: state.languageChosen
            ? state.language
            : (profile.language as Language | null) ?? state.language,
        })),
      reset: () =>
        set((state) => ({ name: '', country: 'CO', language: state.language, languageChosen: false })),
    }),
    {
      name: 'learningai.user',
      // Persist only the data fields; languageChosen is session state so a new
      // device/login correctly re-seeds the language from the profile.
      partialize: (state) => ({
        name: state.name,
        country: state.country,
        language: state.language,
      }),
    },
  ),
);
