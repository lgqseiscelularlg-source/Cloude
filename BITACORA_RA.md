# Bitácora técnica – RealityTour RA (repositorio `Cloude`)

> Responsable técnica: **Robin** (IA de ingeniería). Supervisión: **Nami** (IA supervisora). Dirección: **Ale / Capitán**.
> Rama de trabajo: `claude/zealous-ramanujan-j9jf59`
> Última actualización: 2026-10-16 – Entrada #1 (sólo análisis, sin cambios funcionales).

## Convenciones de esta bitácora

| Etiqueta | Significado |
|---|---|
| ✅ **CONFIRMADO** | Comprobado leyendo el código (archivo y líneas citados). No requiere prueba en dispositivo para afirmarse. |
| 🟡 **HIPÓTESIS** | Explicación plausible deducida del código, **pendiente de verificar** en smartphone o navegador. |
| 🔵 **SOLUCIÓN NO VERIFICADA** | Cambio propuesto o implementado que **todavía no se probó** en smartphone real vía GitHub Pages. |
| 🟢 **VERIFICADO EN DISPOSITIVO** | Probado y aceptado por el Capitán en smartphone real. (Ninguno todavía.) |

Las referencias de líneas corresponden al commit `bdc867f` (estado actual de `main`).

---

## 1. Estado actual de las funcionalidades de RA

Stack: A-Frame **1.2.0**, AR.js **1.7.5** (`aframe-ar.js` vía rawcdn.githack), modelo GLB `./models/goku.glb`.

| Funcionalidad | Estado | Evidencia |
|---|---|---|
| Cámara (webcam AR.js) | Funciona (según el Capitán) | `index.html:36` `arjs="sourceType: webcam; ..."` |
| Geolocalización / ancla GPS | Funciona (según el Capitán) | `index.html:39-44` `#anchor` con `gps-entity-place` (lat −29.477051, lon −66.889616) |
| Aparición del modelo dentro de 15 m | Funciona (según el Capitán) | `script.js:133, 189-213` `watchPosition` + Haversine |
| Indicador de distancia | Funciona | `script.js:197-198`, `#distancia-display` |
| Botón «Continuar igualmente» (escritorio) | Funciona | `index.html:18-25`, `script.js:129-131` |
| Rotación horizontal (1 dedo) | **Funciona** | `script.js:174-176` |
| Rotación vertical (1 dedo) | **No funciona** | No existe código (ver D1) |
| Zoom con pinza (2 dedos) | **No funciona correctamente** | Ver D2–D4 |
| Mantener posición geográfica durante gestos | Parcial | El modelo no es hijo del ancla (ver D4) |

Archivos del repo: `index.html` (escena AR), `script.js` (gestos + geolocalización), `style.css`. Ajenos a la RA: `ARanterior.html`, `principalPausada.html`, `Focus-main.zip` (landing del sitio). `script.js` y `style.css` de la raíz son idénticos a los incluidos en el zip.

---

## 2. Diagnóstico técnico

### Flujo actual
1. `#anchor` (vacío) recibe posición de `gps-entity-place` relativa a `gps-camera`.
2. `watchPosition` calcula distancia; al entrar en 15 m llama a `crearModeloInteractivo(anchor)` (`script.js:218-239`).
3. Esa función crea un `a-entity` con el GLB **como hijo de `a-scene`** (no del ancla), escala `300 300 300`, y copia **una sola vez** la posición mundial del ancla + 2 m en Y.
4. `#gesture-layer` (div transparente, `position:fixed; inset:0; z-index:999`) captura `touchstart`/`touchmove` y modifica `currentModel.object3D`.

### Hallazgos

**D1 – ✅ CONFIRMADO: la rotación vertical nunca se implementó.**
`script.js:159-185`: sólo se guarda `startX` y sólo se escribe `rotation.y`. No hay `startY`, ni lectura de `pageY` en 1 dedo, ni escritura de `rotation.x`. No es un conflicto con librerías.

**D2 – ✅ CONFIRMADO: `#log-console` está por encima de la capa de gestos.**
`index.html:55-67`: `z-index: 10000`, `position: fixed; bottom: 0; width: 100%; maxHeight: 30vh`, sin `pointer-events: none`. `#gesture-layer` tiene `z-index: 999` (`style.css:70-76`). Toques que empiezan en la franja inferior van al log, no a la capa.
- Además el log crece sin límite: `logBox.innerHTML += ...` en cada `console.log`, que se llama en cada fix GPS (`script.js:195`).

**D3 – 🟡 HIPÓTESIS (alta probabilidad), derivada de D2: la pinza arranca con `pinchStartDist = 0` o desactualizado.**
Si el 2.º dedo toca sobre el log, `touchstart` con `touches.length === 2` no se dispara en `#gesture-layer` (`script.js:164-166` no se ejecuta). Los `touchmove` del 1.er dedo sí llegan con `e.touches.length === 2`, y en `script.js:178-181` se calcula `baseScale * now / pinchStartDist` → división por 0 → `Infinity` → clamp a `SCALE_MAX = 1500` (salto brusco), o con valor viejo → zoom incoherente. Requiere confirmación en dispositivo.

**D4 – ✅ CONFIRMADO: no hay `touchend` / `touchcancel`.**
Al pasar de 2 dedos a 1, `touchmove` usa `startX` antiguo (`script.js:175`) → salto de rotación. Pinza y rotación se interfieren.

**D5 – ✅ CONFIRMADO (código) / 🟡 HIPÓTESIS (efecto): el modelo no es hijo del ancla GPS.**
`script.js:226` `scene.appendChild(model)`; posición copiada una sola vez (`script.js:229-234`). Consecuencias posibles:
- Si el ancla aún no fue posicionada por `gps-entity-place`, su posición mundial es (0,0,0) → modelo en (0,2,0), sobre la cámara; con escala 300 el usuario puede quedar “dentro” del modelo y el zoom parecer inexistente. (Hipótesis.)
- Correcciones posteriores del ancla no se reflejan en el modelo.

**D6 – ✅ CONFIRMADO (teoría de three.js): `rotation.x` por Euler no sirve como rotación vertical “hacia la cámara”.**
Con orden Euler `XYZ` y padre sin rotación, `rotation.x` gira sobre el eje X del mundo. Mirando desde otra orientación, el gesto vertical se percibiría como giro lateral. Además el pivote del GLB suele estar en la base del modelo (🟡 hipótesis sobre `goku.glb`, no inspeccionado) → la inclinación se vería descentrada.

**D7 – ✅ CONFIRMADO: código muerto.**
`script.js:1-37` registra el componente `gesture-controls` que ningún elemento usa. Si se añadiera, duplicaría listeners en `window`. No es causa del fallo, pero confunde.

**D8 – ✅ CONFIRMADO (código): no hay conflicto de eventos con A-Frame/AR.js.**
`index.html:49` `look-controls="touchEnabled: false; ..."` impide que el toque rote la cámara; `gps-camera` no consume toques. **No se justifica actualizar versiones.**
🟡 Hipótesis secundaria: en iOS Safari, `user-scalable=no` se ignora; `touch-action: none` en la capa debería bastar, pero no se ha verificado en iPhone.

**D9 – ✅ CONFIRMADO: riesgo de despliegue.**
El repo no contiene `models/goku.glb` fuera de `Focus-main.zip`. Si GitHub Pages sirve este repo, `./models/goku.glb` daría 404. Pendiente saber qué repo publica Pages (ver §7).

---

## 3. Plan de implementación propuesto — 🔵 SOLUCIÓN NO VERIFICADA (no implementada)

### 3.1 Jerarquía de entidades (separar GPS de interacción)
```
#anchor        (gps-entity-place)          ← SÓLO geolocalización; nunca se rota ni se escala
 └─ #model-pivot (position 0 2 0, scale 300) ← rotación (quaternion) + escala del gesto
     └─ #model   (gltf-model goku.glb)      ← centrado por bounding box al cargar
```
- La escala del pivote es **escala visual**; las coordenadas GPS del ancla no se modifican.
- Al ser hijo del ancla, el modelo sigue cualquier reposicionamiento GPS.

### 3.2 `crearModeloInteractivo(anchor)` (`script.js:218-239`)
- Crear `pivot` (`a-entity`, `position="0 2 0"`, `scale="300 300 300"`) y hacer `anchor.appendChild(pivot)`.
- Crear `model` con `gltf-model="./models/goku.glb"` como hijo de `pivot`.
- En el evento `model-loaded`: `const box = new THREE.Box3().setFromObject(mesh); const c = box.getCenter(new THREE.Vector3());` y desplazar el mesh en `-c` (en espacio local) para que el pivote quede en el centro visual.
- `modelClone = pivot; currentModel = pivot;` → la eliminación al salir del radio (`script.js:206-208`) sigue funcionando igual.

### 3.3 Reescritura del bloque de gestos (`script.js:141-185`)
- Estado: `mode` (`'rotate' | 'pinch' | null`), `lastX`, `lastY` (incremental por evento, no desde el inicio), `pinchStartDist`, `baseScale`, `tilt` acumulado.
- `touchstart`, `touchend`, `touchcancel` → función `resync(e)`:
  - `touches.length === 1` → `mode='rotate'`, reiniciar `lastX/lastY`.
  - `touches.length === 2` → `mode='pinch'`, `pinchStartDist = dist`, `baseScale = pivot.scale.x`.
  - `0` → `mode=null`.
- `touchmove`, 1 dedo:
  - `dx` → cuaternión sobre eje Y del ancla (`(0,1,0)`), ángulo `dx * ROT_SENS`.
  - `dy` → cuaternión sobre el eje “derecha de la cámara” proyectado al plano horizontal: obtener `camera.object3D.getWorldQuaternion(q)`, `right = (1,0,0).applyQuaternion(q)`, `right.y = 0; normalize()`; convertir a espacio local del ancla (el ancla no rota, por lo que coincide con el mundo; se hará la conversión igualmente por seguridad).
  - Aplicar con `pivot.object3D.quaternion.premultiply(q)`.
  - Limitar inclinación acumulada a ±80° para no voltear el modelo.
- `touchmove`, 2 dedos: `s = baseScale * now / pinchStartDist`, sólo si `pinchStartDist > 10 px`; clamp `[50, 1500]` (valores actuales). Sin rotación mientras hay 2 dedos.
- `preventDefault()` en todos los handlers (`passive: false`, como hoy).
- Evitar robo de toques: `pointer-events: none` en log y etiquetas (preferido) en lugar de mover listeners a `document`.

### 3.4 Otros cambios mínimos
- Eliminar componente muerto `gesture-controls` (`script.js:1-37`).
- Log en pantalla: `pointer-events: none` y conservar sólo las últimas ~30 líneas (no se elimina; es útil para depurar en el móvil).
- `#distancia-display`, `#version-label`: `pointer-events: none`.
- `index.html:28`: “Versión 77” → “Versión 78” para confirmar que el móvil no muestra versión cacheada.
- **Sin cambios** en `<a-scene>`, `gps-camera`, `look-controls`, versiones de librerías, ni `#desktop-warning` / «Continuar igualmente» (z-index 2000, sigue por encima de la capa).

---

## 4. Archivos y funciones a modificar (cuando se autorice)

| Archivo | Elemento | Cambio |
|---|---|---|
| `script.js` | `AFRAME.registerComponent("gesture-controls")` (l. 1-37) | Eliminar (código muerto) |
| `script.js` | Bloque de gestos de `#gesture-layer` (l. 141-185) | Reescribir: resync, rotación vertical por cuaternión, pinza protegida |
| `script.js` | `crearModeloInteractivo(anchor)` (l. 218-239) | Pivote hijo del ancla + centrado del GLB |
| `index.html` | Script de log en pantalla (l. 55-74) | `pointer-events:none`, límite de líneas |
| `index.html` | `#version-label` (l. 28) | Versión 78 |
| `style.css` | `#distancia-display`, `#version-label` | `pointer-events:none` |
| (posible) `models/goku.glb` | — | Añadir sólo si Pages sirve este repo y el Capitán lo autoriza |

No se tocan: `watchPosition`, `calcularDistancia`, lógica de radio, cámara, aviso de escritorio, `ARanterior.html`, `principalPausada.html`, `Focus-main.zip`.

---

## 5. Riesgos y posibles efectos secundarios

| # | Riesgo | Mitigación |
|---|---|---|
| R1 | Al ser hijo del ancla, el modelo hereda cualquier transformación que `gps-entity-place` aplique al ancla (en AR.js 1.7.5 sólo posición, según lo conocido; 🟡 no verificado si aplica escala por distancia). | Comprobar en dispositivo que el tamaño inicial es similar al actual; si el ancla escala, ajustar escala base. |
| R2 | El centrado por bounding box cambia la altura aparente (antes la base estaba a +2 m; ahora el centro). | Ajustar `position Y` del pivote si se ve demasiado bajo/alto. |
| R3 | Sensibilidades (`ROT_SENS`) distintas a las actuales pueden sentirse diferentes. | Mantener 0.005 rad/px inicialmente. |
| R4 | `pointer-events:none` en el log impide hacer scroll del log con el dedo. | Aceptable; es sólo depuración. |
| R5 | iOS Safari puede seguir disparando zoom de página / `gesturestart`. | 🟡 Si ocurre, añadir `preventDefault` en `gesturestart`. |
| R6 | Caché de GitHub Pages / navegador muestra versión vieja. | Etiqueta “Versión 78”; recarga forzada. |
| R7 | Falta `models/goku.glb` en este repo (D9). | Decisión pendiente §7. |
| R8 | El ancla posicionada tarde (D5) puede seguir colocando el modelo mal en los primeros instantes. | Al ser hijo, se corrige solo cuando llegue la posición GPS. |

---

## 6. Pruebas necesarias

### 6.1 Automatizadas (posibles en el entorno de Robin; validan lógica, **no** la experiencia real)
- `node --check script.js`.
- Servidor local + Chromium (Playwright) con `hasTouch`, geolocalización simulada dentro del radio, cámara falsa. Inyectar toques sintéticos: 1 dedo horizontal, 1 dedo vertical, pinza abrir/cerrar, levantar un dedo durante la pinza, 2.º dedo sobre zona del log. Verificar: cuaternión y escala del pivote cambian, posición del ancla no cambia, sin `NaN`/`Infinity`.

### 6.2 En smartphone real (validación definitiva, vía GitHub Pages)
1. Abrir URL; confirmar “Versión 78”; aceptar cámara y ubicación; estar a ≤ 15 m del objetivo hasta ver el modelo.
2. **Rotación horizontal:** 1 dedo izquierda↔derecha → gira sobre su eje vertical; al soltar no salta.
3. **Rotación vertical:** 1 dedo arriba↕abajo → se inclina hacia/desde la cámara (no lateralmente). Repetir mirando desde 2 orientaciones distintas.
4. **Zoom:** separar dedos agranda, juntar achica; repetir con un dedo en el tercio inferior (zona del log). Levantar un dedo durante la pinza → sin salto.
5. **Geolocalización:** tras los gestos, caminar unos pasos y girar el móvil → el modelo permanece en el mismo lugar; la distancia mostrada no varía por los gestos.
6. **Regresión:** en escritorio, «Continuar igualmente» cierra el aviso; la cámara sigue funcionando.
7. Anotar en esta bitácora: modelo de teléfono, navegador, resultado de cada paso.

---

## 7. Decisiones pendientes de autorización del Capitán

| # | Decisión | Estado |
|---|---|---|
| P1 | Implementar el plan §3 en `script.js`, `index.html`, `style.css` | ⏳ Pendiente |
| P2 | ¿Qué repositorio publica GitHub Pages (`Cloude` o `Focus`)? ¿Subir `models/goku.glb` a este repo? | ⏳ Pendiente |
| P3 | Eliminar el componente muerto `gesture-controls` | ⏳ Pendiente (incluido en P1) |
| P4 | Límite de inclinación ±80° y rango de escala 50–1500 | ⏳ Pendiente (valores propuestos) |

---

## 8. Historial cronológico de intervenciones

| # | Fecha | Autor | Tipo | Descripción | Archivos | Verificación |
|---|---|---|---|---|---|---|
| 1 | 2026-10-15 | Robin | Análisis | Auditoría de interacción táctil (Fase 1) y propuesta de solución (Fase 2). Sin cambios funcionales. | — | N/A |
| 2 | 2026-10-16 | Robin | Documentación | Creación de `BITACORA_RA.md` con diagnóstico, plan, riesgos y pruebas. Autorizado por el Capitán. | `BITACORA_RA.md` | N/A |

<!-- Nuevas entradas: añadir filas al final; no borrar historial. -->
