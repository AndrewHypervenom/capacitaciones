# Drive / Academy

Juego de repaso en `/games/drive/:id`. Conserva el banco de preguntas, la publicación y los permisos de la zona de juegos.

## Cómo se juega

Una ciudad abierta en cuadrícula (5 × 5 cruces, calles de doble sentido). El aprendiz conduce libremente; una columna de luz verde, la flecha del panel y el minimapa marcan el **semáforo-pregunta**, que siempre es el siguiente cruce **delante del auto** en la calle por la que va (se recalcula si giras). Ese semáforo está en rojo: si llegas por su calle, el auto frena solo en la línea y se abre la pregunta al lado del semáforo, con un acercamiento suave de la cámara. Al acertar se pone en verde; al cruzarlo se marca el siguiente (a uno o dos cruces, `questionRoute`).

**Una sola oportunidad por semáforo**, como los quizzes del curso: la regla se anuncia antes de empezar, la correcta no se ve hasta responder y, si fallas, aparece «Era esta» con su explicación; la luz se pone en verde igual y la pregunta cuenta como fallada. No hay «intentar otra vez».

**Infracciones** (aviso al momento y conteo en el resumen): atropellar a un peatón (cae y se levanta, nada gráfico), chocar contra autos, conos o estacionados, y pasarse un semáforo en rojo. No cambian el final: eso lo deciden solo las respuestas.

Tras la última pregunta no se maneja hasta la salida: «Ir a la meta» (o W) dispara un **teletransporte** (destello, líneas de velocidad, auto brillando) y empieza la película final según los aciertos: **túnel** (≥ 80 %): portal de piedra con arco, bóveda iluminada y la montaña detrás (laderas a los lados y cumbre sobre la bóveda, nada cruza el paso), que sale a un arco de META con confeti y cámara orbital, **puente** (≥ 50 %) con el mismo cierre, o **precipicio** (< 50 %): vuelo en cámara lenta, explosión con onda expansiva, chispas y humo. Luego aparece el resumen y el repaso.

## Rutas por niveles

Un curso puede tener una ruta de hasta tres juegos: `arena_quizzes.course_id` + `level` (`basico`, `medio`, `avanzado`). En `/admin/games`, «Ruta por niveles con IA» lee el contenido real del curso (`getCourseSource`) y llama a `generate-exam` una vez por nivel, pidiendo solo preguntas de una respuesta y sin repetir las de otros niveles; todo queda en borrador. Rehacer un nivel reemplaza sus preguntas en la misma fila.

El aprendiz ve el primer nivel publicado abierto y cada siguiente se desbloquea al superar el anterior (`min_score_pct`, 70 % por defecto). El resultado se guarda en `arena_progress` sin XP y nunca empeora lo logrado; las pruebas del superadmin no cuentan. La lógica vive en `src/services/drivingLevels.service.ts`.

## Controles

- **W / ↑** acelera · **S / ↓ / espacio** frena y, detenido, da reversa · **A / D / ← / →** gira. En pantalla: flechas, Frenar y Acelerar (mantener presionado).
- Responder con las opciones o las teclas **1–4**. **C** cámara (persecución / capó). **P** pausa.
- Los edificios son muros (el auto se desliza a lo largo); el tráfico respeta los semáforos de adorno y frena si tienes el auto delante.
- Movimiento reducido: sin trayectos; acelerar lleva directo al siguiente semáforo o a la salida, y no hay película final.
- Sin WebGL: la pregunta aparece enseguida y acelerar cuenta como cruzar.

## Escena

`drivingWorld.ts` construye todo localmente: cielo de atardecer (`Sky`), calles con marcas, edificios con ventanas a escala, palmeras en la avenida central, árboles, faroles, semáforos reales (poste, brazo, cabezal con placa de borde amarillo, viseras y tres luces) como mallas instanciadas, tráfico, peatones, hojas y los tres finales (solo se construye el que toca). `DrivingScene.tsx` maneja la física, la cámara, el minimapa, la tarjeta (un panel HTML normal ubicado sobre la proyección del semáforo; ya no CSS3D) sin postproceso (el bloom se quitó por lento). Hay autos estacionados en el carril exterior (sólidos), obras con conos, barriles y vallas **con física** (se empujan según la velocidad, se voltean y ruedan; suenan un golpe y no cuentan como infracción), paradas de bus, bancas, hidrantes, letreros de calles y vallas; algunos peatones cruzan por las cebras.

Las partidas son prácticas: no alteran notas ni XP.

## Verificación

Con Vite en el puerto 5178:

```sh
npx playwright test -c tests/driving.config.ts --reporter=list
npm run build
```

Las pruebas usan sesiones y respuestas de Supabase simuladas y conducen de verdad (mantienen W), así que tardan varios minutos con render por software.

## Rendimiento y audio

- Lo estático se fusiona por material y por zona de 96 m (así lo que no está en cámara ni en la sombra se descarta); solo proyecta sombra lo que tiene volumen. Sombra de 1024 px sobre ±45 m, ajustada a la cuadrícula de sus píxeles (no tiembla) y recalculada cada dos cuadros. El cielo se pinta una vez en un cubemap. Sin luces puntuales. Resolución adaptativa entre 0.75× y 1.5× según los cuadros por segundo reales. Cámara hasta 900 m (la niebla tapa lo demás).
- Antes: todo lo estático se fusionaba en una malla por material al construir la ciudad; los materiales y la luz de la explosión se crean de antemano (crearlos en plena escena recompilaba shaders y daba tirones).
- El bucle de dibujo no crea objetos por cuadro; las luces se actualizan cada 0.2 s y la telemetría solo avisa a React cuando cambia.
- Audio generado en el navegador con compresor maestro; se reactiva solo si el navegador lo suspende. Efectos: choque, peatón, teletransporte, explosión y fanfarria de meta.

## Pausa activa y ergonomía

La misma Zona de juegos (`/games` y `/admin/games`) incluye una experiencia independiente de bienestar, cargada al pulsar «Explorar pausa activa». No necesita tablas, publicaciones ni servicios nuevos. Las misiones duran durante la apertura del juego y no modifican notas ni XP.

- `ErgonomicsGame.tsx`: tres misiones, comparación sin alterar la respuesta, exploración y cuatro movimientos de 20 segundos. El cronómetro se pausa al ocultar la pestaña y espera confirmación entre movimientos.
- `ErgonomicsScene.tsx`: puesto articulado en Three.js, cámaras, órbita, puntos seleccionables, iluminación, limpieza de recursos y alternativa sin WebGL.
- `ergonomicsModel.ts`: reglas del personaje, escenarios y explicaciones. Los rangos son objetivos didácticos del avatar, no una evaluación médica ni medidas universales.
- `ergonomics.css`: presentación adaptable. Todos los puntos de la escena tienen un control equivalente accesible mediante teclado.

Referencias de contenido: [posturas](https://www.osha.gov/etools/computer-workstations/positions), [monitor](https://www.osha.gov/etools/computer-workstations/components/monitors), [silla y reposapiés](https://www.osha.gov/etools/computer-workstations/components/chairs). La pausa es una secuencia orientativa de movilidad suave que se adapta a la comodidad de cada persona.

Prueba local (la carpeta `tests` está excluida del repositorio por la configuración existente): `npx playwright test -c tests/ergonomics.config.ts`. Cubre las tres misiones, comparación, temporizador, cierre, controles móviles y falta de WebGL con datos simulados, sin modificar datos reales.

### Personaje humano, sonido y pantalla completa

El personaje es `Business_Female_04` de Microsoft Rocketbox (MIT), convertido a GLB con el esqueleto y sus pesos de deformacion. El archivo `public/ergonomics/office-human.glb` incluye las texturas, materiales de piel y ropa y cabello con tarjetas transparentes. `ergonomicsPerson.ts` adapta las articulaciones al puesto mediante cinemática inversa para brazos y piernas. Ya no usa un cuerpo ensamblado a partir de primitivas. La carga tiene estados de espera y error y libera texturas, geometrías y esqueleto al cerrar.

`ergonomicsGuides.ts` amplía cada ajuste con qué observar, tres pasos y una comprobación personal. Las medidas son objetivos didácticos del avatar, no medidas universales.

`useErgoAmbience.ts` mezcla tres grabaciones CC0 **sin aves** (hojas y viento, arroyo, lluvia suave) en tres paisajes que se eligen en la barra del juego. Cada archivo es un bucle de 80–95 s con fundido cruzado ya aplicado y 0,5 s de relleno circular en ambos extremos, así que no hay cortes aunque el decodificador MP3 añada retardo. Las capas tienen duraciones distintas, empiezan en un punto aleatorio y el viento varía lentamente de nivel, para que el ambiente no se perciba repetido. Un filtro de paso alto quita el ruido grave y un recorte de agudos suaviza el siseo. Volumen, silencio y paisaje se recuerdan en `localStorage`; el audio se suspende con la pestaña oculta y el contexto se libera al cerrar. Los únicos sonidos generados son campanas suaves al terminar un movimiento o una misión, y respetan el silencio.

La interfaz usa los tokens de color de la aplicación (verde y magenta de marca) y sigue el tema claro u oscuro; la escena 3D cambia su paleta al cambiar el tema. La escena usa un mapa de entorno para los reflejos, una ventana con paisaje, un haz de luz que explica el reflejo en pantalla, lámpara, planta con hojas y marcadores magenta (pendiente) o verdes (ajustado). Los ajustes y las vistas se animan suavemente.

En la pausa activa, cabeza, cuello y pantalla quedan quietos (el monitor usa la altura de ojos sentada del puesto, no la del cuerpo en movimiento), las manos se mueven lejos del escritorio y una cámara guiada hace un plano cercano de la zona que se mueve en cada paso, con un desplazamiento lento. Arrastrar la escena toma el control de la cámara hasta el siguiente paso.

Una voz guía masculina acompaña la pausa: presentación al entrar, instrucción al comenzar cada movimiento, un recordatorio a mitad (a los 8 s restantes), aviso al terminar cada paso y cierre. Son 11 frases pregeneradas con Kokoro (`em_alex`, Apache 2.0) en `public/ergonomics/voice/` (≈680 KB, se precargan al abrir la pausa), así que suena igual en todos los dispositivos, sin servicios externos. Mientras habla, el ambiente baja al 40 %. Pausar o salir de la pausa la silencia. Se puede desactivar con el interruptor «Voz guía», que se recuerda; el texto en pantalla sigue siendo la guía completa. Para cambiar una frase, edita el guion en `scripts/ergonomics-voice.py` y vuelve a generar ese archivo con la misma voz.

Licencias y fuentes: `public/ergonomics/CREDITS.md` y `ROCKETBOX-LICENSE.txt`. Los recursos están alojados con la aplicación, sin dependencias de una API de avatares ni del servidor de audio original.

La pantalla completa usa la API del navegador. Si no está disponible, se abre una vista ampliada con fondo inerte y foco de teclado contenido. Escape y el botón de reducir permiten salir y restauran el desplazamiento. En escritorio, los controles se desplazan por separado.
