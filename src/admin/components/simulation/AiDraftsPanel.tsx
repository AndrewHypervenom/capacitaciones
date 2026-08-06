import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Sparkles, Trash2, PhoneCall, MessageSquare, Clock, CloudOff } from 'lucide-react'
import { useSimAiStore } from '@/stores/simAiStore'
import { listAiDrafts, deleteAiDraft, type AiScenarioDraft } from '@/services/aiDrafts.service'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { Button } from '@/components/ui/Button'
import { Tooltip } from '@/components/ui/Tooltip'
import { FadeIn } from '@/components/ui/motion'
import { cn } from '@/lib/cn'

/**
 * BORRADORES DE IA — la red de seguridad de las simulaciones generadas.
 *
 * Un escenario recién generado no es todavía una simulación: no tiene slug ni se
 * puede publicar. Vive en `ai_scenario_drafts` hasta que alguien lo carga en el
 * editor y le da Guardar. Aparece ACÁ, en la pantalla donde uno viene a buscar sus
 * simulaciones, porque la tarjeta del indicador (abajo a la izquierda) es fácil de
 * cerrar sin querer. De esta lista no se va solo: hay que cargarlo o descartarlo.
 *
 * Se mezclan dos orígenes: la base (sobrevive a cambiar de equipo) y las corridas
 * de este navegador (cubren el caso de que el respaldo en la base fallara).
 */
interface DraftItem {
  runKey: string
  returnPath: string
  type: 'dialogue' | 'choice'
  title: string
  moments: number
  at: number
  /** Fila en la base. Sin esto, el borrador solo existe en este navegador. */
  draftId?: string
  /** Está en el store de este navegador: el editor lo encuentra sin adoptarlo. */
  local: boolean
  db?: AiScenarioDraft
}

export function AiDraftsPanel() {
  const { t, i18n } = useTranslation()
  const nav = useNavigate()
  const confirm = useConfirm()
  // Se toma el objeto entero (referencia estable) y se deriva abajo: un selector que
  // arma un array nuevo en cada render hace re-renderizar sin parar.
  const runs = useSimAiStore((s) => s.runs)
  const clearRun = useSimAiStore((s) => s.clear)
  const adopt = useSimAiStore((s) => s.adopt)

  const [dbDrafts, setDbDrafts] = useState<AiScenarioDraft[]>([])

  useEffect(() => {
    let alive = true
    // Si la tabla todavía no existe en la base, la lista se queda con lo local: el
    // panel nunca es la razón por la que esta pantalla falla.
    listAiDrafts()
      .then((d) => { if (alive) setDbDrafts(d) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  const items = useMemo<DraftItem[]>(() => {
    const byKey = new Map<string, DraftItem>()

    for (const run of Object.values(runs)) {
      if (run.status !== 'done' || !run.result) continue
      const meta = run.result.metadata as unknown as Record<string, unknown>
      byKey.set(run.key, {
        runKey: run.key,
        returnPath: run.returnPath,
        type: run.input.type,
        title: String(meta.title_es ?? '').trim(),
        moments: Object.keys(run.result.nodes ?? {}).length,
        at: run.finishedAt ?? 0,
        draftId: run.draftId,
        local: true,
      })
    }

    for (const d of dbDrafts) {
      if (byKey.has(d.runKey)) {
        // Ya está en el store: solo se completa el id para poder borrarlo.
        byKey.get(d.runKey)!.draftId ??= d.id
        continue
      }
      const meta = d.payload.metadata as unknown as Record<string, unknown>
      byKey.set(d.runKey, {
        runKey: d.runKey,
        returnPath: d.returnPath,
        type: d.type,
        title: d.title || String(meta.title_es ?? '').trim(),
        moments: Object.keys(d.payload.nodes ?? {}).length,
        at: new Date(d.createdAt).getTime(),
        draftId: d.id,
        local: false,
        db: d,
      })
    }

    return [...byKey.values()].sort((a, b) => b.at - a.at)
  }, [runs, dbDrafts])

  if (!items.length) return null

  const fmt = new Intl.DateTimeFormat(i18n.language, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })

  const handleOpen = (item: DraftItem) => {
    // Viene de la base (otro equipo, otra sesión): primero se mete en el store para
    // que el editor lo encuentre esperándolo, igual que si acabara de generarse.
    if (!item.local && item.db) adopt(item.db)
    nav(item.returnPath)
  }

  const handleDiscard = async (item: DraftItem) => {
    const name = item.title || t('admin.simulations.ai_gen.bg_untitled')
    const ok = await confirm({
      title: t('admin.simulations.drafts.discard_title'),
      description: t('admin.simulations.drafts.discard_message', { name }),
      confirmLabel: t('admin.simulations.drafts.discard_confirm'),
    })
    if (!ok) return
    // clearRun ya borra la fila de la base por run_key; para los que solo están en
    // la base (nunca pasaron por este navegador) hay que borrarlos por id.
    if (item.local) clearRun(item.runKey)
    else if (item.draftId) await deleteAiDraft(item.draftId).catch(() => {})
    setDbDrafts((prev) => prev.filter((d) => d.runKey !== item.runKey))
  }

  return (
    <FadeIn>
      <div className="mb-6 rounded-2xl border border-neon-cyan/25 bg-neon-cyan/5 p-4 sm:p-5">
        <div className="flex items-start gap-2.5 mb-3">
          <Sparkles className="h-4 w-4 text-neon-cyan shrink-0 mt-0.5" />
          <div>
            <h2 className="text-sm font-semibold text-text leading-snug">
              {t('admin.simulations.drafts.title', { count: items.length })}
            </h2>
            <p className="text-[11.5px] text-text-muted leading-relaxed mt-0.5">
              {t('admin.simulations.drafts.subtitle')}
            </p>
          </div>
        </div>

        <ul className="space-y-2">
          {items.map((item) => {
            const isDialogue = item.type === 'dialogue'
            return (
              <li
                key={item.runKey}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-glass-border/12 bg-glass/6 px-3.5 py-3"
              >
                <span
                  className={cn(
                    'shrink-0 grid place-items-center h-8 w-8 rounded-lg',
                    isDialogue ? 'bg-brand-magenta/12 text-brand-magenta' : 'bg-neon-green/12 text-neon-green',
                  )}
                >
                  {isDialogue ? <PhoneCall className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
                </span>

                <div className="flex-1 min-w-[10rem]">
                  <p className="text-[13px] font-medium text-text truncate">
                    {item.title || t('admin.simulations.ai_gen.bg_untitled')}
                  </p>
                  <p className="text-[11px] text-text-subtle flex items-center gap-1.5 mt-0.5">
                    <span>{t('admin.simulations.drafts.moments', { count: item.moments })}</span>
                    {!!item.at && (
                      <>
                        <span aria-hidden>·</span>
                        <Clock className="h-3 w-3" />
                        <span>{fmt.format(item.at)}</span>
                      </>
                    )}
                    {/* Sin respaldo en la base: solo existe mientras dure este navegador. */}
                    {!item.draftId && (
                      <Tooltip label={t('admin.simulations.drafts.local_only')}>
                        <span className="inline-flex items-center gap-1 text-brand-amber">
                          <CloudOff className="h-3 w-3" />
                          {t('admin.simulations.drafts.local_only_badge')}
                        </span>
                      </Tooltip>
                    )}
                  </p>
                </div>

                <div className="flex items-center gap-2 ml-auto">
                  <Button size="sm" onClick={() => handleOpen(item)}>
                    {t('admin.simulations.drafts.open')}
                  </Button>
                  <button
                    onClick={() => handleDiscard(item)}
                    aria-label={t('admin.simulations.drafts.discard_confirm')}
                    className="p-1.5 rounded-lg text-text-subtle hover:text-danger hover:bg-danger/8 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </FadeIn>
  )
}
