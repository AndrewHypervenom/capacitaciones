# Drive / Academy

Juego de repaso en `/games/drive/:id`. Conserva el banco de preguntas, la publicación y los permisos de la zona de juegos.

## Controles

- Responder con las opciones en pantalla o las teclas **1–4**.
- **C** cambia entre cámara de persecución y capó.
- **P** pausa o reanuda.
- El sonido requiere activación explícita. Se silencia al pausar o abandonar la pestaña.
- La calidad **Detallada** incluye sombras dinámicas y mayor resolución; **Fluida** reduce la resolución y desactiva esas sombras. Solo se cambia con el auto detenido.
- Movimiento reducido mantiene las preguntas y los avances sin desplazamiento del escenario.

## Escena

`drivingWorld.ts` construye la ciudad, las texturas, el deportivo, el tráfico y los semáforos con Three.js. No descarga modelos ni texturas desde terceros. La iluminación usa un entorno generado localmente, materiales físicos, mapeo de tonos ACES y niebla.

`DrivingScene.tsx` administra cámaras, aceleración, frenado, ruedas, resolución y liberación de recursos. Deja de renderizar cuando no hay movimiento ni cambios de cámara. La pérdida de WebGL conserva la actividad de preguntas.

Las partidas son prácticas: los aciertos mostrados pertenecen a la partida actual y no alteran las notas ni los XP de los cursos.

## Verificación

Con Vite en el puerto 5178:

```sh
npx playwright test -c tests/driving.config.ts --reporter=list
npm run build
```

Las pruebas usan sesiones y respuestas de Supabase simuladas, sin modificar datos de producción.

## Vista inmersiva

La ciudad ocupa todo el viewport. Las preguntas, pistas, pausa y resultados se renderizan como un objeto `CSS3DObject` conectado al grupo del semáforo, mediante un portal de React. La misma cámara controla WebGL y el panel: los botones mantienen interacción táctil, foco y teclado mientras su superficie conserva perspectiva 3D.

Mover el mouse sobre el escenario produce un desplazamiento lateral suave y acotado. Al apuntar a botones o al panel, se conserva el destino de la cámara para facilitar la selección. Pausa y movimiento reducido neutralizan este movimiento.

En pantallas estrechas, el panel queda debajo del semáforo. Las preguntas largas tienen desplazamiento interno; la página nunca desplaza el escenario. El bloqueo del scroll del documento se elimina al salir del juego.

