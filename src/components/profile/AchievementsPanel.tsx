import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import { Flame, Lock, Sparkles, Trophy } from 'lucide-react';
import {
  useGamificationStore,
  getXPLevel,
  getXPProgress,
  badgeLabel,
  badgeDescription,
  xpLevelLabel,
  type BadgeCategory,
  type BadgeDef,
  type Lang,
} from '@/stores/gamificationStore';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { BadgeTooltip } from '@/components/gamification/BadgeTooltip';
import { cn } from '@/lib/cn';

/* ────────────────────────────────────────────────────────────────────────
   Panel de logros del perfil: nivel de experiencia, racha e insignias
   agrupadas por categoría. Sirve tanto para el perfil propio (datos del
   store local) como para consultar el de otra persona (datos leídos de BD),
   porque XP / racha / insignias entran por props.
   ──────────────────────────────────────────────────────────────────────── */

const CATEGORY_ORDER: BadgeCategory[] = [
  'progress', 'excellence', 'certification', 'streak', 'optional',
];

const CATEGORY_LABEL: Record<BadgeCategory, Record<Lang, string>> = {
  progress: { es: 'Avance', en: 'Progress', pt: 'Progresso' },
  excellence: { es: 'Excelencia', en: 'Excellence', pt: 'Excelência' },
  certification: { es: 'Certificación', en: 'Certification', pt: 'Certificação' },
  streak: { es: 'Constancia', en: 'Consistency', pt: 'Constância' },
  optional: { es: 'Exploración', en: 'Exploration', pt: 'Exploração' },
};

type Filter = 'all' | 'earned' | 'locked';

export interface AchievementsPanelProps {
  xp: number;
  streak: number;
  /** Ids de insignias ganadas. */
  earned: string[];
  lang: Lang;
  /** Oculta las metas no alcanzadas (útil al consultar el perfil de otro). */
  hideLocked?: boolean;
}

export function AchievementsPanel({ xp, streak, earned, lang, hideLocked = false }: AchievementsPanelProps) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const allDefs = useGamificationStore((s) => s.badgeDefs);
  const xpLevels = useGamificationStore((s) => s.xpLevels);
  const [filter, setFilter] = useState<Filter>(hideLocked ? 'earned' : 'all');
  const [detail, setDetail] = useState<BadgeDef | null>(null);

  const defs = useMemo(() => allDefs.filter((b) => b.enabled !== false), [allDefs]);
  const earnedSet = useMemo(() => new Set(earned), [earned]);

  // Las insignias de función opcional (mundo/simulador) solo se muestran si ya
  // se ganaron: enseñarle a alguien una meta de un mundo que no tiene es ruido.
  const visible = useMemo(
    () => defs.filter((b) => !b.requires || earnedSet.has(b.id)),
    [defs, earnedSet],
  );
  const earnedCount = useMemo(
    () => visible.filter((b) => earnedSet.has(b.id)).length,
    [visible, earnedSet],
  );

  const filtered = useMemo(() => {
    if (filter === 'earned') return visible.filter((b) => earnedSet.has(b.id));
    if (filter === 'locked') return visible.filter((b) => !earnedSet.has(b.id));
    return visible;
  }, [visible, filter, earnedSet]);

  const groups = useMemo(() => {
    const byCat = new Map<BadgeCategory, BadgeDef[]>();
    for (const b of filtered) {
      const list = byCat.get(b.category) ?? [];
      list.push(b);
      byCat.set(b.category, list);
    }
    return CATEGORY_ORDER
      .map((cat) => ({ cat, items: byCat.get(cat) ?? [] }))
      .filter((g) => g.items.length > 0);
  }, [filtered]);

  const level = getXPLevel(xp, xpLevels);
  const progress = getXPProgress(xp, xpLevels);
  const nextLevel = xpLevels.find((l) => l.level === level.level + 1);
  const completionPct = visible.length ? Math.round((earnedCount / visible.length) * 100) : 0;

  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: t('profile.badges_filter_all', 'Todas') },
    { id: 'earned', label: t('profile.badges_filter_earned', 'Obtenidas') },
    { id: 'locked', label: t('profile.badges_filter_locked', 'Por conseguir') },
  ];

  return (
    <div className="space-y-5">
      {/* Nivel + racha + completitud */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="relative overflow-hidden rounded-3xl border border-line bg-surface p-6 lg:col-span-2">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full blur-3xl"
            style={{ background: `radial-gradient(circle, ${level.color}33, transparent 70%)` }}
          />
          <div className="relative mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className="flex h-11 w-11 items-center justify-center rounded-2xl text-[15px] font-black"
                style={{ background: `${level.color}1f`, color: level.color }}
              >
                {level.level}
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-text-subtle">
                  {t('profile.xp_level', 'Nivel de experiencia')}
                </div>
                <div className="text-[16px] font-bold text-text">{xpLevelLabel(level, lang)}</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[20px] font-bold tabular-nums text-text">{xp.toLocaleString()}</div>
              <div className="text-[11px] text-text-subtle">XP</div>
            </div>
          </div>
          <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-subtle">
            <motion.div
              className="h-full rounded-full"
              style={{ background: `linear-gradient(90deg, ${level.color}, ${level.color}77)` }}
              initial={reduce ? false : { width: 0 }}
              animate={{ width: `${Math.round(progress * 100)}%` }}
              transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
            />
          </div>
          {nextLevel && (
            <p className="relative mt-2 text-[11px] tabular-nums text-text-subtle">
              {t('dashboard.xp_to_next', {
                xp, max: level.maxXP, rank: xpLevelLabel(nextLevel, lang),
              })}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-1">
          <div className="flex items-center gap-3 rounded-3xl border border-line bg-surface p-5">
            <div className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl',
              streak > 0 ? 'bg-orange-500/10 text-orange-500' : 'bg-subtle text-text-subtle',
            )}>
              <motion.span
                animate={reduce || streak === 0 ? undefined : { scale: [1, 1.15, 1] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
              >
                <Flame className="h-5 w-5" />
              </motion.span>
            </div>
            <div className="min-w-0">
              <div className="text-[22px] font-bold leading-none tabular-nums text-text">{streak}</div>
              <div className="mt-1 truncate text-[11px] text-text-muted">
                {t('profile.streak_days', 'Días seguidos')}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-3xl border border-line bg-surface p-5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Trophy className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-[22px] font-bold leading-none tabular-nums text-text">
                {earnedCount}<span className="text-[14px] text-text-subtle">/{visible.length}</span>
              </div>
              <div className="mt-1 truncate text-[11px] text-text-muted">
                {t('profile.badges_earned', 'Insignias')} · {completionPct}%
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Filtros */}
      {!hideLocked && (
        <div className="flex flex-wrap gap-2">
          {filters.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                'rounded-full border px-3.5 py-1.5 text-[12px] font-semibold transition-colors',
                filter === f.id
                  ? 'border-primary/30 bg-primary/10 text-primary'
                  : 'border-line text-text-muted hover:text-text',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {/* Insignias por categoría */}
      {groups.length === 0 ? (
        <p className="rounded-3xl border border-dashed border-line bg-surface px-6 py-10 text-center text-[13px] text-text-muted">
          {t('profile.badges_empty', 'Todavía no hay insignias por aquí.')}
        </p>
      ) : (
        groups.map(({ cat, items }) => (
          <section key={cat} className="rounded-3xl border border-line bg-surface p-5 sm:p-6">
            <div className="mb-4 flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-text-subtle" />
              <h3 className="text-[12px] font-bold uppercase tracking-wider text-text-subtle">
                {CATEGORY_LABEL[cat][lang] ?? CATEGORY_LABEL[cat].es}
              </h3>
              <span className="text-[11px] tabular-nums text-text-subtle">
                {items.filter((b) => earnedSet.has(b.id)).length}/{items.length}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-7">
              {items.map((badge, i) => (
                <BadgeTile
                  key={badge.id}
                  badge={badge}
                  earned={earnedSet.has(badge.id)}
                  lang={lang}
                  index={i}
                  onSelect={() => setDetail(badge)}
                />
              ))}
            </div>
          </section>
        ))
      )}

      {/* Detalle de la insignia elegida */}
      <AnimatePresence>
        {detail && (
          <BadgeDetail
            badge={detail}
            earned={earnedSet.has(detail.id)}
            lang={lang}
            onClose={() => setDetail(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function BadgeTile({
  badge, earned, lang, index, onSelect,
}: { badge: BadgeDef; earned: boolean; lang: Lang; index: number; onSelect: () => void }) {
  const reduce = useReducedMotion();
  return (
    <BadgeTooltip badge={badge} earned={earned} lang={lang} className="w-full">
      <motion.button
        type="button"
        onClick={onSelect}
        initial={reduce ? undefined : { opacity: 0, scale: 0.85 }}
        animate={reduce ? undefined : { opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, delay: index * 0.035, ease: [0.16, 1, 0.3, 1] }}
        whileHover={reduce ? undefined : { y: -4, scale: 1.05 }}
        whileTap={reduce ? undefined : { scale: 0.96 }}
        className={cn('flex w-full flex-col items-center gap-2', !earned && 'opacity-45')}
      >
        <div className={cn(
          'relative flex aspect-square w-full items-center justify-center rounded-2xl border text-2xl',
          earned
            ? badge.rare
              ? 'border-amber-400/40 bg-amber-400/10 ring-1 ring-amber-400/30'
              : 'border-primary/25 bg-primary/10'
            : 'border-line bg-subtle text-text-subtle',
        )}>
          {earned ? badge.emoji : <Lock className="h-5 w-5" />}
          {badge.rare && (
            <span className={cn('absolute -right-1 -top-1 text-[10px]', !earned && 'opacity-60')}>⭐</span>
          )}
        </div>
        <p className="w-full truncate text-center text-[10px] font-medium text-text-muted">
          {badgeLabel(badge, lang)}
        </p>
      </motion.button>
    </BadgeTooltip>
  );
}

function BadgeDetail({
  badge, earned, lang, onClose,
}: { badge: BadgeDef; earned: boolean; lang: Lang; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      transition={{ type: 'spring', stiffness: 320, damping: 30 }}
      className="sticky bottom-4 z-20 mx-auto flex max-w-lg items-center gap-4 rounded-2xl border border-line bg-surface/95 p-4 shadow-card-hover backdrop-blur"
    >
      <div className={cn(
        'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-2xl',
        earned ? 'bg-primary/10' : 'bg-subtle',
      )}>
        {earned ? badge.emoji : <Lock className="h-5 w-5 text-text-subtle" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[14px] font-bold text-text">{badgeLabel(badge, lang)}</span>
          {earned && (
            <span className="shrink-0 rounded-full bg-[rgba(16,212,81,0.15)] px-2 py-0.5 text-[10px] font-bold text-[#0ca23e]">
              {t('profile.badge_unlocked', 'Obtenida')}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-[12px] text-text-muted">{badgeDescription(badge, lang)}</p>
      </div>
      <button
        onClick={onClose}
        className="shrink-0 rounded-lg px-2 py-1 text-[12px] font-semibold text-text-muted transition-colors hover:text-text"
      >
        {t('common.close', 'Cerrar')}
      </button>
    </motion.div>
  );
}
