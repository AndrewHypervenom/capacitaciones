/**
 * Lee los 3 archivos .docx de la raíz del proyecto y sube su contenido
 * completo a Supabase como módulos y secciones.
 *
 * Uso: npx tsx scripts/seed-from-words.ts
 *
 * Estructura de cada módulo:
 *  - Un módulo por documento Word
 *  - Secciones determinadas por headings en MAYÚSCULAS (H1 all-caps)
 *  - El resto del contenido (H1 mixto + párrafos + listas + tablas)
 *    va al cuerpo de la sección actual
 */

import { createClient } from '@supabase/supabase-js'
import mammoth from 'mammoth'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import * as dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Faltan variables: VITE_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

// ─── Documentos a procesar ────────────────────────────────────

const DOCS = [
  {
    file: 'Manual CC Abbott (Colom + Mx).docx',
    moduleTitle: 'Manual Call Center Abbott — Colombia y México',
    slug: 'manual-colombia-mexico',
    icon: 'Phone',
    duration: 45,
  },
  {
    file: 'Manual CC Abbott Argentina 28 01 2025.docx',
    moduleTitle: 'Manual Call Center Abbott — Argentina',
    slug: 'manual-argentina',
    icon: 'Phone',
    duration: 40,
  },
  {
    file: 'Repaso guardia sábado 21 01 25.docx',
    moduleTitle: 'Repaso Guardia — Fin de Semana',
    slug: 'repaso-guardia',
    icon: 'BookOpen',
    duration: 15,
  },
]

// ─── Tipos locales ────────────────────────────────────────────

interface ParsedSection {
  heading: string
  body: string[]
  calloutKind?: 'tip' | 'important'
  calloutText?: string
}

// ─── Helpers ──────────────────────────────────────────────────

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').trim()
}

function isAllCaps(text: string): boolean {
  const letters = text.replace(/[^a-zA-ZÁÉÍÓÚáéíóúÑñ]/g, '')
  if (letters.length < 3) return false
  const upper = text.replace(/[^A-ZÁÉÍÓÚÑ]/g, '')
  return upper.length / letters.length >= 0.75
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60)
}

function detectCallout(text: string): { kind: 'tip' | 'important'; text: string } | null {
  const lower = text.toLowerCase()
  if (
    lower.startsWith('tip:') ||
    lower.startsWith('nota:') ||
    lower.startsWith('note:') ||
    lower.startsWith('nota importante:')
  ) {
    return {
      kind: 'tip',
      text: text.replace(/^(tip|nota importante|nota|note):\s*/i, '').trim(),
    }
  }
  if (
    lower.startsWith('importante:') ||
    lower.startsWith('important:') ||
    lower.startsWith('⚠') ||
    lower.startsWith('atención:') ||
    lower.startsWith('atencion:') ||
    text === 'IMPORTANTE'
  ) {
    return {
      kind: 'important',
      text: text.replace(/^(importante|important|atención|atencion):\s*/i, '').trim(),
    }
  }
  return null
}

// ─── Parser de HTML a secciones ───────────────────────────────

function parseHtmlToSections(html: string): ParsedSection[] {
  const sections: ParsedSection[] = []
  let current: ParsedSection | null = null

  // Extraer todos los bloques del HTML (h1, p, li, table rows)
  const blockRe = /<(h1|p|li|tr|ul|ol|table)[^>]*>([\s\S]*?)<\/\1>/gi
  let match: RegExpExecArray | null

  while ((match = blockRe.exec(html)) !== null) {
    const tag = match[1].toLowerCase()
    const inner = match[2]
    const text = stripTags(inner).replace(/\s+/g, ' ').trim()

    if (!text || text === ' ') continue

    if (tag === 'h1') {
      if (isAllCaps(text)) {
        // Nueva sección principal
        if (current) sections.push(current)
        current = { heading: text, body: [] }
      } else {
        // Sub-heading → va al cuerpo de la sección actual como línea destacada
        if (!current) {
          current = { heading: text, body: [] }
        } else {
          const callout = detectCallout(text)
          if (callout && !current.calloutText) {
            current.calloutKind = callout.kind
            current.calloutText = callout.text
          } else {
            current.body.push(text)
          }
        }
      }
    } else if (tag === 'p') {
      if (!current) current = { heading: 'Contenido', body: [] }
      if (!text) continue
      const callout = detectCallout(text)
      if (callout && !current.calloutText) {
        current.calloutKind = callout.kind
        current.calloutText = callout.text
      } else {
        current.body.push(text)
      }
    } else if (tag === 'li') {
      if (!current) current = { heading: 'Contenido', body: [] }
      current.body.push(`• ${text}`)
    } else if (tag === 'tr') {
      if (!current) current = { heading: 'Tabla', body: [] }
      // Extraer celdas de la fila
      const cells = [...inner.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
        .map(c => stripTags(c[1]).replace(/\s+/g, ' ').trim())
        .filter(Boolean)
      if (cells.length > 0) current.body.push(cells.join(' | '))
    }
  }

  if (current) sections.push(current)

  // Filtrar secciones completamente vacías
  return sections.filter(s => s.body.length > 0 || s.calloutText || s.heading)
}

// ─── Main ─────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Iniciando seed desde archivos Word...\n')

  // Obtener o crear campaña Abbott
  const { data: existing } = await supabase
    .from('campaigns')
    .select('id')
    .eq('slug', 'abbott')
    .single()

  let campaignId: string

  if (existing) {
    campaignId = existing.id
    console.log(`✓ Campaña Abbott (id: ${campaignId})\n`)
  } else {
    const { data: newCampaign, error } = await supabase
      .from('campaigns')
      .insert({
        slug: 'abbott',
        name: 'Abbott Diagnostics',
        description: 'Soporte técnico Call Center Abbott — Colombia, México y Argentina',
        is_active: true,
      })
      .select('id')
      .single()

    if (error || !newCampaign) {
      console.error('❌ Error creando campaña:', error?.message)
      process.exit(1)
    }
    campaignId = newCampaign.id
    console.log(`✓ Campaña Abbott creada (id: ${campaignId})\n`)
  }

  // Procesar cada documento Word
  for (let docIdx = 0; docIdx < DOCS.length; docIdx++) {
    const docDef = DOCS[docIdx]
    const filePath = resolve(process.cwd(), docDef.file)

    console.log(`📄 Procesando: ${docDef.file}`)

    let html: string
    try {
      const buffer = readFileSync(filePath)
      const result = await mammoth.convertToHtml({ buffer })
      html = result.value
      if (result.messages.length > 0) {
        const warns = result.messages.filter(m => m.type === 'warning')
        if (warns.length) console.log(`   ⚠ ${warns.length} advertencias de conversión`)
      }
    } catch (err: unknown) {
      console.error(`   ❌ No se pudo leer: ${err instanceof Error ? err.message : err}`)
      continue
    }

    const sections = parseHtmlToSections(html)
    console.log(`   → ${sections.length} secciones encontradas`)

    // Upsert módulo
    const { data: moduleRow, error: moduleError } = await supabase
      .from('modules')
      .upsert(
        {
          campaign_id: campaignId,
          slug: docDef.slug,
          icon: docDef.icon,
          duration_min: docDef.duration,
          sort_order: docIdx,
          title_es: docDef.moduleTitle,
          objectives_es: [],
          key_takeaways_es: [],
          is_published: true,
        },
        { onConflict: 'campaign_id,slug' },
      )
      .select('id')
      .single()

    if (moduleError || !moduleRow) {
      console.error(`   ❌ Error creando módulo:`, moduleError?.message)
      continue
    }

    // Eliminar secciones anteriores (re-seed limpio)
    await supabase.from('module_sections').delete().eq('module_id', moduleRow.id)

    // Insertar secciones
    let insertedSections = 0
    for (let sIdx = 0; sIdx < sections.length; sIdx++) {
      const sec = sections[sIdx]

      const { data: sectionRow, error: sectionError } = await supabase
        .from('module_sections')
        .insert({
          module_id: moduleRow.id,
          sort_order: sIdx,
          heading_es: sec.heading,
          body_es: sec.body,
          callout_kind: sec.calloutKind ?? null,
          callout_es: sec.calloutText ?? null,
        })
        .select('id')
        .single()

      if (sectionError || !sectionRow) {
        console.error(`   ❌ Error sección "${sec.heading}":`, sectionError?.message)
        continue
      }
      insertedSections++
    }

    console.log(`   ✅ Módulo creado: "${docDef.moduleTitle}" (${insertedSections} secciones)\n`)
  }

  console.log('✅ Seed completado desde archivos Word.')
  console.log('   Los 3 manuales están ahora en la base de datos.')
  console.log('   Podés editarlos en /admin/modules')
}

main().catch((err) => {
  console.error('❌ Error fatal:', err)
  process.exit(1)
})
