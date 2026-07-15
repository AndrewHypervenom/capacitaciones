import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Search, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import i18n from '@/i18n'

/**
 * Grupos de emojis con palabras clave (para el buscador). No es el catálogo
 * Unicode completo, pero cubre las categorías del panel del sistema con una
 * selección amplia y útil. Cada item es [emoji, palabras-clave].
 */
type EmojiItem = [string, string]
interface EmojiGroup {
  id: string
  /** Ícono de la pestaña de categoría. */
  tab: string
  /** Nombre accesible de la categoría. */
  label: string
  items: EmojiItem[]
}

const GROUPS: EmojiGroup[] = [
  {
    id: 'smileys', tab: '😀', label: 'Caras y emociones',
    items: [
      ['😀','feliz sonrisa'],['😃','feliz sonrisa'],['😄','feliz risa'],['😁','sonrisa dientes'],
      ['😆','risa'],['😅','risa nervios sudor'],['🤣','risa carcajada'],['😂','llorar risa'],
      ['🙂','sonrisa leve'],['🙃','al reves boca'],['😉','guiño'],['😊','feliz rubor'],
      ['😇','angel santo'],['🥰','amor corazones'],['😍','enamorado ojos corazon'],['🤩','estrellas asombro'],
      ['😘','beso'],['😗','beso'],['😚','beso'],['😙','beso'],['🥲','feliz lagrima'],
      ['😋','delicioso lengua'],['😛','lengua'],['😜','guiño lengua loco'],['🤪','loco'],
      ['😝','lengua ojos cerrados'],['🤑','dinero plata'],['🤗','abrazo'],['🤭','risa taparse'],
      ['🤫','silencio shh'],['🤔','pensar duda'],['🤐','cremallera boca'],['🤨','ceja duda'],
      ['😐','neutral serio'],['😑','sin expresion'],['😶','sin boca'],['😏','picaro'],
      ['😒','fastidio'],['🙄','ojos arriba'],['😬','mueca nervios'],['🤥','mentira nariz'],
      ['😌','aliviado calma'],['😔','triste pensativo'],['😪','sueño'],['🤤','baba deseo'],
      ['😴','dormir zzz'],['😷','mascarilla enfermo'],['🤒','termometro enfermo'],['🤕','herida vendaje'],
      ['🤢','nausea asco'],['🤮','vomito'],['🥵','calor sudor'],['🥶','frio'],
      ['😵','mareo'],['🤯','explota cabeza'],['🤠','vaquero'],['🥳','fiesta celebrar'],
      ['😎','gafas sol cool'],['🤓','nerd gafas'],['🧐','monoculo'],['😕','confundido'],
      ['😟','preocupado'],['🙁','triste'],['😮','sorpresa boca'],['😯','sorpresa'],
      ['😲','asombro'],['😳','sonrojo verguenza'],['🥺','suplica ojos'],['😦','angustia'],
      ['😨','miedo'],['😰','ansiedad sudor'],['😥','triste alivio'],['😢','llorar lagrima'],
      ['😭','llorar mucho'],['😱','grito miedo'],['😖','frustrado'],['😣','esfuerzo'],
      ['😞','decepcion'],['😓','sudor'],['😩','cansado'],['😫','harto'],
      ['😤','enojo bufido'],['😡','enojado rojo'],['😠','enojado'],['🤬','groseria'],
      ['😈','diablo travieso'],['👿','diablo enojado'],['💀','calavera muerte'],['💩','caca'],
      ['🤡','payaso'],['👻','fantasma'],['👽','alien'],['🤖','robot'],
    ],
  },
  {
    id: 'people', tab: '🧑', label: 'Personas y roles',
    items: [
      ['👋','saludo mano'],['👍','bien pulgar arriba like'],['👎','mal pulgar abajo'],['👏','aplauso'],
      ['🙌','celebrar manos'],['🙏','gracias rezar por favor'],['💪','fuerza musculo'],['🤝','trato manos'],
      ['✍️','escribir'],['👀','ojos mirar'],['🧠','cerebro mente'],['👶','bebe'],
      ['🧒','niño'],['👦','niño'],['👧','niña'],['🧑','persona adulto'],
      ['👨','hombre'],['👩','mujer'],['🧑‍🦰','pelirrojo'],['👱','rubio'],
      ['🧓','anciano'],['👴','abuelo'],['👵','abuela'],['🧑‍✈️','piloto azafata avion'],
      ['👮','policia'],['🕵️','detective espia'],['💂','guardia'],['👷','obrero construccion casco'],
      ['🧑‍⚕️','medico salud enfermera'],['🧑‍🏫','profesor maestro docente'],['👩‍🏫','profesora maestra'],['🧑‍🌾','agricultor granjero'],
      ['🧑‍🍳','cocinero chef'],['🧑‍🔧','mecanico tecnico'],['🧑‍🏭','fabrica operario'],['🧑‍💼','oficina ejecutivo empleado'],
      ['🧑‍🔬','cientifico'],['🧑‍💻','programador tecnologia computador'],['🧑‍🎤','cantante'],['🧑‍🎨','artista'],
      ['🧑‍🚀','astronauta'],['🧑‍🚒','bombero'],['🦸','heroe super'],['🦹','villano'],
      ['🧙','mago'],['🧚','hada'],['🧛','vampiro'],['🧑‍🦽','silla ruedas'],
      ['🧗','escalar'],['🏃','correr'],['🚶','caminar'],['🧘','yoga meditar'],
    ],
  },
  {
    id: 'animals', tab: '🐶', label: 'Animales y naturaleza',
    items: [
      ['🐶','perro'],['🐱','gato'],['🐭','raton'],['🐹','hamster'],['🐰','conejo'],
      ['🦊','zorro'],['🐻','oso'],['🐼','panda'],['🐨','koala'],['🐯','tigre'],
      ['🦁','leon'],['🐮','vaca'],['🐷','cerdo'],['🐸','rana'],['🐵','mono'],
      ['🐔','gallina pollo'],['🐧','pinguino'],['🐦','pajaro'],['🦅','aguila'],['🦉','buho'],
      ['🦇','murcielago'],['🐺','lobo'],['🐗','jabali'],['🐴','caballo'],['🦄','unicornio'],
      ['🐝','abeja'],['🐛','gusano oruga'],['🦋','mariposa'],['🐌','caracol'],['🐞','mariquita'],
      ['🐢','tortuga'],['🐍','serpiente'],['🐙','pulpo'],['🦑','calamar'],['🦐','camaron'],
      ['🐠','pez'],['🐟','pez'],['🐬','delfin'],['🐳','ballena'],['🦈','tiburon'],
      ['🐊','cocodrilo'],['🐅','tigre'],['🐆','leopardo'],['🦓','cebra'],['🦍','gorila'],
      ['🐘','elefante'],['🦏','rinoceronte'],['🐪','camello'],['🦒','jirafa'],['🐄','vaca'],
      ['🌸','flor rosa'],['🌹','rosa flor'],['🌻','girasol'],['🌷','tulipan'],['🌲','arbol pino'],
      ['🌳','arbol'],['🌴','palmera'],['🌵','cactus'],['🍀','trebol suerte'],['🍁','hoja otoño'],
      ['🌊','ola mar agua'],['⭐','estrella'],['🌟','estrella brillo'],['✨','brillos magia'],['⚡','rayo energia'],
      ['🔥','fuego llama'],['🌈','arcoiris'],['☀️','sol'],['🌙','luna'],['❄️','nieve copo'],
    ],
  },
  {
    id: 'food', tab: '🍔', label: 'Comida y bebida',
    items: [
      ['🍏','manzana verde'],['🍎','manzana'],['🍐','pera'],['🍊','naranja'],['🍋','limon'],
      ['🍌','banana platano'],['🍉','sandia'],['🍇','uvas'],['🍓','fresa'],['🍒','cerezas'],
      ['🍑','durazno'],['🥭','mango'],['🍍','piña'],['🥥','coco'],['🥝','kiwi'],
      ['🍅','tomate'],['🥑','aguacate palta'],['🥦','brocoli'],['🥕','zanahoria'],['🌽','maiz'],
      ['🌶️','chile picante'],['🥔','papa patata'],['🍞','pan'],['🧀','queso'],['🥚','huevo'],
      ['🍳','huevo frito'],['🥓','tocino'],['🍔','hamburguesa'],['🍟','papas fritas'],['🍕','pizza'],
      ['🌭','hotdog'],['🌮','taco'],['🌯','burrito'],['🥗','ensalada'],['🍜','sopa fideos'],
      ['🍣','sushi'],['🍩','dona'],['🍪','galleta'],['🎂','pastel torta cumpleaños'],['🍰','pastel'],
      ['🧁','cupcake'],['🍫','chocolate'],['🍬','dulce caramelo'],['🍭','paleta'],['🍦','helado'],
      ['☕','cafe'],['🍵','te'],['🥤','bebida vaso'],['🧃','jugo'],['🍺','cerveza'],
      ['🍷','vino'],['🥂','brindis champan'],['🍾','botella'],['🧊','hielo'],['🍼','biberon'],
    ],
  },
  {
    id: 'activities', tab: '⚽', label: 'Actividades',
    items: [
      ['⚽','futbol balon'],['🏀','baloncesto'],['🏈','futbol americano'],['⚾','beisbol'],['🎾','tenis'],
      ['🏐','voleibol'],['🏉','rugby'],['🎱','billar'],['🏓','ping pong'],['🏸','badminton'],
      ['🥅','arco porteria'],['⛳','golf'],['🏒','hockey'],['🏑','hockey'],['🥍','lacrosse'],
      ['🏏','cricket'],['🥊','boxeo'],['🥋','artes marciales'],['⛸️','patinaje'],['🛹','skate'],
      ['🎿','esqui'],['🏂','snowboard'],['🏋️','pesas gimnasio'],['🤸','gimnasia'],['🤺','esgrima'],
      ['🤾','handball'],['🏌️','golf'],['🏇','carrera caballo'],['🧗','escalar'],['🚴','ciclismo bici'],
      ['🏊','natacion nadar'],['🤽','waterpolo'],['🏄','surf'],['🚣','remo'],['🎣','pesca'],
      ['🎯','diana objetivo meta'],['🎮','videojuego'],['🎲','dado juego'],['🎳','bolos'],['🎰','tragamonedas'],
      ['🎨','arte pintar'],['🎭','teatro'],['🎬','cine pelicula'],['🎤','microfono cantar'],['🎧','audifonos musica'],
      ['🎼','musica partitura'],['🎹','piano'],['🥁','bateria tambor'],['🎸','guitarra'],['🎺','trompeta'],
      ['🏆','trofeo ganar premio'],['🥇','oro medalla primero'],['🥈','plata medalla'],['🥉','bronce medalla'],['🏅','medalla'],
    ],
  },
  {
    id: 'travel', tab: '✈️', label: 'Viajes y lugares',
    items: [
      ['🚗','carro auto coche'],['🚕','taxi'],['🚙','camioneta'],['🚌','bus autobus'],['🚎','trolebus'],
      ['🏎️','carro carrera'],['🚓','patrulla policia'],['🚑','ambulancia'],['🚒','bombero camion'],['🚐','furgoneta'],
      ['🚚','camion'],['🚛','trailer'],['🚜','tractor'],['🛵','moto scooter'],['🏍️','moto'],
      ['🚲','bicicleta'],['🛴','patineta'],['🚂','tren'],['🚆','tren'],['🚄','tren bala'],
      ['🚈','metro'],['🚝','monorriel'],['🚁','helicoptero'],['✈️','avion vuelo'],['🛩️','avioneta'],
      ['🛫','despegue avion'],['🛬','aterrizaje avion'],['🚀','cohete espacio'],['🛸','ovni'],['⛵','velero barco'],
      ['🚤','lancha'],['🛳️','crucero barco'],['⚓','ancla'],['🚧','construccion obra'],['⛽','gasolinera'],
      ['🚦','semaforo'],['🗺️','mapa'],['🗿','estatua'],['🗽','libertad estatua'],['🗼','torre'],
      ['🏰','castillo'],['🏯','castillo japon'],['🏟️','estadio'],['🎡','rueda fortuna'],['🎢','montaña rusa'],
      ['🏖️','playa'],['🏝️','isla'],['⛰️','montaña'],['🏔️','montaña nieve'],['🌋','volcan'],
      ['🏕️','campamento'],['🏠','casa'],['🏡','casa jardin'],['🏢','edificio oficina'],['🏥','hospital'],
      ['🏦','banco'],['🏨','hotel'],['🏫','escuela colegio'],['🏭','fabrica'],['⛪','iglesia'],
    ],
  },
  {
    id: 'objects', tab: '💡', label: 'Objetos',
    items: [
      ['⌚','reloj'],['📱','celular telefono movil'],['💻','laptop computador'],['⌨️','teclado'],['🖥️','computador monitor'],
      ['🖨️','impresora'],['🖱️','mouse raton'],['💽','disco'],['💾','guardar disquete'],['💿','cd disco'],
      ['📷','camara foto'],['📸','camara flash'],['📹','videocamara'],['🎥','camara cine'],['📞','telefono'],
      ['☎️','telefono'],['📟','buscapersonas'],['📠','fax'],['📺','television tv'],['📻','radio'],
      ['🔋','bateria'],['🔌','enchufe'],['💡','idea bombilla luz'],['🔦','linterna'],['🕯️','vela'],
      ['📔','cuaderno'],['📕','libro'],['📗','libro'],['📘','libro'],['📚','libros'],
      ['📖','libro abierto leer'],['📝','nota escribir'],['✏️','lapiz'],['✒️','pluma'],['🖊️','boligrafo'],
      ['🖍️','crayon'],['📎','clip'],['📌','chincheta'],['📍','pin ubicacion'],['✂️','tijeras'],
      ['📁','carpeta'],['📂','carpeta abierta'],['📅','calendario'],['📆','calendario'],['📊','grafico barras'],
      ['📈','grafico subir'],['📉','grafico bajar'],['💼','maletin trabajo'],['🔒','candado cerrado'],['🔓','candado abierto'],
      ['🔑','llave'],['🔨','martillo'],['🔧','llave herramienta'],['🔩','tuerca tornillo'],['⚙️','engranaje config'],
      ['🧰','caja herramientas'],['🧲','iman'],['🧪','tubo laboratorio'],['🧬','adn'],['🔬','microscopio'],
      ['🔭','telescopio'],['💊','pastilla medicina'],['💉','inyeccion vacuna'],['🩺','estetoscopio'],['🌡️','termometro'],
      ['💰','dinero bolsa'],['💵','billete dinero'],['💳','tarjeta'],['🎁','regalo'],['📦','caja paquete'],
    ],
  },
  {
    id: 'symbols', tab: '❤️', label: 'Símbolos',
    items: [
      ['❤️','corazon amor rojo'],['🧡','corazon naranja'],['💛','corazon amarillo'],['💚','corazon verde'],['💙','corazon azul'],
      ['💜','corazon morado'],['🖤','corazon negro'],['🤍','corazon blanco'],['💔','corazon roto'],['❣️','corazon'],
      ['💕','corazones'],['💞','corazones'],['💓','corazon latido'],['💗','corazon'],['💖','corazon brillo'],
      ['💘','corazon flecha'],['💝','corazon regalo'],['✅','correcto check bien'],['☑️','check casilla'],['✔️','check'],
      ['❌','error mal equis'],['❎','equis'],['➕','mas suma'],['➖','menos resta'],['➗','division'],
      ['✖️','multiplicacion'],['❓','pregunta'],['❗','exclamacion'],['⚠️','advertencia peligro'],['🚫','prohibido'],
      ['💯','cien perfecto'],['🔔','campana notificacion'],['🔕','silencio campana'],['📣','megafono anuncio'],['📢','altavoz'],
      ['💬','mensaje chat'],['💭','pensamiento burbuja'],['🗯️','enojo burbuja'],['♻️','reciclar'],['⚜️','flor de lis'],
      ['🔰','principiante'],['⭕','circulo'],['🆗','ok'],['🆕','nuevo new'],['🆓','gratis free'],
      ['🔴','circulo rojo'],['🟠','circulo naranja'],['🟡','circulo amarillo'],['🟢','circulo verde'],['🔵','circulo azul'],
      ['🟣','circulo morado'],['⚫','circulo negro'],['⚪','circulo blanco'],['🔺','triangulo rojo'],['🔻','triangulo'],
      ['🔶','diamante naranja'],['🔷','diamante azul'],['🏁','meta bandera cuadros'],['🚩','bandera'],['🎌','banderas'],
    ],
  },
]

interface PanelPos { top: number; left: number; openUp: boolean }

interface Props {
  value: string
  onSelect: (emoji: string) => void
  className?: string
  'aria-label'?: string
}

/**
 * Selector de emojis tipo panel del sistema (clic derecho → emojis): abre un
 * menú con buscador y pestañas de categoría. Sin dependencias externas.
 * Renderiza el panel en un portal (posición fija) para no recortarse por overflow.
 */
export function EmojiPicker({ value, onSelect, className, 'aria-label': ariaLabel }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeCat, setActiveCat] = useState(GROUPS[0].id)
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [pos, setPos] = useState<PanelPos>({ top: 0, left: 0, openUp: false })

  const PANEL_W = 320
  const measure = useCallback(() => {
    const btn = btnRef.current
    if (!btn) return
    const r = btn.getBoundingClientRect()
    const spaceBelow = window.innerHeight - r.bottom
    const openUp = spaceBelow < 380 && r.top > spaceBelow
    let left = r.left
    // Que no se salga por la derecha en pantallas angostas.
    if (left + PANEL_W > window.innerWidth - 12) left = Math.max(12, window.innerWidth - 12 - PANEL_W)
    setPos({ top: openUp ? r.top : r.bottom + 6, left, openUp })
  }, [])

  useLayoutEffect(() => { if (open) measure() }, [open, measure])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus() } }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    // Foco al buscador al abrir.
    const id = window.setTimeout(() => searchRef.current?.focus(), 20)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
      window.clearTimeout(id)
    }
  }, [open, measure])

  // Resultado del buscador (todas las categorías) o la categoría activa.
  const results = useMemo<EmojiItem[]>(() => {
    const q = query.trim().toLowerCase()
    if (!q) return GROUPS.find(g => g.id === activeCat)?.items ?? []
    const seen = new Set<string>()
    const out: EmojiItem[] = []
    for (const g of GROUPS) {
      for (const it of g.items) {
        if (seen.has(it[0])) continue
        if (it[1].includes(q)) { seen.add(it[0]); out.push(it) }
      }
    }
    return out
  }, [query, activeCat])

  const pick = (emoji: string) => {
    onSelect(emoji)
    setOpen(false)
    btnRef.current?.focus()
  }

  return (
    <div className={cn('relative w-full', className)}>
      <button
        ref={btnRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="flex items-center justify-between w-full gap-2 min-h-[44px] px-3 py-1.5 rounded-xl text-[13px] bg-bg text-text border border-line hover:bg-subtle transition-colors"
      >
        <span className="text-[20px] leading-none">{value || '🧑'}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-text-muted transition-transform', open && 'rotate-180')} />
      </button>

      {open && createPortal(
        <div
          ref={panelRef}
          role="dialog"
          className="fixed rounded-2xl border border-line bg-surface text-text shadow-xl overflow-hidden flex flex-col"
          style={{
            top: pos.openUp ? undefined : pos.top,
            bottom: pos.openUp ? window.innerHeight - pos.top + 6 : undefined,
            left: pos.left,
            width: PANEL_W,
            maxWidth: 'calc(100vw - 24px)',
            zIndex: 9999,
          }}
        >
          {/* Buscador */}
          <div className="p-2.5 border-b border-line shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted pointer-events-none" />
              <input
                ref={searchRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={i18n.t('common.search_emoji', { defaultValue: 'Buscar emoji…' })}
                className="w-full pl-8 pr-8 py-2 rounded-xl text-[13px] bg-bg border border-line text-text placeholder-text-subtle focus:outline-none focus:border-[#10D451]/60 transition-colors"
              />
              {query && (
                <button type="button" onClick={() => { setQuery(''); searchRef.current?.focus() }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-5 w-5 flex items-center justify-center rounded-md text-text-muted hover:text-text hover:bg-subtle">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Pestañas de categoría (ocultas al buscar) */}
          {!query && (
            <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-line shrink-0 overflow-x-auto">
              {GROUPS.map(g => (
                <button key={g.id} type="button" onClick={() => setActiveCat(g.id)}
                  title={g.label} aria-label={g.label}
                  className={cn(
                    'h-8 w-8 shrink-0 rounded-lg flex items-center justify-center text-[16px] transition-colors',
                    activeCat === g.id ? 'bg-subtle' : 'hover:bg-subtle/60 opacity-70',
                  )}>
                  {g.tab}
                </button>
              ))}
            </div>
          )}

          {/* Grid de emojis */}
          <div className="p-1.5 overflow-y-auto" style={{ height: 232 }}>
            {results.length === 0 ? (
              <div className="h-full flex items-center justify-center text-[12px] text-text-muted">
                {i18n.t('common.no_results', { defaultValue: 'Sin resultados' })}
              </div>
            ) : (
              <div className="grid grid-cols-7 gap-0.5">
                {results.map(([emoji]) => (
                  <button key={emoji} type="button" onClick={() => pick(emoji)}
                    title={emoji}
                    className={cn(
                      'h-9 w-9 rounded-lg flex items-center justify-center text-[20px] transition-transform hover:bg-subtle hover:scale-110',
                      value === emoji && 'bg-subtle',
                    )}>
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

export default EmojiPicker
