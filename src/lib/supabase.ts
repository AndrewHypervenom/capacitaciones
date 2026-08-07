/// <reference types="vite/client" />
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { healthFetch } from '@/lib/serviceHealth'
import { withWriteNotifier } from '@/lib/writeNotifier'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env')
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  // `fetch` instrumentado: mide latencia y fallos (5xx / timeouts de sentencia)
  // para poder avisar en pantalla cuando los servicios están degradados
  // (lib/serviceHealth.ts), y anuncia las escrituras de contenido a las demás
  // pestañas para que no se queden con la versión anterior (lib/writeNotifier.ts).
  // Ninguno de los dos cambia el comportamiento de las peticiones.
  global: { fetch: withWriteNotifier(healthFetch) },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // PKCE en vez del flujo implícito: el enlace de restablecimiento viaja como
    // un `code` de un solo uso que SOLO sirve acompañado del `code_verifier`
    // guardado en este navegador. Consecuencias buscadas:
    //   · el correo nunca lleva un access/refresh token en el fragmento de la
    //     URL (que quedaría en el historial y en cualquier extensión),
    //   · si alguien intercepta o reenvía el enlace, no puede canjearlo desde
    //     otro dispositivo,
    //   · los escáneres antispam que "visitan" los enlaces no obtienen sesión.
    // A cambio, el enlace debe abrirse en el mismo navegador donde se pidió;
    // ResetPassword.tsx detecta ese caso y lo explica en vez de fallar seco.
    flowType: 'pkce',
    // Desactivado a propósito: no queremos que CUALQUIER ruta de la app canjee
    // un código de auth que aparezca en la URL. El único sitio que lo hace es
    // /reset-password, con `exchangeCodeForSession`, para poder distinguir un
    // enlace vencido de uno abierto en otro navegador y explicárselo al usuario
    // (con auto-detección el canje ocurre en el arranque y el error se pierde).
    detectSessionInUrl: false,
  },
})
