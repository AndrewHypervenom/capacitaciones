/**
 * Alta de la gerencia LATAM (12 personas) en la campaña Piloto.
 *
 * Se hace por script y no por la carga masiva del panel porque esa ruta solo
 * guarda nombre, rol, campaña y cédula: el país (`country`) y el cargo
 * (`job_title`) se perderían y cada quien tendría que escribirlos en su perfil.
 *
 * Idempotente: quien ya tiene cuenta NO se recrea ni se le toca la contraseña;
 * solo se completan los campos vacíos del perfil.
 *
 *   node scripts/seed-gerentes-latam.mjs            # ensayo, no escribe nada
 *   node scripts/seed-gerentes-latam.mjs --apply    # ejecuta
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const APPLY = process.argv.includes('--apply')

/** Campaña destino: Piloto. */
const CAMPAIGN_ID = '40d4e14f-9cce-41ea-a0cd-b33b0e3f62dc'
const ROLE = 'learner'

const PEOPLE = [
  { email: 'nataliarbo@positivosmais.com',   name: 'Natalia Fernanda Huertas Rodríguez',   country: 'CO', job: 'Gerente de Operaciones PL',      nid: '1020762515' },
  { email: 'dianapgf@positivosmais.com',     name: 'Diana Paola Ramos Carrasco',           country: 'CO', job: 'Gerente de Proyectos PL',        nid: '52369625'   },
  { email: 'dianacfm@positivosmais.com',     name: 'Diana Carolina Fajardo Mora',          country: 'CO', job: 'Gerente Comercial',              nid: '53075496'   },
  { email: 'antoniofvd@positivosmais.com',   name: 'Antonio Fernando Vera Delgado',        country: 'CO', job: 'Gerente de Operaciones',         nid: '707992'     },
  { email: 'juanceg@positivosmais.com',      name: 'Juan Camilo Escobar Gutiérrez',        country: 'CO', job: 'Gerente de Operaciones JR',      nid: '71787230'   },
  { email: 'maironipm@positivosmais.com',    name: 'Mairon Iván Peña Motta',               country: 'CO', job: 'Gerente de TI SR',               nid: '80797822'   },
  { email: 'oscarca@positivosmais.com',      name: 'Oscar Carvajal Alarcón',               country: 'CO', job: 'Consultor de Preventa SR',       nid: '1024492802' },
  { email: 'oscaregv@positivosmais.com',     name: 'Oscar Edmundo Guillén Vázquez',        country: 'MX', job: 'Gerente de Operaciones',         nid: 'DCA00038'   },
  { email: 'ricardoahm@positivosmais.com',   name: 'Ricardo Alejandro Hernández Martínez', country: 'MX', job: 'Operations Manager',             nid: 'DCA00074'   },
  { email: 'juan.castro@positivosmais.com',  name: 'Juan Manuel Castro',                   country: 'AR', job: 'Gerente de Operaciones PL',      nid: '1041'       },
  { email: 'luis.mosti@positivosmais.com',   name: 'Luis Mosti',                           country: 'AR', job: 'Gerente de Operaciones Positivo', nid: '1048'      },
  { email: 'ramiro.goni@positivosmais.com',  name: 'Ramiro Goñi',                          country: 'AR', job: 'Gerente de Operaciones PL',      nid: '1095'       },
]

function readEnv() {
  const raw = fs.readFileSync(path.join(ROOT, '.env'), 'utf8')
  const out = {}
  for (const line of raw.split(/\r?\n/)) {
    const i = line.indexOf('=')
    if (i > 0 && !line.trimStart().startsWith('#')) out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}

const env = readEnv()
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

/** Contraseña predeterminada del sitio; si está apagada, aborta (no inventamos temporales aquí). */
async function defaultPassword() {
  const { data, error } = await sb.from('app_settings').select('value').eq('key', 'default_user_password').maybeSingle()
  if (error) throw error
  const v = data?.value
  if (!v?.enabled || !v?.password) return null
  return String(v.password)
}

async function findExisting(emails) {
  const wanted = new Set(emails)
  const found = new Map()
  for (let page = 1; page <= 40; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    for (const u of data.users) {
      const mail = (u.email ?? '').toLowerCase()
      if (wanted.has(mail)) found.set(mail, u.id)
    }
    if (data.users.length < 1000) break
  }
  return found
}

const password = await defaultPassword()
if (!password) {
  console.error('La contraseña predeterminada del sitio está desactivada. Actívala en /admin/users antes de correr esto.')
  process.exit(1)
}

const existing = await findExisting(PEOPLE.map((p) => p.email))
console.log(`${APPLY ? 'EJECUTANDO' : 'ENSAYO (sin escribir)'} · campaña Piloto · rol ${ROLE} · contraseña ${password}\n`)

for (const p of PEOPLE) {
  const already = existing.get(p.email)

  if (already) {
    // Ya tiene cuenta: no se toca la contraseña ni `onboarded`, solo se
    // completan los datos de ficha que falten.
    const { data: prof } = await sb
      .from('profiles')
      .select('display_name, country, job_title, national_id, campaign_id, role')
      .eq('id', already)
      .single()
    const patch = {}
    if (!prof?.country) patch.country = p.country
    if (!prof?.job_title) patch.job_title = p.job
    if (!prof?.national_id) patch.national_id = p.nid
    if (!Object.keys(patch).length) {
      console.log(`= ${p.email} — ya existe y está completo`)
      continue
    }
    if (APPLY) {
      const { error } = await sb.from('profiles').update(patch).eq('id', already)
      if (error) { console.log(`! ${p.email} — ${error.message}`); continue }
    }
    console.log(`~ ${p.email} — ya existe, completa ${Object.keys(patch).join(', ')}`)
    continue
  }

  if (!APPLY) {
    console.log(`+ ${p.email} — se crearía · ${p.name} · ${p.country} · ${p.job}`)
    continue
  }

  const { data: created, error: authErr } = await sb.auth.admin.createUser({
    email: p.email,
    password,
    email_confirm: true,
    user_metadata: { display_name: p.name },
  })
  if (authErr) { console.log(`! ${p.email} — ${authErr.message}`); continue }

  const { error: profErr } = await sb.from('profiles').upsert(
    {
      id: created.user.id,
      display_name: p.name,
      role: ROLE,
      campaign_id: CAMPAIGN_ID,
      country: p.country,
      job_title: p.job,
      national_id: p.nid,
      onboarded: false,
      is_active: true,
    },
    { onConflict: 'id' },
  )
  if (profErr) { console.log(`! ${p.email} — perfil: ${profErr.message}`); continue }

  // Misma credencial que muestra el panel en "Copiar credenciales"; el trigger
  // la borra sola cuando la persona termina su onboarding.
  const { error: credErr } = await sb
    .from('user_temp_credentials')
    .upsert({ user_id: created.user.id, email: p.email, temp_password: password }, { onConflict: 'user_id' })
  if (credErr) console.log(`  aviso: no se guardó la credencial de ${p.email}: ${credErr.message}`)

  console.log(`+ ${p.email} — creado · ${p.name} · ${p.country} · ${p.job}`)
}

console.log(APPLY ? '\nListo.' : '\nEnsayo terminado. Repite con --apply para ejecutar.')
