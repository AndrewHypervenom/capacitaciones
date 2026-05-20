import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Profile } from '@/types/database';

export type Country = 'CO' | 'MX' | 'AR';
export type Language = 'es' | 'en' | 'pt';

interface UserState {
  name: string;
  country: Country;
  language: Language;
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
      setName: (name) => set({ name }),
      setCountry: (country) => set({ country }),
      setLanguage: (language) => set({ language }),
      syncFromProfile: (profile) =>
        set((state) => ({
          name: profile.display_name ?? '',
          country: (profile.country ?? 'CO') as Country,
          // Only override local language if the profile has one explicitly saved.
          // A null profile.language means the user never persisted a choice to the DB,
          // so we keep whatever is already stored locally.
          language: (profile.language as Language | null) ?? state.language,
        })),
      reset: () => set((state) => ({ name: '', country: 'CO', language: state.language })),
    }),
    { name: 'concepto.user' },
  ),
);
