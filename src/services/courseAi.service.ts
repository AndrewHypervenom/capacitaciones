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
import { createCourse, addModuleToCourse } from '@/services/courses.service'
import { consumeAiOperation, isQuotaExceeded, refundAiOperation } from '@/services/aiQuota.service'
import { invalidateModulesCache } from '@/hooks/useModules'
import { cropCaptures, suggestModuleSectionRange, type ExtractedDocument, type ExtractedImage } from '@/lib/documentExtract'

/** Evento global emitido al terminar una creación de curso con IA en segundo plano. */
export const COURSE_AI_CREATED_EVENT = 'course_ai_created'

export interface CourseAiInput {
  campaignId: string
  title: string
  /** Documento completo extraído (texto + figuras + páginas de contexto). */
  doc: ExtractedDocument
  /** Modo manual paso a paso: máxima fidelidad a un procedimiento con capturas. */
  manualMode: boolean
}

/**
 * Crea un curso con IA (documento → 1 módulo → curso, todo en borrador) como un
 * proceso en SEGUNDO PLANO y CANCELABLE: se apoya en el `bgTaskStore` global
 * (indicador visible en todo el sitio, con botón Cancelar) y no depende del ciclo
 * de vida de ningún componente, así que sigue aunque el usuario cierre el modal o
 * navegue a otra vista.
 *
 * Al cancelar conserva lo generado hasta el momento: si hay ≥1 sección, crea el
 * curso/módulo en borrador marcado como "(incompleto)"; si no hay nada, no crea
 * nada. Reporta éxito/incompleto/error en el indicador y ofrece "Abrir curso".
 */
export function runCourseAiGeneration(input: CourseAiInput): void {
  const { campaignId, doc, manualMode } = input
  const description = input.title.trim()
  const { id: taskId, signal } = bgTask.startCancelable(
    i18n.t('admin.courses.ai_bg_title', { title: description }),
    i18n.t('admin.courses.ai_step_outline'),
  )

  void (async () => {
    try {
      // Cupo diario: se descuenta antes de gastar tokens.
      await consumeAiOperation('module', description, campaignId)

      // Modo manual + PDF escaneado (solo imágenes, sin texto): localizar y recortar
      // las capturas relevantes de las páginas renderizadas para insertarlas.
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

      const docContext = {
        documentText: doc.text || undefined,
        images: images.length ? images : undefined,
        contextImages: doc.contextImages.length ? doc.contextImages : undefined,
        manualMode,
      }

      // 1) Esquema del módulo. La cantidad de secciones se dimensiona al documento: un
      // RANGO (corto → pocas secciones; largo → más) dentro del cual decide la IA según los
      // subtemas reales. Ni infla el temario repitiendo, ni empaca medio documento en una.
      const sectionRange = suggestModuleSectionRange(doc)
      const { data: outline } = await generateModuleOutline(
        {
          description,
          minSections: sectionRange.min,
          maxSections: sectionRange.max,
          targetSections: sectionRange.max, // compatibilidad con la función aún desplegada
          ...docContext,
        },
        signal,
      )
      const headings = outline.sections.map((h) => h.heading_es)
      // El alcance que el esquema le dio a cada sección: se le pasa a TODAS las llamadas
      // para que cada sección sepa qué le toca y qué ya cubre otra (así no se repiten).
      const scopes = outline.sections.map((h) => h.scope ?? '')

      // 2) Cada sección por separado, con UN reintento ante fallo transitorio (429/500).
      // Si se cancela, cortamos y guardamos lo hecho.
      const sections: GeneratedModule['sections'] = []
      let aborted = false
      for (let s = 0; s < outline.sections.length; s++) {
        if (signal.aborted) { aborted = true; break }
        bgTask.update(taskId, {
          detail: i18n.t('admin.courses.ai_step_section', { n: s + 1, total: outline.sections.length }),
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
          sectionScope: h.scope,
          allScopes: scopes,
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
          // `scope` es planificación interna: no se guarda con la sección.
          const { scope: _scope, ...heading } = h
          sections.push({ ...heading, blocks: data.blocks })
        } catch (e) {
          if (signal.aborted || (e as Error)?.name === 'AbortError') { aborted = true; break }
          /* si una sección falla tras el reintento (no por cancelación), se omite y seguimos */
        }
      }

      // Sin ninguna sección: nada que guardar, y el cupo se devuelve.
      if (!sections.length) {
        await refundAiOperation('module')
        if (aborted || signal.aborted) bgTask.markCanceled(taskId, i18n.t('bgtask.canceled'))
        else bgTask.fail(taskId, i18n.t('admin.courses.ai_no_sections'))
        return
      }

      const incomplete = aborted || signal.aborted
      const generated: GeneratedModule = { metadata: outline.metadata, sections }

      // 3) Crear el curso (borrador) y engancharle el módulo (borrador).
      bgTask.update(taskId, { detail: i18n.t('admin.courses.ai_step_course') })
      const titleToSave = incomplete ? `${description} (${i18n.t('bgtask.incomplete_badge')})` : description
      const course = await createCourse(campaignId, { title_es: titleToSave, description_es: null })
      const moduleId = await saveGeneratedModule(campaignId, generated, images)
      await addModuleToCourse(course.id, moduleId, 1)
      invalidateModulesCache()

      const action = {
        label: i18n.t('admin.courses.ai_open_course'),
        run: () => globalNavigate(`/admin/courses/${course.id}`),
      }
      if (incomplete) {
        bgTask.markCanceled(taskId, { detail: i18n.t('bgtask.canceled_incomplete'), incomplete: true, action })
      } else {
        bgTask.succeed(taskId, { detail: i18n.t('admin.courses.ai_bg_done', { title: description }), action })
      }
      window.dispatchEvent(
        new CustomEvent(COURSE_AI_CREATED_EVENT, { detail: { campaignId, courseId: course.id } }),
      )
    } catch (e) {
      if (isQuotaExceeded(e)) {
        bgTask.fail(taskId, i18n.t('admin.ai_limits.blocked_task'))
      } else if (signal.aborted || (e as Error)?.name === 'AbortError') {
        bgTask.markCanceled(taskId, i18n.t('bgtask.canceled'))
      } else {
        bgTask.fail(taskId, (e as Error).message || i18n.t('admin.courses.ai_created_error'))
      }
    }
  })()
}
