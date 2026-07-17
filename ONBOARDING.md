# Bienvenidas al proyecto

Este doc es para que no se pierdan al principio. Léanlo completo antes de tocar cualquier cosa.

---

## Qué es esto

Es la plataforma de capacitaciones interna. Desde aquí los agentes ven módulos de aprendizaje, practican con simuladores de llamadas y obtienen certificados. El panel de admin sirve para crear y editar todo ese contenido.

---

## Con qué está hecho

No se asusten, no tienen que saber todo esto de memoria, solo para que sepan qué son las cosas cuando las vean:

- **React** — la librería que construye las pantallas. Todo lo que ven en el navegador sale de aquí
- **TypeScript** — es JavaScript pero con tipos. Si ponen un número donde va un texto, el editor les avisa antes de correr el código. Al principio parece molesto, después lo agradecen
- **TailwindCSS** — los estilos. En vez de escribir CSS normal, usan clases directamente en el HTML como `text-sm` o `bg-blue-500`. Hay un buscador en tailwindcss.com si no saben qué clase usar
- **Supabase** — la base de datos y el login. No lo van a tocar directamente casi nunca
- **Vite** — el que levanta el servidor cuando corren `npm run dev`. No hay que configurar nada

Las carpetas importantes dentro de `src/`:

```
src/
├── admin/              ← Todo el panel de administración
│   ├── components/         componentes propios del panel admin
│   │   └── simulation/     editor visual de nodos del simulador
│   ├── guards/             protección de rutas (cuidado con esto)
│   ├── hooks/              hooks exclusivos del panel admin
│   ├── lib/                utilidades internas del panel admin
│   └── pages/              pantallas del panel:
│       ├── AdminDashboard.tsx   resumen general
│       ├── CampaignList.tsx     gestión de campañas / quizzes en vivo
│       ├── ChoiceSimEditor.tsx  editor de simulador de opciones
│       ├── LiveQuizAdmin.tsx    control del quiz en tiempo real
│       ├── ModuleEditor.tsx     editor de un módulo bloque a bloque
│       ├── ModuleGenerator.tsx  generación de módulos con IA
│       ├── ModuleList.tsx       lista de módulos existentes
│       ├── ModulePreview.tsx    vista previa de un módulo
│       ├── NewModulePage.tsx    crear módulo nuevo
│       ├── SimulationEditor.tsx editor de simulador de voz (nodos)
│       ├── SimulationList.tsx   lista de simuladores
│       └── UserList.tsx         gestión de usuarios y permisos
│
├── components/         ← Piezas de UI reutilizables (no son páginas completas)
│   ├── layout/             estructura visual de la app (header, sidebar, etc.)
│   ├── modules/            bloques de contenido educativo
│   │   └── blocks/         cada tipo de bloque: video, texto, quiz, imagen…
│   ├── simulator/          componentes específicos del simulador de llamadas
│   └── ui/                 componentes genéricos: botones, tarjetas, inputs,
│                           modales, badges, spinners — nada específico del negocio
│
├── data/               ← Datos estáticos de respaldo (cuando no hay BD disponible)
│   ├── choiceScenarios.ts  escenarios de opciones de ejemplo
│   ├── modules.ts          módulos de ejemplo
│   └── scenarios.ts        escenarios de voz de ejemplo
│
├── hooks/              ← Lógica reutilizable entre componentes
│   ├── useAuth.ts          maneja login, logout y estado de sesión
│   ├── useModules.ts       carga y filtra los módulos disponibles
│   ├── useReducedMotion.ts accesibilidad: respeta preferencias de animación
│   ├── useScenarios.ts     carga los escenarios del simulador de voz
│   ├── useSpeechRecognition.ts  reconocimiento de voz del simulador
│   └── useTheme.ts         modo claro/oscuro
│
├── i18n/               ← Traducciones (español/inglés) — en desarrollo
│   └── locales/
│
├── lib/                ← Funciones utilitarias pequeñas y sin estado
│   ├── cn.ts               combina clases de Tailwind limpiamente
│   ├── normalize.ts        limpia texto para comparaciones
│   ├── scoring.ts          calcula puntajes de simulaciones
│   ├── simulator.ts        lógica del flujo de nodos del simulador
│   └── supabase.ts         cliente de conexión a Supabase (se importa en services/)
│
├── pages/              ← Las pantallas que ve el agente (usuario final)
│   ├── Certificate.tsx     certificado al completar un módulo
│   ├── ChoiceSimulatorRun  simulador de opciones múltiples
│   ├── Dashboard.tsx       menú principal con módulos y simuladores
│   ├── LiveQuizPlay.tsx    quiz en tiempo real (modo campaña)
│   ├── Login.tsx           pantalla de inicio de sesión
│   ├── ModulePage.tsx      reproductor de un módulo de aprendizaje
│   ├── Onboarding.tsx      flujo inicial de configuración de perfil
│   ├── SimulatorResult.tsx resultados y puntaje al terminar
│   ├── SimulatorRun.tsx    simulador de llamada en vivo (voz)
│   └── Welcome.tsx         bienvenida tras el primer login
│
├── services/           ← Toda la comunicación con Supabase (base de datos)
│   ├── ai.service.ts               llamadas a la IA para generar contenido
│   ├── auth.service.ts             login y registro
│   ├── choiceScenarios.admin.service.ts  crear/editar escenarios de opciones (admin)
│   ├── choiceScenarios.service.ts  leer escenarios de opciones (lado agente)
│   ├── modules.service.ts          leer módulos (lado agente)
│   ├── progress.service.ts         guardar y leer progreso del agente
│   ├── scenarios.admin.service.ts  crear/editar escenarios de voz (admin)
│   └── scenarios.service.ts        leer escenarios de voz (lado agente)
│
├── stores/             ← Estado global de la app (datos que varias pantallas comparten)
│   ├── authStore.ts        sesión del usuario (quién está logueado)
│   ├── progressStore.ts    progreso en módulos y simuladores
│   ├── simStore.ts         estado de la simulación en curso
│   ├── toastStore.ts       notificaciones emergentes (los mensajes de éxito/error)
│   └── userStore.ts        perfil y datos del usuario actual
│
├── styles/             ← CSS global (muy poco, casi todo es Tailwind)
│
└── types/              ← Definiciones de tipos TypeScript (qué forma tienen los datos)
    ├── blocks.ts           tipos de cada bloque de contenido de un módulo
    └── database.ts         tipos que vienen directamente de Supabase
```

**Regla general:** si van a tocar algo que el agente ve → `pages/` o `components/`. Si van a tocar algo del panel admin → `admin/`. Si no saben dónde va algo, pregúntenme antes de crearlo en cualquier lado.

---

## Instalación

Necesitan tener instalado antes de empezar:
- **Node.js** (versión 24 o mayor) — [nodejs.org](https://nodejs.org), bajar el LTS
- **Git** — [git-scm.com](https://git-scm.com), instalar sin cambiar ninguna opción
- **VS Code** — [code.visualstudio.com](https://code.visualstudio.com)
- Cuenta en **GitHub** y decirle a Andres su usuario para que las agregue al repo

### Configurar Git por primera vez

Abrir la terminal y correr esto con sus datos:

```bash
git config --global user.name "Su Nombre"
git config --global user.email "el-email-con-que-se-registraron-en-github@ejemplo.com"
```

Esto solo se hace una vez.

### Clonar y levantar el proyecto

```bash
git clone https://github.com/AndrewHypervenom/capacitaciones.git
cd capacitaciones
npm install
```

El `npm install` tarda un rato la primera vez, es normal.

Después de eso pedirle a Andres el archivo `.env` y ponerlo en la carpeta `capacitaciones`. Sin ese archivo el proyecto no puede conectarse a la base de datos.

Para levantar el servidor:

```bash
npm run dev
```

Abrir el navegador en `http://localhost:5173`. Si ven la pantalla de login, todo está bien.

---

## Cómo trabajamos con Git

Esto es lo más importante del documento. Léanlo con calma.

### La idea general

El código oficial del proyecto vive en la rama `main`. Nadie puede subir código directo ahí, ni ellas ni yo. Todo tiene que pasar por revisión primero.

El flujo es así:
1. Crean su propia rama para la tarea que van a hacer
2. Hacen sus cambios ahí
3. Suben su rama a GitHub
4. Crean un Pull Request (básicamente una solicitud de revisión)
5. Yo reviso, comento si hay algo que cambiar, y cuando está bien lo apruebo
6. Listo, los cambios quedan en el proyecto

### Pasos completos desde cero

Cada tarea nueva empieza igual, desde el principio:

```bash
# 1. Volver a main y traer los cambios más recientes
git checkout main
git pull origin main

# 2. Crear la rama nueva y moverse a ella (-b la crea, sin -b solo cambia)
git checkout -b su-nombre/descripcion-de-la-tarea

# 3. Hacer los cambios en el código...

# 4. Ver qué archivos cambiaron
git status

# 5. Preparar todos los cambios
git add .

# 6. Guardar con un mensaje descriptivo
git commit -m "feat: descripcion de lo que hicieron"

# 7. Subir la rama a GitHub
git push origin su-nombre/descripcion-de-la-tarea
```

Ejemplos de cómo nombrar la rama:
```bash
git checkout -b Paola/arreglar-titulo-modulos
git checkout -b Isabela/cambiar-color-boton-guardar
```

Después del paso 7 van a GitHub, crean el PR y me avisan. Yo lo reviso y cuando esté bien lo apruebo.

### Guardar cambios

Mientras trabajan, cada vez que terminen algo concreto lo guardan así:

```bash
git status          # ver qué archivos cambiaron
git add .           # preparar todos los cambios
git commit -m "descripción de lo que hicieron"
```

El mensaje del commit tiene que decir qué hicieron, no ser algo genérico como "cambios" o "fix". Usamos el formato en inglés:

```bash
# fix → algo roto
git commit -m "fix: module title was showing in English"

# feat → algo nuevo
git commit -m "feat: add validation to new module form"

# chore / style → cambios menores o de apariencia
git commit -m "style: reduce font size on dashboard cards"
```

Si prefieren escribir la descripción en español, también está bien:

```bash
# fix → algo roto
git commit -m "fix: el título de módulos aparecía en inglés"
git commit -m "fix: el botón de guardar no respondía en Safari"

# feat → algo nuevo
git commit -m "feat: validación en el formulario de nuevo módulo"
git commit -m "feat: mensaje de error cuando el login falla"

# chore / style → cambios menores o de apariencia
git commit -m "style: reducir tamaño de fuente en tarjetas del dashboard"
git commit -m "style: color del botón principal a azul oscuro"
```

Pueden hacer varios commits en una misma tarea, no tiene que ser todo en uno.

### Subir su rama

Cuando terminen o quieran que revise:

```bash
git push origin su-nombre/descripcion-de-la-tarea
```

Esto sube **su rama**, no toca `main` para nada.

### Crear el Pull Request

Un Pull Request (PR) es básicamente decirle al equipo: *"terminé, revisen esto antes de que entre al proyecto oficial"*. Sin ese paso, el código se queda en su rama y nadie más lo ve.

**Paso a paso:**

1. Entrar a [github.com/AndrewHypervenom/capacitaciones](https://github.com/AndrewHypervenom/capacitaciones)
2. GitHub va a mostrar un recuadro amarillo en la parte de arriba que dice **"Compare & pull request"** — clic ahí. Si no aparece, buscar su rama en la lista de ramas y hacer clic en **"Contribute" → "Open pull request"**
3. Revisar que la flecha apunte de su rama hacia `main` (debe decir: `main ← su-nombre/su-tarea`)
4. Escribir un **título** claro, igual que un mensaje de commit:
   ```
   fix: el botón de guardar no respondía en Safari
   feat: agregar indicador de progreso en módulos
   ```
5. En la **descripción** contar brevemente qué hicieron y por qué. No tiene que ser largo, con dos o tres líneas alcanza:
   ```
   Cambié el color del botón principal porque en el diseño nuevo es azul oscuro.
   Probé en Chrome y Edge, funciona bien en los dos.
   ```
6. Clic en **"Create pull request"**
7. Avisarme por donde estemos hablando para que lo revise

### Si pido cambios

Sin drama (pasa seguido). Solo hacerlos, guardar y volver a subir:

```bash
git add .
git commit -m "fix: ajuste según revisión"
git push origin su-nombre/descripcion-de-la-tarea
```

El Pull Request se actualiza solo con el nuevo commit. No tienen que cerrar el PR ni crear uno nuevo, simplemente avisarme que ya está listo.

### Cuando apruebo y fusiono

Les llega una notificación de GitHub. Después de eso, actualizar su `main` local para tener la versión más reciente:

```bash
git checkout main
git pull origin main
```

Y para la siguiente tarea, volver al paso de crear una nueva rama desde ese `main` actualizado.

---

## Los 6 comandos que van a usar todos los días

```bash
git pull origin main                        # actualizar antes de empezar
git checkout -b nombre/tarea                # crear rama nueva
git status                                  # ver qué cambiaron
git add .                                   # preparar cambios
git commit -m "descripción"                 # guardar con mensaje
git push origin nombre/tarea                # subir al servidor
```

---

## Cosas que no deben hacer

- Trabajar directo en `main` (de todas formas el sistema no les va a dejar)
- Hacer `git push origin main`
- Subir el archivo `.env` en ningún commit — ese archivo tiene contraseñas
- Mezclar dos tareas distintas en un mismo Pull Request

---

Si algo no les funciona o se traban con Git, avísenme antes de intentar arreglarlo solas. Mejor una pregunta que un historial roto.
Realizando prueba/paola
Holiiiii aqui estuvo isa haciendo la prueba 
