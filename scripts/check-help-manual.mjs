#!/usr/bin/env node
/**
 * Verificador del manual del asistente de ayuda ("Guía").
 *
 * El manual (PLATFORM_MANUAL, en supabase/functions/help-chat/index.ts) le dice
 * al asistente qué pantallas existen y a qué ruta corresponde cada una. Ese texto
 * es fácil de desincronizar del código: cuando se agrega/renombra/elimina una
 * ruta, el manual queda mintiendo y el asistente da información falsa.
 *
 * Este script usa el CÓDIGO como fuente de verdad (los <Route> de App.tsx y
 * AdminRouter.tsx) y reporta dos tipos de desincronía:
 *   1) FANTASMA  — rutas que el manual menciona pero NO existen en el código.
 *   2) SIN DOCUMENTAR — rutas reales (destino de menú) que el manual NO menciona.
 *
 * Correr:  node scripts/check-help-manual.mjs   (o  npm run check:help)
 * Sale con código 1 si hay rutas fantasma (rompe CI); las no documentadas avisan.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(resolve(root, p), 'utf8')

// ── 1. Rutas reales del código ───────────────────────────────
function extractPaths(src) {
  const out = []
  const re = /path=["'`]([^"'`]+)["'`]/g
  let m
  while ((m = re.exec(src)) !== null) out.push(m[1])
  return out
}

const appSrc = read('src/App.tsx')
const adminSrc = read('src/admin/AdminRouter.tsx')

// Rutas del router principal (ya son absolutas: "/dashboard", "/courses/:slug"…)
const learnerRoutes = extractPaths(appSrc)
  .filter((p) => p.startsWith('/') && !p.includes('*'))

// Rutas del panel: son relativas a "/admin"; el index ("") es "/admin".
const adminRoutes = extractPaths(adminSrc).map((p) =>
  p === '' ? '/admin' : `/admin/${p}`.replace(/\/+/g, '/'),
)
// El index route de AdminRouter se declara con <Route index …> (sin path):
adminRoutes.push('/admin')

const realTemplates = [...new Set([...learnerRoutes, ...adminRoutes])]

// Rutas que son solo REDIRECT (<Navigate>): navegables pero no son "destino"
// propio, así que no exigimos que el manual las documente por su ruta.
const redirectPaths = new Set(
  [...adminSrc.matchAll(/path=["'`]([^"'`]+)["'`]\s+element=\{<Navigate/g)]
    .map((m) => (m[1] === '' ? '/admin' : `/admin/${m[1]}`.replace(/\/+/g, '/'))),
)
// Rutas públicas/de entrada que no tienen sentido en la ayuda al usuario logueado.
const NON_HELP = new Set(['/', '/login', '/verify/:certId'])

// ── 2. Rutas que el manual menciona ──────────────────────────
const edgeSrc = read('supabase/functions/help-chat/index.ts')
const start = edgeSrc.indexOf('PLATFORM_MANUAL = `')
if (start === -1) { console.error('No encontré PLATFORM_MANUAL en el edge function.'); process.exit(2) }
const manualBody = edgeSrc.slice(start + 'PLATFORM_MANUAL = `'.length)
const manual = manualBody.slice(0, manualBody.indexOf('`')) // el manual no usa backticks internos

// Placeholders de ejemplo que NO son rutas reales (aparecen en instrucciones).
const IGNORE = new Set(['/ruta', '/texto', '/'])

// Discriminador prosa vs ruta: una RUTA siempre empieza en un LÍMITE (inicio,
// espacio, "(", "→", "*", comilla, corchete). En cambio la prosa como "PDF/Word",
// "sol/luna" o "ordenar/clasificar" tiene una LETRA antes del "/". Así detectamos
// rutas inventadas aunque su nombre sea nuevo (p. ej. /panel-magico), sin ahogarnos
// en falsos positivos del texto.
const manualRoutes = [...new Set(
  [...manual.matchAll(/(^|[\s(→*"'`[>])(\/[a-zA-Z][a-zA-Z0-9/_:-]*)/g)]
    .map((m) => m[2].replace(/[.,;:)\]"'`]+$/, '')) // limpia puntuación final
    .filter((t) => !IGNORE.has(t)),
)]

// ── 3. Comparación (con soporte de :params como comodín) ─────
const segs = (p) => p.replace(/^\//, '').split('/').filter(Boolean)
function matches(token, template) {
  const a = segs(token), b = segs(template)
  if (a.length !== b.length) return false
  return b.every((s, i) => s.startsWith(':') || a[i].startsWith(':') || s === a[i])
}
const existsInCode = (token) => realTemplates.some((tpl) => matches(token, tpl))
const documentedInManual = (tpl) => manualRoutes.some((tok) => matches(tok, tpl))

const ghost = manualRoutes.filter((t) => !existsInCode(t)).sort()
// Rutas reales sin documentar: separamos las "de destino" de las de detalle (:param).
// Excluimos redirects y rutas públicas: no son destinos que la ayuda deba explicar.
const undocumented = realTemplates.filter(
  (t) => !documentedInManual(t) && !redirectPaths.has(t) && !NON_HELP.has(t),
)
const undocDest = undocumented.filter((t) => !t.includes(':')).sort()
const undocDetail = undocumented.filter((t) => t.includes(':')).sort()

// ── 4. Reporte ───────────────────────────────────────────────
const b = (s) => `\x1b[1m${s}\x1b[0m`
console.log(b('\n🔎 Verificación del manual del asistente de ayuda\n'))
console.log(`   Rutas reales en el código: ${realTemplates.length}`)
console.log(`   Rutas mencionadas en el manual: ${manualRoutes.length}\n`)

if (ghost.length) {
  console.log(b('❌ RUTAS FANTASMA (el manual las menciona pero NO existen):'))
  for (const r of ghost) console.log(`   ✗ ${r}`)
  console.log('   → El asistente puede mandar al usuario a una pantalla que no existe. Corrige el manual.\n')
} else {
  console.log('✅ Ninguna ruta fantasma: todo lo que el manual menciona existe en el código.\n')
}

if (undocDest.length) {
  console.log(b('⚠️  RUTAS DE DESTINO SIN DOCUMENTAR (existen pero el manual no las conoce):'))
  for (const r of undocDest) console.log(`   • ${r}`)
  console.log('   → El asistente no sabrá guiar hacia ellas. Considera agregarlas al manual.\n')
}

if (undocDetail.length) {
  console.log(`ℹ️  ${undocDetail.length} rutas de detalle con :param sin documentar (normal, no suelen ser destino):`)
  console.log(`   ${undocDetail.join('  ')}\n`)
}

if (ghost.length) {
  console.log(b('Resultado: FALLA — hay rutas fantasma que corregir.\n'))
  process.exit(1)
}
console.log(b('Resultado: OK — el manual está alineado con las rutas del código.\n'))
