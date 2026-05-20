/**
 * Script de seed inicial para la campaña Abbott.
 * Migra el contenido hardcodeado de src/data/ a Supabase.
 *
 * Uso:
 *   1. Asegúrate de tener .env con VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY
 *      O usa la service_role key para saltar RLS:
 *      SUPABASE_SERVICE_ROLE_KEY=eyJ...
 *   2. npx tsx scripts/seed-abbott.ts
 *
 * Se puede ejecutar múltiples veces — usa upsert (no duplica).
 */

import { createClient } from '@supabase/supabase-js'
import { MODULES } from '../src/data/modules'
import { SCENARIOS } from '../src/data/scenarios'
import { CHOICE_SCENARIOS } from '../src/data/choiceScenarios'
import * as dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Faltan variables de entorno: VITE_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (o VITE_SUPABASE_ANON_KEY)')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function main() {
  console.log('🚀 Iniciando seed Abbott...\n')

  // 1. Crear o recuperar campaña Abbott
  const { data: existingCampaign } = await supabase
    .from('campaigns')
    .select('id')
    .eq('slug', 'abbott')
    .single()

  let campaignId: string

  if (existingCampaign) {
    campaignId = existingCampaign.id
    console.log(`✓ Campaña Abbott ya existe (id: ${campaignId})`)
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
    console.log(`✓ Campaña Abbott creada (id: ${campaignId})`)
  }

  // 2. Insertar módulos
  console.log('\n📚 Insertando módulos...')
  for (let i = 0; i < MODULES.length; i++) {
    const m = MODULES[i]

    const { data: moduleRow, error: moduleError } = await supabase
      .from('modules')
      .upsert({
        campaign_id: campaignId,
        slug: m.id,
        icon: m.icon,
        duration_min: m.duration,
        sort_order: i,
        title_es: m.title.es,
        title_en: m.title.en,
        title_pt: m.title.pt,
        subtitle_es: m.subtitle.es,
        subtitle_en: m.subtitle.en,
        subtitle_pt: m.subtitle.pt,
        objectives_es: m.objectives.es,
        objectives_en: m.objectives.en,
        objectives_pt: m.objectives.pt,
        key_takeaways_es: m.keyTakeaways.es,
        key_takeaways_en: m.keyTakeaways.en,
        key_takeaways_pt: m.keyTakeaways.pt,
        is_published: true,
      }, { onConflict: 'campaign_id,slug' })
      .select('id')
      .single()

    if (moduleError || !moduleRow) {
      console.error(`  ❌ Error módulo ${m.id}:`, moduleError?.message)
      continue
    }

    const moduleId = moduleRow.id

    // Eliminar secciones anteriores para re-insertar limpio
    await supabase.from('module_sections').delete().eq('module_id', moduleId)

    // Insertar secciones
    for (let j = 0; j < m.sections.length; j++) {
      const s = m.sections[j]

      const { data: sectionRow, error: sectionError } = await supabase
        .from('module_sections')
        .insert({
          module_id: moduleId,
          sort_order: j,
          heading_es: s.heading.es,
          heading_en: s.heading.en,
          heading_pt: s.heading.pt,
          body_es: s.body.es,
          body_en: s.body.en,
          body_pt: s.body.pt,
          callout_kind: s.callout?.kind ?? null,
          callout_es: s.callout?.text.es ?? null,
          callout_en: s.callout?.text.en ?? null,
          callout_pt: s.callout?.text.pt ?? null,
        })
        .select('id')
        .single()

      if (sectionError || !sectionRow) {
        console.error(`    ❌ Error sección ${j}:`, sectionError?.message)
        continue
      }

      // Insertar quiz si existe
      if (s.quiz) {
        const { error: quizError } = await supabase
          .from('section_quizzes')
          .upsert({
            section_id: sectionRow.id,
            question_es: s.quiz.question.es,
            question_en: s.quiz.question.en,
            question_pt: s.quiz.question.pt,
            options_es: s.quiz.options.es,
            options_en: s.quiz.options.en,
            options_pt: s.quiz.options.pt,
            correct_index: s.quiz.correct,
            explanation_es: s.quiz.explanation.es,
            explanation_en: s.quiz.explanation.en,
            explanation_pt: s.quiz.explanation.pt,
          }, { onConflict: 'section_id' })

        if (quizError) {
          console.error(`      ❌ Error quiz sección ${j}:`, quizError.message)
        }
      }
    }

    console.log(`  ✓ Módulo "${m.title.es}" (${m.sections.length} secciones)`)
  }

  // 3. Insertar escenarios de diálogo
  console.log('\n📞 Insertando escenarios...')
  for (const s of SCENARIOS) {
    const { error } = await supabase
      .from('scenarios')
      .upsert({
        campaign_id: campaignId,
        slug: s.id,
        country: s.country,
        difficulty: s.difficulty,
        title_es: s.title.es,
        title_en: s.title.en,
        title_pt: s.title.pt,
        summary_es: s.summary.es,
        summary_en: s.summary.en,
        summary_pt: s.summary.pt,
        customer_name: s.customer.name,
        customer_phone: s.customer.phone,
        customer_reason_es: s.customer.reason.es,
        customer_reason_en: s.customer.reason.en,
        customer_reason_pt: s.customer.reason.pt,
        avatar_seed: s.customer.avatarSeed,
        checklist_items: s.checklist,
        empathy_keywords: s.empathyKeywords,
        max_turns: s.maxTurns,
        start_node_id: s.start,
        nodes: s.nodes,
        is_published: true,
      }, { onConflict: 'campaign_id,slug' })

    if (error) {
      console.error(`  ❌ Error escenario ${s.id}:`, error.message)
    } else {
      console.log(`  ✓ Escenario "${s.title.es}"`)
    }
  }

  // 4. Insertar escenarios de elección
  console.log('\n🎮 Insertando choice scenarios...')
  for (const cs of CHOICE_SCENARIOS) {
    const { error } = await supabase
      .from('choice_scenarios')
      .upsert({
        campaign_id: campaignId,
        slug: cs.id,
        title_es: cs.title,
        description: cs.description,
        client_name: cs.clientName,
        client_company: cs.clientCompany,
        objective: cs.objective,
        level: cs.level,
        start_node_id: cs.startId,
        nodes: cs.nodes,
        is_published: true,
      }, { onConflict: 'campaign_id,slug' })

    if (error) {
      console.error(`  ❌ Error choice scenario ${cs.id}:`, error.message)
    } else {
      console.log(`  ✓ Choice scenario "${cs.title}"`)
    }
  }

  console.log('\n✅ Seed Abbott completado exitosamente!')
  console.log(`\n📊 Resumen:`)
  console.log(`   • ${MODULES.length} módulos`)
  console.log(`   • ${SCENARIOS.length} escenarios de diálogo`)
  console.log(`   • ${CHOICE_SCENARIOS.length} escenarios de elección`)
  console.log('\n💡 Próximo paso: crear un superadmin en Supabase Dashboard > Authentication > Users')
  console.log('   y actualizar su profiles.role = "superadmin" en la tabla profiles.\n')
}

main().catch((err) => {
  console.error('❌ Error fatal:', err)
  process.exit(1)
})
