/**
 * Política de contraseñas de la plataforma.
 *
 * Se evalúa 100% en el cliente para dar retroalimentación inmediata, pero NO es
 * la única defensa: Supabase Auth aplica su propio mínimo en el servidor y el
 * cambio real siempre pasa por `auth.updateUser`. Aquí subimos el listón por
 * encima del mínimo de Supabase (8) porque la mayoría de las cuentas nacen con
 * una contraseña predeterminada compartida y el restablecimiento es justo el
 * momento en que conviene exigir algo serio.
 *
 * Las reglas devuelven ids estables (no textos) para que la UI los traduzca:
 * cambiar de idioma no debe cambiar la lógica.
 */

export const PASSWORD_MIN_LENGTH = 12
/** Supabase corta en 72 bytes (bcrypt); avisamos antes de que el servidor falle. */
export const PASSWORD_MAX_LENGTH = 72

export type PasswordRuleId =
  | 'length'
  | 'case'
  | 'number'
  | 'symbol'
  | 'no_pattern'
  | 'no_personal'

export interface PasswordRule {
  id: PasswordRuleId
  ok: boolean
}

export type PasswordStrength = 'weak' | 'fair' | 'good' | 'strong'

export interface PasswordVerdict {
  rules: PasswordRule[]
  /** Todas las reglas cumplidas: condición para poder enviar el formulario. */
  valid: boolean
  /** 0–100, solo para la barra visual. */
  score: number
  strength: PasswordStrength
}

/**
 * Contraseñas y raíces demasiado usadas. No pretende ser exhaustiva (eso es
 * trabajo del servidor con HIBP); cubre lo que de verdad aparece en un equipo
 * de contact center hispanohablante: nombre del producto, teclado, fechas.
 */
const COMMON_ROOTS = [
  'password', 'contrasena', 'contraseña', 'clave', 'secreto', 'admin', 'administrador',
  'qwerty', 'asdf', 'zxcv', 'iloveyou', 'welcome', 'bienvenido', 'letmein',
  'learningai', 'positivo', 'capacitacion', 'capacitaciones', 'academia',
  'colombia', 'mexico', 'argentina', 'bogota', 'medellin',
  'usuario', 'invitado', 'temporal', 'cambiame', 'abc123', 'monkey', 'dragon',
]

/** Filas del teclado para detectar recorridos tipo `qwertyui` o `asdfghj`. */
const KEYBOARD_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1234567890']

/** Detecta 4+ caracteres consecutivos iguales, ascendentes o descendentes. */
function hasRun(value: string): boolean {
  const lower = value.toLowerCase()
  let same = 1
  let asc = 1
  let desc = 1
  for (let i = 1; i < lower.length; i++) {
    const prev = lower.charCodeAt(i - 1)
    const curr = lower.charCodeAt(i)
    same = curr === prev ? same + 1 : 1
    asc = curr === prev + 1 ? asc + 1 : 1
    desc = curr === prev - 1 ? desc + 1 : 1
    if (same >= 3 || asc >= 4 || desc >= 4) return true
  }
  return false
}

/** Detecta recorridos de teclado (`qwerty`, `asdfg`) de 4+ teclas seguidas. */
function hasKeyboardWalk(value: string): boolean {
  const lower = value.toLowerCase()
  for (const row of KEYBOARD_ROWS) {
    for (let i = 0; i + 4 <= row.length; i++) {
      const run = row.slice(i, i + 4)
      const reversed = run.split('').reverse().join('')
      if (lower.includes(run) || lower.includes(reversed)) return true
    }
  }
  return false
}

/**
 * Normaliza para comparar contra datos personales: quita acentos, pasa a
 * minúsculas y traduce el "leet" básico, para que `M4r14.2024` no cuele el
 * nombre "maria".
 */
function normalize(value: string): string {
  return value
    .normalize('NFD')
    // Rango de marcas diacríticas combinantes (acentos, diéresis, tildes).
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[04351789]/g, (d) => ({ '0': 'o', '4': 'a', '3': 'e', '5': 's', '1': 'i', '7': 't', '8': 'b', '9': 'g' })[d] ?? d)
}

/** Trozos significativos (4+ letras) del email y del nombre del usuario. */
function personalTokens(email?: string | null, name?: string | null): string[] {
  const raw = [
    ...(email ? email.split('@')[0].split(/[._\-+0-9]+/) : []),
    ...(email ? [email.split('@')[1]?.split('.')[0] ?? ''] : []),
    ...(name ? name.split(/\s+/) : []),
  ]
  return raw.map(normalize).filter((tk) => tk.length >= 4)
}

export interface PasswordContext {
  email?: string | null
  name?: string | null
}

export function evaluatePassword(password: string, ctx: PasswordContext = {}): PasswordVerdict {
  const normalized = normalize(password)
  const tokens = [...personalTokens(ctx.email, ctx.name), ...COMMON_ROOTS]

  const rules: PasswordRule[] = [
    {
      id: 'length',
      ok: password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH,
    },
    { id: 'case', ok: /[a-záéíóúñü]/.test(password) && /[A-ZÁÉÍÓÚÑÜ]/.test(password) },
    { id: 'number', ok: /\d/.test(password) },
    { id: 'symbol', ok: /[^\p{L}\p{N}]/u.test(password) },
    { id: 'no_pattern', ok: password.length > 0 && !hasRun(password) && !hasKeyboardWalk(password) },
    {
      id: 'no_personal',
      ok: password.length > 0 && !tokens.some((tk) => normalized.includes(tk)),
    },
  ]

  const passed = rules.filter((r) => r.ok).length
  // La barra premia cumplir reglas y, además, la longitud extra: una frase larga
  // debe verse más fuerte que el mínimo exacto aunque ambas sean válidas.
  const ruleScore = (passed / rules.length) * 78
  const lengthBonus = password.length === 0
    ? 0
    : Math.min(22, Math.max(0, (password.length - PASSWORD_MIN_LENGTH) * 2.2 + 6))
  const score = Math.round(Math.min(100, ruleScore + lengthBonus))

  const valid = rules.every((r) => r.ok)
  const strength: PasswordStrength =
    !valid ? (score < 40 ? 'weak' : 'fair')
      : score >= 88 ? 'strong'
        : 'good'

  return { rules, valid, score, strength }
}
