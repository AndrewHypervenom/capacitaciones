/* ────────────────────────────────────────────────────────────────────────────
   Secciones nuevas escritas con IA dentro de un módulo que YA existe.

   Es el hermano chico de `moduleAi.service`: aquel crea el módulo entero desde
   un documento; este agrega secciones a uno que ya está escrito, que es lo que
   pasa el 90% de las veces después del primer día (falta un tema, salió un
   procedimiento nuevo, el cliente pidió cubrir un caso más).

   Dos fuentes, nunca mezcladas — y esa es la regla del asunto:

   · SIN documento → la fuente es el propio módulo: sus objetivos y el texto de
     las secciones que ya tiene. Así la sección nueva habla el mismo idioma que
     las de al lado y no repite lo ya dicho.
   · CON documento → la fuente es SOLO ese documento (estilo NotebookLM). No se
     le pasa el contenido del módulo como material: si el capacitador adjunta un
     manual, la sección tiene que salir del manual, no de lo que el modelo cree
     saber ni de lo que el módulo ya decía. Los encabezados existentes sí van,
     pero como índice —"no repitas esto"—, no como material.

   Con documento se puede pedir MÁS de una sección: un manual de veinte páginas
   no cabe en una sola y partirlo es justamente lo que uno haría a mano.

   Todo corre en segundo plano y es cancelable. Cada sección se guarda apenas
   está lista: cancelar a la mitad deja lo escrito, no lo tira.
   ──────────────────────────────────────────────────────────────────────────── */

import i18n from '@/i18n'
import { bgTask } from '@/stores/bgTaskStore'
import { globalNavigate } from '@/lib/nav'
import {
  generateModuleOutline,
  generateModuleSection,
  type DocContext,
  type GeneratedModule,
} from '@/services/ai.service'
import { saveGeneratedSection } from '@/services/modules.service'
import { consumeAiOperation, isQuotaExceeded, refundAiOperation } from '@/services/aiQuota.service'
import { invalidateModulesCache } from '@/hooks/useModules'
import { getModuleSource } from '@/lib/courseSource'
import type { ExtractedDocument } from '@/lib/documentExtract'

/** Evento global emitido cada vez que una sección nueva queda guardada. */
export const SECTION_AI_CREATED_EVENT = 'module_ai_section_created'

/** Tope de secciones por tanda. Más que esto no es un módulo, es un curso. */
export const MAX_AI_SECTIONS = 12

export interface SectionAiInput {
  moduleId: string
  campaignId: string
  moduleTitle: string
  moduleSubtitle?: string | null
  objectives?: string[] | null
  /** Encabezados que el módulo ya tiene, en orden: el índice de "no repitas esto". */
  existingHeadings: string[]
  /** `sort_order` de la primera sección nueva (va al final del módulo). */
  startOrder: number
  /** Qué quiere el capacitador que cubra la sección. */
  instructions: string
  /** Documento adjunto. Si viene, es la ÚNICA fuente de contenido. */
  doc?: ExtractedDocument | null
  /** Cuántas secciones generar (1..MAX_AI_SECTIONS). */
  count: number
}

/** El encargo, tal como se lo contamos a la IA en las dos llamadas. */
function buildDescription(input: SectionAiInput, count: number): string {
  const { moduleTitle, moduleSubtitle, objectives, existingHeadings, instructions, doc } = input
  const lines = [
    `Vas a AMPLIAR un módulo de capacitación que YA existe: "${moduleTitle}"`
      + (moduleSubtitle ? ` (${moduleSubtitle})` : '') + '.',
  ]
  if (objectives?.length) lines.push(`Objetivos del módulo: ${objectives.join(' · ')}`)
  if (existingHeadings.length) {
    lines.push(
      'Secciones que el módulo YA tiene. NO las repitas ni las reescribas; lo nuevo va aparte:\n'
      + existingHeadings.map((h, i) => `${i + 1}. ${h}`).join('\n'),
    )
  }
  lines.push(
    count === 1
      ? `Escribe UNA sección nueva sobre: ${instructions}`
      : `Escribe ${count} secciones nuevas, complementarias entre sí, sobre: ${instructions}`,
  )
  if (doc) {
    lines.push(
      'El contenido sale ÚNICAMENTE del documento adjunto. No agregues nada que no esté ahí.',
    )
  }
  return lines.join('\n')
}

/**
 * Genera N secciones con IA y las agrega al final del módulo, en segundo plano.
 * Devuelve de inmediato: el avance (y el botón de cancelar) viven en el
 * indicador global de tareas.
 */
export function runSectionAiGeneration(input: SectionAiInput): void {
  const count = Math.max(1, Math.min(MAX_AI_SECTIONS, Math.round(input.count) || 1))
  const { id: taskId, signal } = bgTask.startCancelable(
    i18n.t('admin.section_ai.bg_title', { module: input.moduleTitle }),
    i18n.t('admin.section_ai.step_outline'),
  )

  // Una tanda con documento cuesta como un módulo; una sección suelta es una
  // ayuda puntual. El tipo se guarda para devolver lo mismo que se descontó.
  const kind = input.doc || count > 1 ? 'module' : 'assist'

  void (async () => {
    let saved = 0
    let charged = false
    /** Devuelve el cupo solo si se descontó y no se guardó nada. */
    const refundIfEmpty = async () => {
      if (charged && !saved) await refundAiOperation(kind).catch(() => {})
    }
    try {
      // El cupo se descuenta antes de gastar un token.
      await consumeAiOperation(
        kind,
        i18n.t('admin.section_ai.quota_label', { module: input.moduleTitle }),
        input.campaignId,
      )
      charged = true

      const description = buildDescription(input, count)

      // La fuente. Con documento manda el documento y NADA más (NotebookLM);
      // sin documento, el propio módulo es el material.
      let docContext: DocContext
      if (input.doc) {
        docContext = {
          documentText: input.doc.text,
          images: input.doc.images,
          contextImages: input.doc.contextImages,
          manualMode: false,
        }
      } else {
        const source = await getModuleSource(input.moduleId)
        docContext = { documentText: source.text }
      }
      const images = input.doc?.images ?? []

      if (signal.aborted) { await refundIfEmpty(); bgTask.markCanceled(taskId, i18n.t('bgtask.canceled')); return }

      // 1) Los títulos. Se pide el esquema aunque sea una sola sección: el
      // encabezado lo tiene que poner la IA leyendo la fuente, no nosotros
      // recortando la instrucción del capacitador.
      bgTask.update(taskId, { detail: i18n.t('admin.section_ai.step_outline') })
      // Aquí la cantidad NO se estima: el capacitador la eligió en el modal, así que el
      // rango va cerrado (min = max = count).
      const { data: outline } = await generateModuleOutline(
        { description, minSections: count, maxSections: count, targetSections: count, ...docContext },
        signal,
      )
      const planned = outline.sections.slice(0, count)
      if (!planned.length) {
        await refundIfEmpty()
        bgTask.fail(taskId, i18n.t('admin.section_ai.bg_no_sections'))
        return
      }

      // 2) El contenido, sección por sección. El índice y el total se cuentan
      // sobre el módulo COMPLETO (las viejas más las nuevas): así la IA sabe en
      // qué punto del recorrido está escribiendo.
      const allHeadings = [...input.existingHeadings, ...planned.map((h) => h.heading_es)]
      // Las secciones que ya existían no traen alcance (no salieron de este esquema): van
      // en blanco y solo cuentan como título a no repetir.
      const allScopes = [...input.existingHeadings.map(() => ''), ...planned.map((h) => h.scope ?? '')]
      const total = allHeadings.length
      let aborted = false

      for (let i = 0; i < planned.length; i++) {
        if (signal.aborted) { aborted = true; break }
        bgTask.update(taskId, {
          detail: i18n.t('admin.section_ai.step_section', { n: i + 1, total: planned.length }),
        })

        const h = planned[i]
        const genSection = () => generateModuleSection({
          description,
          moduleTitle: input.moduleTitle,
          moduleSubtitle: input.moduleSubtitle ?? undefined,
          objectives: input.objectives ?? undefined,
          sectionHeading: h.heading_es,
          sectionIndex: input.existingHeadings.length + i,
          totalSections: total,
          allHeadings,
          sectionScope: h.scope,
          allScopes,
          ...docContext,
        }, signal)

        let blocks: GeneratedModule['sections'][number]['blocks'] = []
        try {
          try {
            ;({ data: { blocks } } = await genSection())
          } catch (e) {
            if (signal.aborted || (e as Error)?.name === 'AbortError') throw e
            ;({ data: { blocks } } = await genSection()) // reintento único ante 429/500
          }
        } catch (e) {
          if (signal.aborted || (e as Error)?.name === 'AbortError') { aborted = true; break }
          continue // una sección caída no se lleva las demás
        }

        // Se guarda ya: cancelar después de esto no borra lo escrito.
        // `scope` es planificación interna: no se guarda con la sección.
        const { scope: _scope, ...heading } = h
        try {
          await saveGeneratedSection(
            input.campaignId,
            input.moduleId,
            { ...heading, blocks },
            input.startOrder + saved,
            images,
          )
          saved += 1
          invalidateModulesCache()
          window.dispatchEvent(
            new CustomEvent(SECTION_AI_CREATED_EVENT, { detail: { moduleId: input.moduleId } }),
          )
        } catch {
          /* si el guardado falla, seguimos con la siguiente */
        }
      }

      if (!saved) {
        await refundIfEmpty()
        if (aborted || signal.aborted) bgTask.markCanceled(taskId, i18n.t('bgtask.canceled'))
        else bgTask.fail(taskId, i18n.t('admin.section_ai.bg_no_sections'))
        return
      }

      const action = {
        label: i18n.t('admin.section_ai.bg_open_module'),
        run: () => globalNavigate(`/admin/modules/${input.moduleId}`),
      }
      const detail = i18n.t('admin.section_ai.bg_done', { count: saved })
      if (aborted || signal.aborted) {
        bgTask.markCanceled(taskId, { detail, incomplete: true, action })
      } else {
        bgTask.succeed(taskId, { detail, action })
      }
    } catch (e) {
      await refundIfEmpty()
      if (isQuotaExceeded(e)) {
        bgTask.fail(taskId, i18n.t('admin.ai_limits.blocked_task'))
      } else if (signal.aborted || (e as Error)?.name === 'AbortError') {
        bgTask.markCanceled(taskId, i18n.t('bgtask.canceled'))
      } else {
        bgTask.fail(taskId, (e as Error).message || i18n.t('admin.section_ai.bg_no_sections'))
      }
    }
  })()
}
