#!/usr/bin/env node
/**
 * Aplica en el SERVIDOR la configuración de autenticación del proyecto:
 *
 *   1. Política de contraseña (longitud mínima, caracteres obligatorios y
 *      rechazo de contraseñas filtradas). Hasta ahora la política solo la
 *      validaba el navegador; esto la vuelve obligatoria también para quien
 *      llame la API directamente.
 *   2. La plantilla corporativa del correo de restablecimiento y su asunto.
 *   3. La URL de retorno (/reset-password) en la lista blanca de redirecciones.
 *
 * Uso:
 *   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/apply-auth-config.mjs
 *   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/apply-auth-config.mjs --dry-run
 *
 * El token se genera en https://supabase.com/dashboard/account/tokens
 * (es el token de la Management API, distinto del service_role).
 *
 * Cuando el proyecto se mude a Supabase auto-hospedado en AWS, este script deja
 * de aplicar: allí la misma configuración son variables de entorno de GoTrue.
 * Están documentadas en docs/correo-restablecer-contrasena.md.
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dry = process.argv.includes('--dry-run')

const bold = (s) => `\u001b[1m${s}\u001b[0m`
const green = (s) => `\u001b[32m${s}\u001b[0m`
const red = (s) => `\u001b[31m${s}\u001b[0m`
const dim = (s) => `\u001b[2m${s}\u001b[0m`

const token = process.env.SUPABASE_ACCESS_TOKEN
if (!token) {
  console.error(red('Falta SUPABASE_ACCESS_TOKEN.'))
  console.error('Genera uno en https://supabase.com/dashboard/account/tokens y vuelve a ejecutar:')
  console.error(dim('  SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/apply-auth-config.mjs'))
  process.exit(1)
}

/* ── Datos del proyecto: se deducen del .env para no repetirlos ───────────── */
let env = ''
try {
  env = readFileSync(resolve(root, '.env'), 'utf8')
} catch {
  console.error(red('No encontré el archivo .env en la raíz del proyecto.'))
  process.exit(1)
}

const supabaseUrl = /VITE_SUPABASE_URL\s*=\s*(.+)/.exec(env)?.[1]?.trim()
const ref = supabaseUrl && /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(supabaseUrl)?.[1]
if (!ref) {
  console.error(red('No pude deducir la referencia del proyecto desde VITE_SUPABASE_URL.'))
  process.exit(1)
}

// El dominio público del sitio: de él dependen la redirección permitida y la
// URL del logo dentro del correo. Se puede sobrescribir con SITE_URL, útil
// cuando se apunte al dominio propio o al despliegue en AWS.
const siteUrl = (process.env.SITE_URL ?? 'https://capacitaciones-chi.vercel.app').replace(/\/$/, '')

const template = readFileSync(resolve(root, 'public/email/reset-password.html'), 'utf8')

/* ── Lo que queremos dejar configurado ───────────────────────────────────── */
const desired = {
  // 12 caracteres = PASSWORD_MIN_LENGTH en src/lib/password.ts. Si cambias uno,
  // cambia el otro: si el servidor pide menos, la política deja de ser real.
  password_min_length: 12,
  // Minúsculas : mayúsculas : dígitos : símbolos (las cuatro clases).
  // La API solo acepta uno de sus valores EXACTOS, incluida la barra invertida
  // doble del conjunto de símbolos. Se arma con String.raw para que ningún
  // escapado de JavaScript lo altere por el camino: con una sola barra, la API
  // responde 400 "Invalid option".
  password_required_characters: String.raw`abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789:!@#$%^&*()_+-=[]{};'\\:"|<>?,./` + '`~',
  // Rechaza contraseñas que aparecen en filtraciones conocidas (HaveIBeenPwned).
  password_hibp_enabled: true,

  mailer_subjects_recovery: 'Restablece tu contraseña · LearningAI',
  mailer_templates_recovery_content: template,
}

const API = `https://api.supabase.com/v1/projects/${ref}/config/auth`
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

async function main() {
  console.log(bold(`\n🔐 Configuración de autenticación · proyecto ${ref}\n`))

  const current = await fetch(API, { headers }).then(async (r) => {
    if (!r.ok) throw new Error(`GET config falló (${r.status}): ${await r.text()}`)
    return r.json()
  })

  // La lista blanca se MEZCLA, nunca se reemplaza: borrar una entrada existente
  // rompería en silencio algún otro flujo que dependa de ella.
  const existing = (current.uri_allow_list ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const needed = [`${siteUrl}/reset-password`, 'http://localhost:5173/reset-password']
  const merged = [...new Set([...existing, ...needed])]
  const payload = { ...desired, uri_allow_list: merged.join(',') }

  const rows = [
    ['Longitud mínima', current.password_min_length, payload.password_min_length],
    ['Caracteres obligatorios', current.password_required_characters ? 'sí' : 'no', 'las 4 clases'],
    ['Rechazar filtradas (HIBP)', current.password_hibp_enabled ? 'sí' : 'no', 'sí'],
    ['Asunto del correo', current.mailer_subjects_recovery || '(por defecto)', payload.mailer_subjects_recovery],
    [
      'Plantilla del correo',
      current.mailer_templates_recovery_content ? `${current.mailer_templates_recovery_content.length} car.` : '(la de Supabase)',
      `${template.length} car.`,
    ],
    ['Redirecciones permitidas', `${existing.length}`, `${merged.length}`],
  ]
  for (const [label, from, to] of rows) {
    const changed = String(from) !== String(to)
    console.log(`  ${changed ? green('•') : dim('•')} ${label.padEnd(26)} ${dim(String(from))} → ${changed ? green(String(to)) : String(to)}`)
  }

  if (dry) {
    console.log(bold('\nSimulación: no se envió nada.\n'))
    return
  }

  let res = await fetch(API, { method: 'PATCH', headers, body: JSON.stringify(payload) })

  // El rechazo de contraseñas filtradas (HaveIBeenPwned) es una función de pago.
  // En un proyecto Free la API devuelve 402 y rechaza el lote COMPLETO. Antes de
  // dejar el resto sin aplicar —que es lo importante— reintentamos sin ella.
  if (res.status === 402 && /HaveIBeenPwned/i.test(await res.clone().text())) {
    console.log(dim('\n  ⚠ El rechazo de contraseñas filtradas requiere plan Pro: se omite.'))
    delete payload.password_hibp_enabled
    res = await fetch(API, { method: 'PATCH', headers, body: JSON.stringify(payload) })
  }

  if (!res.ok) throw new Error(`PATCH config falló (${res.status}): ${await res.text()}`)

  console.log(bold(green('\n✅ Configuración aplicada.\n')))
  console.log('Recuerda que el envío real de correo sigue dependiendo de un SMTP propio')
  console.log(dim('(Authentication → SMTP Settings). Ver docs/correo-restablecer-contrasena.md\n'))
}

main().catch((err) => {
  console.error(red(`\n✖ ${err.message}\n`))
  process.exit(1)
})
