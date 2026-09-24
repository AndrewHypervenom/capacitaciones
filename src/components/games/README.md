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
