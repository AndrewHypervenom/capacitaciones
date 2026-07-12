import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';
import {
  useGamificationStore,
  DEFAULT_BADGE_DEFS,
  DEFAULT_XP_LEVELS,
  type BadgeDef,
  type BadgeCategory,
  type BadgeMetric,
  type XPLevel,
} from '@/stores/gamificationStore';

type BadgeRow = Database['public']['Tables']['achievement_defs']['Row'];
type BadgeInsert = Database['public']['Tables']['achievement_defs']['Insert'];
type XPRow = Database['public']['Tables']['xp_levels']['Row'];
type XPInsert = Database['public']['Tables']['xp_levels']['Insert'];

// ─── Mapeos BD ⇄ modelo del store ─────────────────────────────────────────────

function rowToBadge(r: BadgeRow): BadgeDef {
  return {
    id: r.id,
    emoji: r.emoji,
    category: r.category as BadgeCategory,
    metric: r.metric as BadgeMetric,
    threshold: Number(r.threshold),
    rare: r.rare,
    requires: r.requires ?? undefined,
    enabled: r.enabled,
    builtin: r.builtin,
    sort: r.sort_order,
    label: r.label_es,
    label_en: r.label_en ?? undefined,
    label_pt: r.label_pt ?? undefined,
    description: r.description_es,
    description_en: r.description_en ?? undefined,
    description_pt: r.description_pt ?? undefined,
  };
}

export function badgeToRow(b: BadgeDef): BadgeInsert {
  return {
    id: b.id,
    emoji: b.emoji,
    category: b.category,
    metric: b.metric,
    threshold: b.threshold,
    rare: b.rare ?? false,
    requires: b.requires ?? null,
    enabled: b.enabled ?? true,
    builtin: b.builtin ?? false,
    sort_order: b.sort ?? 0,
    label_es: b.label,
    label_en: b.label_en ?? null,
    label_pt: b.label_pt ?? null,
    description_es: b.description ?? '',
    description_en: b.description_en ?? null,
    description_pt: b.description_pt ?? null,
    updated_at: new Date().toISOString(),
  };
}

function rowToLevel(r: XPRow): XPLevel {
  return {
    level: r.level,
    minXP: r.min_xp,
    maxXP: r.max_xp,
    color: r.color,
    label: r.label_es,
    label_en: r.label_en ?? undefined,
    label_pt: r.label_pt ?? undefined,
  };
}

export function levelToRow(l: XPLevel): XPInsert {
  return {
    level: l.level,
    min_xp: l.minXP,
    max_xp: l.maxXP,
    color: l.color,
    label_es: l.label,
    label_en: l.label_en ?? null,
    label_pt: l.label_pt ?? null,
  };
}

// ─── Carga (learner + admin): pobla el store; cae a defaults si falla/vacío ────

let loadPromise: Promise<void> | null = null;

export async function loadGamification(force = false): Promise<void> {
  const store = useGamificationStore.getState();
  if (!force && (store.loaded || store.loading)) return loadPromise ?? Promise.resolve();

  useGamificationStore.setState({ loading: true });
  loadPromise = (async () => {
    try {
      const [badges, levels] = await Promise.all([
        supabase.from('achievement_defs').select('*').order('sort_order', { ascending: true }),
        supabase.from('xp_levels').select('*').order('min_xp', { ascending: true }),
      ]);
      const badgeDefs =
        badges.data && badges.data.length > 0
          ? badges.data.map(rowToBadge)
          : DEFAULT_BADGE_DEFS;
      const xpLevels =
        levels.data && levels.data.length > 0
          ? levels.data.map(rowToLevel)
          : DEFAULT_XP_LEVELS;
      useGamificationStore.getState().setBadgeDefs(badgeDefs);
      useGamificationStore.getState().setXPLevels(xpLevels);
      useGamificationStore.setState({ loaded: true });
    } catch {
      // Sin BD nos quedamos con los defaults ya presentes en el store.
      useGamificationStore.setState({ loaded: true });
    } finally {
      useGamificationStore.setState({ loading: false });
    }
  })();
  return loadPromise;
}

// ─── CRUD (solo superadmin; RLS lo refuerza en la BD) ─────────────────────────

export async function upsertBadge(def: BadgeDef): Promise<void> {
  const { error } = await supabase
    .from('achievement_defs')
    .upsert(badgeToRow(def), { onConflict: 'id' });
  if (error) throw error;
}

export async function deleteBadge(id: string): Promise<void> {
  const { error } = await supabase.from('achievement_defs').delete().eq('id', id);
  if (error) throw error;
}

export async function upsertLevel(level: XPLevel): Promise<void> {
  const { error } = await supabase
    .from('xp_levels')
    .upsert(levelToRow(level), { onConflict: 'level' });
  if (error) throw error;
}

export async function deleteLevel(level: number): Promise<void> {
  const { error } = await supabase.from('xp_levels').delete().eq('level', level);
  if (error) throw error;
}

/** Siembra los defaults de fábrica en la BD (para inicializar o restaurar). */
export async function seedDefaults(): Promise<void> {
  const badges = await supabase
    .from('achievement_defs')
    .upsert(DEFAULT_BADGE_DEFS.map(badgeToRow), { onConflict: 'id' });
  if (badges.error) throw badges.error;
  const levels = await supabase
    .from('xp_levels')
    .upsert(DEFAULT_XP_LEVELS.map(levelToRow), { onConflict: 'level' });
  if (levels.error) throw levels.error;
}
