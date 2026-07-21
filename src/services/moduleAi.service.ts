import i18n from '@/i18n'
import { bgTask } from '@/stores/bgTaskStore'
import { globalNavigate } from '@/lib/nav'
import {
  generateModuleOutline,
  generateModuleSection,
  detectCaptures,
  type GeneratedModule,
} from '@/services/ai.service'
import { saveGeneratedModule } from '@/services/modules.service'
import { addModuleToCourse } from '@/services/courses.service'
import { invalidateModulesCache } from '@/hooks/useModules'
import { cropCaptures, suggestModuleSectionCount, type ExtractedDocument, type ExtractedImage } from '@/lib/documentExtract'

/** Evento global emitido al terminar de generar un módulo con IA en segundo plano. */
export const MODULE_AI_CREATED_EVENT = 'module_ai_created'

export interface ModuleAiInput {
  campaignId: string
  /** Instrucciones opcionales para la IA (si vacío, se usa una por defecto). */
  instructions: string
  doc: ExtractedDocument
  manualMode: boolean
  /** Si el módulo debe adjuntarse a un curso al terminar. */
  course?: { id: string; nextOrder: number } | null
}

/**
 * Genera un módulo con IA (documento → esquema → secciones → guardar borrador) en
 * SEGUNDO PLANO y CANCELABLE. No bloquea la UI: el avance se ve en el indicador
 * global. Al terminar guarda el módulo como borrador y ofrece "Editar módulo".
 *
 * Al cancelar conserva lo generado: si hay ≥1 sección, guarda el módulo (borrador)
 * marcado como incompleto; si no hay nada, no guarda nada.
 */
export function runModuleAiGeneration(input: ModuleAiInput): void {
  const { campaignId, doc, manualMode } = input
  const { id: taskId, signal } = bgTask.startCancelable(
    i18n.t('admin.import.bg_title', { name: doc.fileName }),
    i18n.t('admin.import.step_outline'),
  )

  void (async () => {
    try {
      const description = input.instructions.trim()
        || `Crea un módulo de formación a partir del documento "${doc.fileName}". `
          + 'Usa únicamente el conocimiento presente en el documento, sin inventar contenido.'

      // Modo manual + PDF escaneado: localizar y recortar capturas relevantes.
      let images: ExtractedImage[] = doc.images
      const isScanned = manualMode && !doc.text.trim() && doc.contextImages.length > 0
      if (isScanned) {
        bgTask.update(taskId, { detail: i18n.t('admin.import.step_captures') })
        try {
          const { data } = await detectCaptures({ contextImages: doc.contextImages }, signal)
          const crops = await cropCaptures(doc.contextImages, data)
          if (crops.length) images = crops
        } catch (e) {
          if (signal.aborted || (e as Error)?.name === 'AbortError') { bgTask.markCanceled(taskId, i18n.t('bgtask.canceled')); return }
          /* si la detección/recorte falla, seguimos con lo que haya */
        }
      }

      const docContext = { documentText: doc.text, images, contextImages: doc.contextImages, manualMode }

      // 1) Esquema. La cantidad de secciones se dimensiona al documento (un manual largo
      // se divide en más secciones digeribles → ninguna revienta el techo de tokens).
      bgTask.update(taskId, { detail: i18n.t('admin.import.step_outline') })
      const targetSections = suggestModuleSectionCount(doc)
      const { data: outline } = await generateModuleOutline({ description, targetSections, ...docContext }, signal)
      const headings = outline.sections.map((h) => h.heading_es)

      // 2) Cada sección por separado, con UN reintento ante fallo transitorio (429/500) para
      // no perder una sección entera (antes se descartaba en silencio → faltaba información).
      const sections: GeneratedModule['sections'] = []
      let aborted = false
      for (let s = 0; s < outline.sections.length; s++) {
        if (signal.aborted) { aborted = true; break }
        bgTask.update(taskId, {
          detail: i18n.t('admin.import.step_section', { n: s + 1, total: outline.sections.length }),
        })
        const h = outline.sections[s]
        const genSection = () => generateModuleSection({
          description,
          moduleTitle: outline.metadata.title_es,
          moduleSubtitle: outline.metadata.subtitle_es,
          objectives: outline.metadata.objectives_es,
          sectionHeading: h.heading_es,
          sectionIndex: s,
          totalSections: outline.sections.length,
          allHeadings: headings,
          ...docContext,
        }, signal)
        try {
          let data
          try {
            ;({ data } = await genSection())
          } catch (e) {
            if (signal.aborted || (e as Error)?.name === 'AbortError') throw e
            ;({ data } = await genSection()) // reintento único
          }
          sections.push({ ...h, blocks: data.blocks })
        } catch (e) {
          if (signal.aborted || (e as Error)?.name === 'AbortError') { aborted = true; break }
          /* si una sección falla tras el reintento (no por cancelación), se omite y seguimos */
        }
      }

      if (!sections.length) {
        if (aborted || signal.aborted) bgTask.markCanceled(taskId, i18n.t('bgtask.canceled'))
        else bgTask.fail(taskId, i18n.t('admin.import.bg_no_sections'))
        return
      }

      const incomplete = aborted || signal.aborted
      const metadata = incomplete
        ? { ...outline.metadata, title_es: `${outline.metadata.title_es} (${i18n.t('bgtask.incomplete_badge')})` }
        : outline.metadata
      const generated: GeneratedModule = { metadata, sections }

      // 3) Guardar el módulo (borrador) y, si viene de un curso, adjuntarlo.
      bgTask.update(taskId, { detail: i18n.t('admin.import.step_saving') })
      const moduleId = await saveGeneratedModule(campaignId, generated, images)
      if (input.course) {
        try { await addModuleToCourse(input.course.id, moduleId, input.course.nextOrder) } catch { /* módulo queda creado igual */ }
      }
      invalidateModulesCache()

      const action = {
        label: i18n.t('admin.import.bg_open_module'),
        run: () => globalNavigate(`/admin/modules/${moduleId}`),
      }
      if (incomplete) {
        bgTask.markCanceled(taskId, { detail: i18n.t('bgtask.canceled_incomplete'), incomplete: true, action })
      } else {
        bgTask.succeed(taskId, { detail: i18n.t('admin.import.bg_done'), action })
      }
      window.dispatchEvent(
        new CustomEvent(MODULE_AI_CREATED_EVENT, { detail: { campaignId, courseId: input.course?.id ?? null, moduleId } }),
      )
    } catch (e) {
      if (signal.aborted || (e as Error)?.name === 'AbortError') {
        bgTask.markCanceled(taskId, i18n.t('bgtask.canceled'))
      } else {
        bgTask.fail(taskId, (e as Error).message || i18n.t('admin.import.bg_no_sections'))
      }
    }
  })()
}
