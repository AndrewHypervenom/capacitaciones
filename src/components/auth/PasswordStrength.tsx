import { motion, AnimatePresence } from 'framer-motion'
import { Check, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PASSWORD_MIN_LENGTH, type PasswordVerdict, type PasswordRuleId } from '@/lib/password'

const GREEN = '#10D451'
const ease = [0.16, 1, 0.3, 1] as const

const STRENGTH_COLOR: Record<PasswordVerdict['strength'], string> = {
  weak: '#F04438',
  fair: '#F79009',
  good: '#3B9BFF',
  strong: GREEN,
}

const RULE_ORDER: PasswordRuleId[] = ['length', 'case', 'number', 'symbol', 'no_pattern', 'no_personal']

/**
 * Medidor de contraseña: barra de fuerza + checklist de requisitos.
 *
 * El checklist se muestra completo desde el primer carácter (no solo lo que
 * falla) para que el usuario sepa a qué apunta antes de intentar y no vaya
 * descubriendo requisitos de uno en uno.
 */
export function PasswordStrength({ verdict, visible }: { verdict: PasswordVerdict; visible: boolean }) {
  const { t } = useTranslation()
  const color = STRENGTH_COLOR[verdict.strength]
  const rules = RULE_ORDER.map((id) => verdict.rules.find((r) => r.id === id)!).filter(Boolean)

  return (
    <AnimatePresence initial={false}>
      {visible && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.28, ease }}
          className="overflow-hidden"
        >
          <div className="pt-3">
            <div
              className="h-1.5 w-full rounded-full overflow-hidden"
              style={{ background: 'rgb(var(--line))' }}
            >
              <motion.div
                className="h-full rounded-full"
                animate={{ width: `${verdict.score}%`, backgroundColor: color }}
                transition={{ duration: 0.45, ease }}
              />
            </div>

            <div className="flex items-center justify-between mt-2">
              <span className="text-[11px] uppercase tracking-[0.12em]" style={{ color: 'rgb(var(--text-subtle))' }}>
                {t('reset.strength_label')}
              </span>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={verdict.strength}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.2 }}
                  className="text-[11px] font-semibold uppercase tracking-[0.12em]"
                  style={{ color }}
                >
                  {t(`reset.strength_${verdict.strength}`)}
                </motion.span>
              </AnimatePresence>
            </div>

            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1.5 mt-3">
              {rules.map((rule, i) => (
                <motion.li
                  key={rule.id}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, delay: i * 0.03, ease }}
                  className="flex items-center gap-1.5 text-[11.5px] leading-tight"
                  style={{ color: rule.ok ? 'rgb(var(--text-muted))' : 'rgb(var(--text-subtle))' }}
                >
                  <motion.span
                    className="inline-flex items-center justify-center h-3.5 w-3.5 rounded-full flex-shrink-0"
                    animate={{
                      backgroundColor: rule.ok ? `${GREEN}26` : 'rgb(var(--line))',
                      scale: rule.ok ? [1, 1.25, 1] : 1,
                    }}
                    transition={{ duration: 0.32, ease }}
                  >
                    {rule.ok
                      ? <Check className="h-2.5 w-2.5" style={{ color: GREEN }} strokeWidth={3.5} />
                      : <X className="h-2.5 w-2.5" style={{ color: 'rgb(var(--text-subtle))' }} strokeWidth={3} />}
                  </motion.span>
                  <span>{t(`reset.rule_${rule.id}`, { min: PASSWORD_MIN_LENGTH })}</span>
                </motion.li>
              ))}
            </ul>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
