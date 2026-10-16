# Bitácora técnica – RealityTour RA (repositorio `Cloude`)

> Responsable técnica: **Robin** (IA de ingeniería). Supervisión: **Nami** (IA supervisora). Dirección: **Ale / Capitán**.
> Rama de trabajo: `claude/zealous-ramanujan-j9jf59` (no fusionada a `main`).
> Última actualización: 2026-10-16. Entrada #5: evaluación de la geolocalización real (sólo análisis y experimento aislado, sin cambios funcionales). Ver **§9**.
> Estado v78: gestos **🟢 verificados en dispositivo** por el Capitán (entrada #4).

## Convenciones de esta bitácora

| Etiqueta | Significado |
|---|---|
| ✅ **CONFIRMADO** | Comprobado en el código (con archivo y líneas citados) o reproducido en emulación. |
| 🟡 **HIPÓTESIS** | Explicación plausible, **pendiente de verificar** en smartphone o navegador. |
| 🔵 **SOLUCIÓN NO VERIFICADA** | Cambio implementado que **todavía no se probó** en un smartphone real vía GitHub Pages. |
| 🧪 **VERIFICADO EN EMULACIÓN** | Pasa las pruebas automáticas en Chromium headless con toques simulados (CDP), cámara falsa y GPS simulado. **No equivale** a validación en dispositivo. |
| 🟢 **VERIFICADO EN DISPOSITIVO** | Probado y aceptado por el Capitán en un smartphone real. (Ninguno todavía.) |

Las líneas del tipo `archivo:N` del diagnóstico (§2) se refieren al commit `bdc867f` (estado de `main`). Las de la implementación (§3–4) se refieren a la rama de trabajo.

---

## 1. Estado de las funcionalidades de RA

Stack: A-Frame **1.2.0**, AR.js **1.7.5** (`aframe-ar.js` vía rawcdn.githack) y el modelo GLB `./models/goku.glb`.

| Funcionalidad | En `main` (antes) | En la rama (después) |
|---|---|---|
| Cámara (webcam AR.js) | Funciona | Sin cambios |
| Activación por distancia (≤ 15 m, `watchPosition` + Haversine) | Funciona | Sin cambios |
| Indicador de distancia | Funciona | Sin cambios (🧪) |
| Botón «Continuar igualmente» (escritorio) | Funciona | Sin cambios (🧪) |
| **Posicionamiento 3D por GPS** (`gps-camera` / `gps-entity-place`) | ⚠️ **No existe** en AR.js 1.7.5 (ver D10) | Sin cambios. Se sustituyó deliberadamente por el perímetro (ver D10). Evaluación de recuperarlo: §9 |
| Rotación horizontal (1 dedo) | Funciona | 🟢 verificada en dispositivo (v78) |
| Rotación vertical (1 dedo) | No funciona | 🟢 verificada en dispositivo (v78) |
| Zoom con pinza (2 dedos) | Falla (salta a escala máxima) | 🟢 verificado en dispositivo (v78) |
| Límite de inclinación (no queda boca abajo) | — | 🟢 verificado en dispositivo (v78) |
| El modelo no se desplaza con los gestos | Parcial | 🧪 verificado en emulación; en dispositivo no se reportó por separado |

Archivos del repo: `index.html` (escena AR), `script.js` (gestos y geolocalización), `style.css`, `models/goku.glb` (nuevo en la rama), `.nojekyll` (nuevo). Ajenos a la RA: `ARanterior.html`, `principalPausada.html` y `Focus-main.zip` (landing del sitio). Los repositorios `Focus` y `UmbrellaV1` no se tocan.

---

## 2. Diagnóstico técnico

### Flujo original (`main`)
1. `#anchor` es una entidad vacía con el atributo `gps-entity-place`.
2. `watchPosition` calcula la distancia. Al entrar en el radio de 15 m llama a `crearModeloInteractivo(anchor)` (`script.js:218-239`).
3. Esa función crea el GLB **como hijo de `a-scene`** con escala `300 300 300`. Copia **una sola vez** la posición mundial del ancla y le suma 2 m en Y.
4. `#gesture-layer` (div transparente, `z-index:999`) recibe `touchstart` y `touchmove` y modifica `currentModel.object3D`.

### Hallazgos

**D1 – ✅ CONFIRMADO: la rotación vertical nunca se implementó.**
En `script.js:159-185` sólo se guarda `startX` y sólo se escribe `rotation.y`. 🧪 Reproducido en `main`: un arrastre vertical deja la rotación en `[0,0,0]`.

**D2 – ✅ CONFIRMADO: `#log-console` está por encima de la capa de gestos.**
En `index.html:55-67` tiene `z-index:10000`, ocupa hasta el 30 % inferior de la pantalla y no tiene `pointer-events:none`. Además crece sin límite (`innerHTML +=` en cada fix GPS, `script.js:195`).

**D3 – ✅ CONFIRMADO (🧪 reproducido en `main`): la pinza salta a la escala máxima.**
Con el log lleno (empieza en y=560 en una pantalla de 800 px), si el 2.º dedo cae sobre el log la capa no recibe el `touchstart` de 2 dedos. Entonces `pinchStartDist` queda en 0, el cálculo da `Infinity` y la escala se recorta a **1500**. Medición en `main`: escala 300 → **1500** con un movimiento pequeño. *(Antes figuraba como hipótesis; queda confirmada en emulación.)*

**D4 – ✅ CONFIRMADO: no había `touchend` ni `touchcancel`.**
Al pasar de 2 dedos a 1 se usaba un `startX` viejo y la rotación saltaba.

**D5 – ✅ CONFIRMADO: el modelo no era hijo del ancla.**
`script.js:226` hace `scene.appendChild(model)` y la posición se copia una sola vez.

**D6 – ✅ CONFIRMADO: `rotation.x` (Euler) no sirve para la rotación vertical.**
Ese eje está fijo en el mundo, no relativo a la cámara: según hacia dónde mire el usuario, el arrastre vertical se vería como un giro lateral.

**D7 – ✅ CONFIRMADO: código muerto.**
El componente `gesture-controls` (`script.js:1-37`) no lo usa ningún elemento. Se eliminó.

**D8 – ✅ CONFIRMADO: no hay conflicto de eventos táctiles con A-Frame ni AR.js.**
`look-controls="touchEnabled:false"` impide que el toque mueva la cámara. 🟡 En iOS Safari falta comprobar el zoom nativo de la página; se añadió `gesturestart → preventDefault` como mitigación.

**D9 – ✅ CONFIRMADO y resuelto en la rama: faltaba `models/goku.glb`.**
El modelo sólo estaba dentro de `Focus-main.zip`. Se extrajo sin modificaciones (ver §3.5).

**D10 – ✅ CONFIRMADO (hallazgo nuevo, importante): AR.js 1.7.5 no contiene geolocalización 3D.**
- El build `aframe/build/aframe-ar.js` del tag `1.7.5` (el mismo que sirve rawcdn.githack) tiene **0 apariciones** de `gps`. Sólo registra `arjs`, `arjs-anchor`, `arjs-hit-testing` y primitivas de marcadores.
- Tampoco las tienen los tags `1.7.7` ni `2.0.0` de `jeromeetienne/AR.js`; sólo la rama `master` las incluye.
- A-Frame ignora en silencio los atributos de componentes no registrados. Por eso `gps-camera`, `gps-entity-place` y `rotation-reader` **no hacen nada**.
- Consecuencias:
  - `#anchor` está siempre en `(0,0,0)`, que es el origen de la escena: el punto donde arranca el usuario, no las coordenadas GPS.
  - El GPS sólo se usa para la distancia y para mostrar u ocultar el modelo.
  - El modelo aparece en una posición **relativa al usuario**. Medido en emulación: centro visual ≈ `(1.9, 2.56, −29.7)` m, es decir, unos 30 m en la dirección −Z de la escena y unos 2,6 m de altura (el GLB de Sketchfab trae su geometría desplazada del origen).
- Esto **no lo causan los gestos** y la presente intervención **no lo cambia**. Para que el modelo quede anclado a las coordenadas reales haría falta otra versión o implementación de AR.js: queda como decisión pendiente (§7, P5).
- **Contexto aportado por el Capitán y Nami (entrada #4):** el perímetro de 15 m con el modelo a una distancia fija del origen de la escena fue una **decisión deliberada**, tomada porque el anclaje GPS original no funcionaba. No es un error accidental. D10 explica técnicamente por qué aquel intento falló: la versión 1.7.5 de AR.js cargada no incluye los componentes GPS.

**D11 – 🟡 HIPÓTESIS: el cálculo de límites del GLB es aproximado.**
El GLB es un *SkinnedMesh* con 1 skin y 15 animaciones (que no se reproducen). En three.js, `Box3.setFromObject` usa la geometría sin aplicar los huesos, así que el tamaño medido (≈ 2 × 6 × 2 cm) no coincide con el renderizado (~5 m de alto a 30 m). Aun así, el centro medido **coincide con la posición del modelo en pantalla**: en las capturas el modelo gira en su sitio. Falta confirmar en el teléfono que gira sobre su centro visual (§6.2, paso 3).
- *Actualización (entrada #4):* el Capitán confirma en dispositivo que el modelo rota sobre su eje sin quedar boca abajo → 🟢 en v78 (A-Frame 1.2.0 / three r125).
- *Actualización (entrada #5):* con three r164 (A-Frame 1.6.0), `Box3.setFromObject` **sí** aplica el esqueleto y da una caja errónea para este GLB (≈ 843 × 1769 × 942 unidades, centrada a ~9 km). Ver D15 en §9.

---

## 3. Implementación — 🔵 SOLUCIÓN NO VERIFICADA EN DISPOSITIVO (🧪 verificada en emulación)

### 3.1 Jerarquía de entidades
```
#anchor   (atributo gps-entity-place, inerte en 1.7.5)  ← nunca se rota, escala ni desplaza
 └─ pivot  (a-entity, scale 300; position = centro visual previo)  ← rotación (quaternion) + escala de los gestos
     └─ model (gltf-model ./models/goku.glb)  ← su mesh se desplaza para centrarse en el pivote
```
- La escala del pivote es **visual**; las coordenadas del ancla no se tocan.
- Si en el futuro el ancla recibe posición GPS real, el pivote la seguirá automáticamente.

### 3.2 `crearModeloInteractivo(anchor)` y `centrarModeloEnPivote(pivot, model)` (`script.js`)
- El pivote se crea con `position "0 2 0"` (igual que antes) y `scale "300 300 300"`, y se añade **como hijo del ancla**.
- Al recibir `model-loaded`, se centra el modelo **respetando los espacios de coordenadas** (precaución 1 de Nami):
  1. `pivot.object3D.updateWorldMatrix(true, true)`.
  2. `centroMundo` = centro de `Box3.setFromObject(mesh)`, en coordenadas **mundiales**.
  3. `centroLocalModelo = model.object3D.worldToLocal(centroMundo)`, en el espacio **local del padre del mesh**. Luego `mesh.position.sub(centroLocalModelo)`.
  4. `centroLocalAncla = pivot.object3D.parent.worldToLocal(centroMundo)`, en el espacio **local del ancla**. Luego `pivot.setAttribute('position', centroLocalAncla)`.
  - Resultado: el centro visual coincide con el origen del pivote y el modelo **no se mueve en pantalla**. 🧪 Diferencia con la versión sin centrar: < 1 mm.
- `modelClone = pivot` y `currentModel = pivot`. Al salir del radio también se pone `currentModel = null`.

### 3.3 Gestos (`script.js`, bloque `#gesture-layer`)
- **Estado:** `gestureMode` (`'rotate' | 'pinch' | null`), `lastX` y `lastY` (incrementales), `pinchStartDist`, `baseScale`.
- **`syncGesture(e)`:** se llama en `touchstart`, `touchend` y `touchcancel`, y reinicia la referencia según `e.touches.length`. Así no hay saltos al cambiar el número de dedos.
- **1 dedo** (`computeAxes` calcula los ejes en el espacio local del ancla):
  - **Horizontal:** cuaternión sobre la vertical del mundo `_up`, con ángulo `−dx·0.005` (mismo sentido y sensibilidad que antes), aplicado con `premultiply`.
  - **Vertical:** cuaternión sobre la «derecha» de la cámara proyectada al plano horizontal, con ángulo `dy·0.005`. Arrastrar hacia abajo acerca la parte superior del modelo a la cámara.
- **Límite de ±80° (precaución 2 de Nami):**
  - La inclinación es el ángulo entre el «arriba» del modelo y la vertical del mundo (`tiltOf`).
  - La rotación horizontal es sobre esa misma vertical, así que **no puede cambiar la inclinación**: el límite se mantiene al combinar ambos gestos.
  - En la vertical (`applyTilt`), si el giro supera 80° y aumenta la inclinación, se busca por bisección (12 iteraciones) la mayor fracción del giro que respeta el límite.
  - Se normaliza el cuaternión en cada evento.
- **2 dedos:** `s = baseScale · dist/pinchStartDist`, limitada a `[50, 1500]`. Si los dedos empiezan a menos de 10 px, se toma la referencia en el primer movimiento. Mientras dura la pinza no se rota.
- **iOS:** `document.addEventListener('gesturestart', e => e.preventDefault())`.

### 3.4 Interfaz (`index.html`, `style.css`)
- Log en pantalla: `pointer-events:none` y como máximo 30 líneas (con `textContent` en lugar de `innerHTML`), con desplazamiento automático al final.
- `#distancia-display` y `#version-label`: `pointer-events:none`.
- Etiqueta: «Versión 77» → **«Versión 78»**.
- **Sin cambios** en `<a-scene>`, la cámara, las versiones de A-Frame o AR.js, el aviso de escritorio, `watchPosition` ni `calcularDistancia`.

### 3.5 Recursos y GitHub Pages
- `models/goku.glb` se extrajo de `Focus-main.zip` **sin modificaciones**:
  - CRC32 `2c8405bc`, idéntico al del zip.
  - SHA-256 `e6899d758b6095bed6663f3a753e8706b10ec44a984dc7b05f2244f0fdde46be`.
  - Tamaño: 1 814 808 bytes, dentro del límite de GitHub.
  - Licencia CC-BY-4.0 (autor «BEN10», Sketchfab), indicada en los metadatos del GLB.
- `.nojekyll` (vacío): GitHub Pages sirve los archivos tal cual, sin procesarlos con Jekyll.

---

## 4. Archivos y funciones modificados

| Archivo | Elemento | Cambio |
|---|---|---|
| `script.js` | `gesture-controls` | Eliminado (código muerto) |
| `script.js` | Bloque de gestos | Reescrito: `syncGesture`, `computeAxes`, `tiltOf`, `applyTilt`, handlers `touchstart`/`touchmove`/`touchend`/`touchcancel`, `gesturestart` |
| `script.js` | `crearModeloInteractivo` | Pivote hijo del ancla y modelo hijo del pivote |
| `script.js` | `centrarModeloEnPivote` | Nueva |
| `script.js` | `watchPosition` (salida del radio) | Añadido `currentModel = null` |
| `index.html` | Script del log | `pointer-events:none`, límite de 30 líneas |
| `index.html` | `#version-label` | Versión 78 |
| `style.css` | `#distancia-display`, `#version-label` | `pointer-events:none` |
| `models/goku.glb` | — | Nuevo (original sin modificar) |
| `.nojekyll` | — | Nuevo |
| `BITACORA_RA.md` | — | Actualizada |

---

## 5. Riesgos y efectos secundarios

| # | Riesgo | Estado y mitigación |
|---|---|---|
| R1 | El modelo no está anclado a coordenadas GPS reales (D10). | ✅ Ya ocurría en `main`; no lo introduce este cambio. Pendiente de decisión (P5). |
| R2 | El centrado usa el `Box3` aproximado de un SkinnedMesh (D11). | 🟡 En emulación gira en su sitio; comprobar en el teléfono. |
| R3 | Rotación horizontal «tipo tocadiscos»: gira sobre la vertical del mundo, no sobre el eje propio del modelo inclinado. | Decisión de diseño que garantiza el límite de ±80°. |
| R4 | Sentido de la inclinación (abajo = la parte superior se acerca) puede no ser el preferido. | Ajustable invirtiendo el signo de `dy`. |
| R5 | iOS Safari: el zoom nativo podría seguir activo. | 🟡 Mitigado con `gesturestart`; probar en iPhone. |
| R6 | Caché de GitHub Pages o del navegador. | Comprobar «Versión 78»; recargar sin caché. |
| R7 | AR.js descarga `camera_para.dat` de `jeromeetienne.github.io` (dependencia externa ya existente). | Sin cambios; si ese dominio cae, AR.js podría fallar. |
| R8 | El log ya no se puede desplazar con el dedo. | Aceptable (sólo depuración); se autodesplaza. |
| R9 | Si GitHub Pages publica esta rama, deja de publicar la que tuviera configurada. | Ver §6.3; volver a la rama anterior al terminar si hace falta. |

---

## 6. Pruebas

### 6.1 Automatizadas (🧪 Chromium 1194 headless + Playwright 1.56.1; toques reales vía CDP `Input.dispatchTouchEvent`)
- **Entorno:** viewport 412×800, `isMobile`, `hasTouch`, UA Android, cámara falsa, GPS simulado en el objetivo. A-Frame 1.2.0 (de npm) y AR.js 1.7.5 (de raw.githubusercontent, tag 1.7.5) servidos en local.
- **Sintaxis:** `node --check script.js` → OK.
- **Resultado: 30/31 PASS.** La única «falla» es la comprobación de errores de consola, y los tres que detectó son propios del entorno, no del código:
  - 404 de `/favicon.ico` (ya existía en `main`).
  - `ERR_TUNNEL_CONNECTION_FAILED` al descargar `camera_para.dat`: el sandbox no tiene acceso a ese dominio.
  - `GeolocationPositionError` al cambiar el GPS simulado durante la prueba.
- **Comprobaciones superadas:**
  - El pivote es hijo del ancla y el centro visual coincide con el anterior (< 1 mm) y con el origen del pivote.
  - **Horizontal:** rota, no inclina y el centro no se mueve.
  - **Vertical:** inclina 43° con un arrastre de 150 px.
  - **Límite de inclinación:** arrastres largos hacia abajo y hacia arriba → máximo 79,999°.
  - **Combinado:** 12 arrastres diagonales y en zigzag → la inclinación máxima nunca supera 80°, sin NaN y con el centro fijo.
  - **Pinza:** abrir 300 → 450 con el log lleno y el 2.º dedo sobre el log (y=700, el log empieza en y=560); cerrar → disminuye; extremos recortados a 1500 y 50; dedos casi juntos sin NaN; la pinza no rota.
  - **Levantar un dedo tras la pinza** y mover el otro 5 px: giro pequeño (0,009), sin salto.
  - **Ancla:** posición, rotación y escala sin cambios.
  - **Radio:** al salir se elimina el modelo y los gestos quedan inactivos; al volver se recrea.
  - Indicador de distancia y «Versión 78» presentes.
  - **Escritorio:** «Continuar igualmente» cierra el aviso.
- **Comparación con `main`, con el mismo método (reproduce los fallos):**
  - Arrastre vertical: rotación `[0,0,0]`.
  - Pinza con el 2.º dedo sobre el log: escala **300 → 1500**.
- **Capturas** (en el scratchpad de la sesión, no en el repo): modelo inicial, inclinado y tras zoom; se ve en el mismo sitio de la pantalla.
- **Límite:** esto valida la lógica, **no** la experiencia táctil, la orientación real del teléfono ni el GPS real.

### 6.2 En smartphone real (validación definitiva)
1. Abrir la URL de Pages (§6.3). Confirmar «**Versión 78**» abajo a la izquierda. Aceptar cámara y ubicación. Estar a ≤ 15 m del objetivo (−29.477051, −66.889616) hasta que el log muestre «✅ Modelo 3D interactivo creado».
2. **Localizar el modelo:** girar lentamente con el teléfono. Por D10 aparece a unos 30 m en una dirección fija respecto al punto donde se abrió la página, unos 2,6 m de altura.
3. **Rotación horizontal:** un dedo izquierda ↔ derecha. Gira en su sitio, sin saltos al soltar.
4. **Rotación vertical:** un dedo arriba ↕ abajo. Se inclina hacia y desde la cámara, no de lado. Repetir mirándolo con el teléfono en otra orientación. Seguir arrastrando: se detiene (≈ 80°) sin dar la vuelta.
5. **Combinado:** arrastres en diagonal y en círculos. Nunca queda boca abajo.
6. **Zoom:** separar dos dedos agranda y juntarlos achica. Repetir con un dedo en el **tercio inferior** (sobre el log verde). No debe saltar al tamaño máximo.
7. **Transición:** durante la pinza, levantar un dedo y seguir con el otro. Sin salto.
8. **Ubicación:** tras los gestos, el modelo sigue en el mismo lugar del espacio y la distancia mostrada no cambia por los gestos.
9. **Regresión:** en un ordenador, «Continuar igualmente» cierra el aviso; la cámara se ve.
10. Anotar en §8: modelo de teléfono, navegador, resultado de cada paso y capturas si es posible.

### 6.2.1 Resultados en smartphone de la versión 78 (reportados por el Capitán, entrada #4)

| Paso | Prueba | Resultado |
|---|---|---|
| 1 | Carga de la versión 78, permisos y aparición del modelo | 🟢 Confirmado (implícito: se probaron los gestos sobre el modelo) |
| 2 | Localizar el modelo | 🟢 Confirmado, con la observación O1 (ver abajo) |
| 3 | Rotación horizontal | 🟢 **Confirmado** |
| 4 | Rotación vertical + límite (no queda boca abajo) | 🟢 **Confirmado** |
| 5 | Combinado diagonal/circular | 🟢 Confirmado: «rotación sobre su eje sin quedar boca abajo» |
| 6 | Zoom con pinza | 🟢 **Confirmado** (pendiente confirmar específicamente con un dedo sobre el log) |
| 7 | Levantar un dedo durante la pinza | ⏳ No reportado |
| 8 | Ubicación tras los gestos | Ver O2: el modelo acompaña a la cámara al caminar (esperado en v78, ver abajo) |
| 9 | Regresión «Continuar igualmente» en escritorio | ⏳ No reportado |
| 10 | Modelo de teléfono y navegador | ⏳ No reportado (necesario para §9) |

**Observaciones en dispositivo y su explicación técnica:**
- **O1 – Al girar físicamente con el teléfono, el modelo sale del campo visual y reaparece al volver a mirar en su dirección.**
  - ✅ Es el **comportamiento esperado**. El modelo está fijo en una dirección de la escena, y `look-controls` (*magic window*) orienta la cámara con los sensores del teléfono.
  - Un modelo anclado geográficamente se comportará igual: sólo se ve al apuntar hacia él.
  - 🟡 Hipótesis: en v78 esa dirección es relativa a hacia dónde apuntaba el teléfono al abrir la página, no al norte real. `look-controls` usa el evento `deviceorientation`, que en Android es relativo; el absoluto es `deviceorientationabsolute`.
- **O2 – Al caminar, el modelo parece acompañar a la cámara.**
  - ✅ **Confirmado por el código (D10):** la posición de la cámara nunca cambia. No hay `gps-camera` operativo y AR.js no rastrea la posición por visión.
  - Por eso el modelo mantiene siempre el mismo desplazamiento respecto al usuario (≈ 30 m).
  - Es la limitación que motiva la evaluación de §9.

### 6.3 Publicar esta rama en GitHub Pages (pasos del Capitán)
1. GitHub → repositorio **Cloude** → *Settings* → *Pages*.
2. *Build and deployment* → *Source*: **Deploy from a branch**.
3. *Branch*: `claude/zealous-ramanujan-j9jf59`, carpeta **/ (root)** → *Save*.
4. Esperar el despliegue (pestaña *Actions*, «pages build and deployment»), 1–3 minutos.
5. Abrir `https://lgqseiscelularlg-source.github.io/Cloude/`. Pages sirve por HTTPS, que la cámara y el GPS necesitan.
6. Si se ve «Versión 77», recargar sin caché o abrir en una pestaña de incógnito.
- Nota: si el repositorio es privado, GitHub Pages requiere un plan de pago.

---

## 7. Decisiones pendientes

| # | Decisión | Estado |
|---|---|---|
| P1 | Implementar el plan en `script.js`, `index.html` y `style.css` | ✅ Autorizado e implementado (entrada #3) |
| P2 | Repositorio de Pages y `models/goku.glb` | ✅ Autorizado: GLB añadido a `Cloude` y repo preparado para Pages |
| P3 | Eliminar `gesture-controls` | ✅ Hecho |
| P4 | Límite de ±80° y escala 50–1500 | ✅ Aplicado |
| P5 | **Anclaje GPS real del modelo** (D10) | 🔎 Analizado en §9. Recomendación: prueba de concepto aislada con AR.js 3.4.8 + A-Frame 1.6.0. ⏳ Pendiente de autorización (P9) |
| P6 | Fusionar la rama a `main` | ⏳ Pendiente; sólo con autorización expresa. Gestos v78 ya 🟢 en dispositivo |
| P7 | Sentido de la inclinación (R4) y sensibilidad | ✅ Sin quejas en la prueba en dispositivo; se mantiene |
| P8 | Crear la etiqueta `v78` en el commit `ab62cc7` como punto de reversión | ⏳ Pendiente (es una escritura en GitHub; ver §9.10) |
| P9 | Implementar la prueba de concepto de §9.8 (archivos nuevos, sin tocar v78) | ⏳ Pendiente de autorización |
| P10 | Coordenada de prueba para la PoC: el objetivo real o una cercana al Capitán (vía `?lat=&lon=`) | ⏳ Pendiente |

---

## 8. Historial cronológico de intervenciones

| # | Fecha | Autor | Tipo | Descripción | Archivos | Verificación |
|---|---|---|---|---|---|---|
| 1 | 2026-10-15 | Robin | Análisis | Auditoría de la interacción táctil (Fase 1) y propuesta de solución (Fase 2). Sin cambios funcionales. | — | N/A |
| 2 | 2026-10-16 | Robin | Documentación | Creación de `BITACORA_RA.md`. Autorizado por el Capitán. Commit `fc65971`. | `BITACORA_RA.md` | N/A |
| 3 | 2026-10-16 | Robin | Implementación | Autorizada por el Capitán y Nami, con precauciones de espacios de coordenadas y límite de ±80°. Pivote hijo del ancla con centrado del GLB; rotación horizontal y vertical con cuaterniones y límite de ±80°; pinza protegida; `touchend`/`touchcancel`; log y etiquetas sin captura de toques; GLB extraído sin modificar; `.nojekyll`; versión 78. Hallazgos nuevos: D10 (AR.js 1.7.5 sin GPS 3D) y D11. D3 pasa de hipótesis a confirmado. Commit `ab62cc7`. | `script.js`, `index.html`, `style.css`, `models/goku.glb`, `.nojekyll`, `BITACORA_RA.md` | 🧪 30/31 en emulación (la única falla es del entorno). Ver #4 |
| 4 | 2026-10-16 | Capitán / Nami | Prueba en dispositivo | v78 en smartphone real: rotación horizontal, vertical, zoom y rotación sin quedar boca abajo **confirmados**. Observaciones O1 (desaparece al girar) y O2 (acompaña al caminar). Contexto: el perímetro de 15 m fue una decisión deliberada. | — | 🟢 Gestos v78 verificados en dispositivo. Pasos 7, 9 y 10 de §6.2 sin reportar |
| 5 | 2026-10-16 | Robin | Análisis + experimento aislado | Evaluación de la geolocalización real (§9): fuentes oficiales de AR.js (npm `@ar-js-org/ar.js` 3.4.8, documentación y ejemplos oficiales) y LocAR.js. Experimento en el scratchpad (**fuera del repo**) con A-Frame 1.6.0 + AR.js 3.4.8 + `script.js` v78: 16/16 en emulación tras 5 ajustes necesarios (D12–D16). Recomendación: PoC aislada. Sin cambios funcionales en el repo. | `BITACORA_RA.md` | 🧪 Emulación. 🔵 **Nada verificado en dispositivo** |

<!-- Nuevas entradas: añadir filas al final; no borrar historial. -->

---

## 9. Evaluación: anclaje geográfico real (entrada #5) — sólo análisis, sin implementar

> Objetivo del Capitán: un modelo **verdaderamente anclado** a coordenadas GPS, sin depender del perímetro de 15 m.
> Condiciones: no tocar el código funcional, no eliminar el perímetro, no alterar los gestos, no fusionar a `main`.
> El experimento descrito aquí se hizo en una **copia aislada en el scratchpad de la sesión**: nada de esto está en el repositorio.

### 9.1 Fuentes consultadas (verificadas por Robin, no de memoria)
- **Paquete npm oficial `@ar-js-org/ar.js`** (repositorio `AR-js-org/AR.js`): última versión **3.4.8**, publicada el 2026-03-16. Dependencias declaradas: `aframe ^1.6.0`, `three ^0.164.0`.
  - Los archivos del paquete npm son **idénticos byte a byte** a los del tag `3.4.8` en GitHub (SHA-256 comparado).
- **CHANGELOG oficial:**
  - 3.4.0: «New A-Frame location based code».
  - 3.4.3: suavizado de sensores y `latLonToWorld()`.
  - 3.4.4: opción `initialPositionAsOrigin`.
  - 3.4.6: «Upgraded Three.js and Aframe version to 0.164.0 and 1.6.0».
  - 3.4.8: altitud y soporte de iPad/iOS.
- **Documentación oficial** (`AR-js-org/AR.js-Docs`, `docs/location-based.md`):
  - Recomienda los componentes **`new-location-based`** (`gps-new-camera` + `gps-new-entity-place`) «in most cases».
  - Limitaciones declaradas: se necesita GPS, acelerómetro y magnetómetro; el norte puede ser incorrecto en algunos dispositivos (sensores mal calibrados); la imagen de la cámara puede verse estirada.
  - Proyección **Spherical Mercator** (EPSG:3857).
  - Contra el temblor: `smoothingFactor` 0,1 y `gpsMinDistance`.
  - Indica que el desarrollo futuro de la geolocalización se centrará en **LocAR.js**.
- **Ejemplo oficial** `aframe/examples/location-based/hello-world` (tag 3.4.8):
  - Carga A-Frame **1.6.0**, `ar-threex-location-only.js` y `aframe-ar.js`.
  - Escena con `arjs="sourceType: webcam; videoTexture: true"`, **sin `embedded`**, y la cámara declarada **antes** que las entidades.
- **LocAR.js** (`AR-js-org/locar.js`, npm `locar` 0.2.12):
  - Sólo three.js (three ^0.181), sin A-Frame.
  - Recomienda importarlo vía npm con un empaquetador (Vite); su README advierte problemas al incluir el bundle directamente.
  - Versión 0.x; funciona en Chrome y Safari (iOS/Android); Firefox no.
- **AR.js 1.7.5 (`jeromeetienne/AR.js`, el que usa v78):** sin componentes GPS (D10). Tampoco los tienen los tags 1.7.7 ni 2.0.0.

### 9.2 Opciones evaluadas

| Opción | Descripción | A favor | En contra | Veredicto |
|---|---|---|---|---|
| **A** | AR.js **3.4.8** oficial (`gps-new-camera` / `gps-new-entity-place`) + A-Frame **1.6.0** | Distribución oficial y mantenida (release 2026-03). Combinación probada por el propio proyecto. API declarativa que encaja con nuestro `#anchor`. Gestos v78 compatibles (🧪). Sin dependencias externas en tiempo de ejecución si se alojan los archivos en el repo. | Cambio de A-Frame 1.2 → 1.6 (three r125 → r164). Requiere 5 ajustes (D12–D16). Brújula y GPS con las limitaciones de §9.6. | ✅ **Recomendada para la PoC** |
| B | LocAR.js (three.js puro) | Línea de desarrollo futura de AR.js | Sin A-Frame: habría que reescribir la escena y los gestos. Requiere empaquetador (Vite) en lugar de HTML estático. Versión 0.x. | ❌ Ahora no: viola «no reconstruir desde cero» |
| C | Implementación propia sobre A-Frame 1.2 (posición desde `watchPosition` + brújula `deviceorientationabsolute` / `webkitCompassHeading`) | Sin cambiar versiones. Control total del norte en iOS. | Asumiríamos todo el código de sensores, proyección, suavizado y casos de borde. Más tiempo y más riesgo de errores. Reinventa lo que ofrece A. | 🟡 **Plan B** si la PoC A falla por la brújula en iOS |
| D | APIs geoespaciales nativas (p. ej. ARCore Geospatial) | Precisión superior (VPS) | No disponibles en el navegador móvil: exigen app nativa | ❌ Fuera del alcance (proyecto web) |

### 9.3 Compatibilidad comprobada (🧪 experimento aislado en emulación, **no** en dispositivo)
- **Entorno:** A-Frame 1.6.0 (npm) + `ar-threex-location-only.js` + `aframe-ar.js` de AR.js 3.4.8, con **el `script.js` de v78** y los 5 ajustes de §9.4 aplicados en la copia.
- **Simulación:** Chromium headless con toques CDP; GPS simulado 10 m al sur del objetivo; orientación simulada con `deviceorientationabsolute`.
- **Resultado: 16/16 PASS.**

| Comprobación | Resultado |
|---|---|
| Componentes `gps-new-*` registrados con A-Frame 1.6.0 | ✅ |
| Ancla al **norte** de la cámara (`dx=0`, `dz<0`) | ✅ |
| Distancia en unidades de escena = 10 m × sec(lat) = 11,47 (Mercator) | ✅ 11,474 |
| Mirando al norte (alpha=0, teléfono vertical): cámara hacia −Z y modelo **centrado en el encuadre** | ✅ NDC x=0,00, y=0,04 |
| Girar 90°: el modelo sale del encuadre (igual que O1) | ✅ |
| **Caminar 8 m al este: la cámara se desplaza 9,19 unidades y el ancla queda FIJA** (corrige O2) | ✅ |
| Al caminar al este, el modelo se desplaza hacia la izquierda de la pantalla (paralaje correcto) | ✅ |
| Movimiento de 2 m (< `gpsMinDistance` de 5 m): sin salto | ✅ |
| Gestos v78 **sin modificar**: horizontal, vertical (≤ 80°) y pinza | ✅ |
| Los gestos no mueven el ancla | ✅ |

- **Capturas** (en el scratchpad, no en el repo): con la orientación al norte, Goku aparece centrado sobre la coordenada a 10 m. Tras caminar 8 m al este, queda fuera del encuadre por la izquierda.
- El GLB se renderiza **idéntico** en A-Frame 1.2 y 1.6 (escena mínima sin AR, comparación visual).
- Con esta configuración no hubo peticiones a dominios externos (en v78 sí se descarga `camera_para.dat` de `jeromeetienne.github.io`).

### 9.4 Hallazgos nuevos del experimento (necesarios para migrar)
- **D12 – ✅ CONFIRMADO (🧪): carrera entre el GPS y la carga de la escena.**
  - Si `watchPosition` responde antes de que `<a-scene>` termine de cargar, `crearModeloInteractivo` crea un `gltf-model` sin su sistema y lanza `TypeError: getDRACOLoader`. La carga de la escena se aborta.
  - Ocurrió de forma sistemática con A-Frame 1.6.
  - 🟡 Hipótesis: es una carrera latente también en v78; en el teléfono no se manifestó.
  - Solución probada: esperar al evento `loaded` de la escena antes de crear el modelo.
- **D13 – ✅ CONFIRMADO (🧪): orden en el HTML.** `gps-new-entity-place` exige que `gps-new-camera` ya exista («gps-new-camera not initialised»). La cámara debe ir **antes** que `#anchor`, como en el ejemplo oficial.
- **D14 – ✅ CONFIRMADO (🧪): `initialPositionAsOrigin` obliga a asignar el ancla después del primer fix GPS.**
  - Sin esta opción, el mundo usa coordenadas Mercator absolutas (≈ 7,4 millones de unidades). En float32 la precisión ronda 0,5 m, lo que produciría temblor.
  - Con la opción activada, declarar `gps-new-entity-place` en el HTML lanza «Trying to use 'initial position as origin' mode with no initial position determined» y aborta la escena.
  - Solución probada: asignar el atributo al ancla en el primer evento `gps-camera-update-position`.
- **D15 – ✅ CONFIRMADO (🧪): el centrado del GLB debe cambiar.**
  - En three r164, `Box3.setFromObject` aplica el esqueleto y da una caja errónea para `goku.glb` (≈ 1,8 km de alto, centro a ~9 km). El centrado de v78 llevaría el modelo fuera de la vista.
  - Además, para un anclaje real el centro visual debe ir **sobre el ancla**, no conservarse a 30 m (el desplazamiento interno del GLB de Sketchfab).
  - Solución probada: estimar el centro con las posiciones mundiales de los **huesos** (funciona igual en r125 y r164) y llevarlo al origen del pivote.
- **D16 – ✅ CONFIRMADO (🧪): `embedded` deja la escena con altura 0 en A-Frame 1.6.**
  - Nuestro CSS no da tamaño a `<a-scene>`, así que el canvas queda en 412×0 y no se renderiza nada.
  - El ejemplo oficial no usa `embedded`. Solución probada: quitarlo.

### 9.5 Archivos y componentes que cambiarían (cuando se autorice)
- **PoC (propuesta, §9.8):** sólo **archivos nuevos**; `index.html`, `script.js` y `style.css` de v78 no se tocan.
- **Migración completa (sólo si la PoC cumple los criterios de §9.9):**

| Archivo | Cambio |
|---|---|
| `index.html` | Scripts: A-Frame 1.6.0 + `ar-threex-location-only.js` + `aframe-ar.js` 3.4.8, alojados en `lib/`. `arjs="sourceType: webcam; videoTexture: true; debugUIEnabled: false"`. Quitar `embedded` (D16). `<a-camera>` **antes** de `#anchor` (D13) con `gps-new-camera="gpsMinDistance: 5; positionMinAccuracy: 30; initialPositionAsOrigin: true"` y `arjs-device-orientation-controls="smoothingFactor: 0.1"`. Quitar `look-controls`, `gps-camera` y `rotation-reader` (inertes). `#anchor` sin `gps-entity-place` en el HTML (D14). |
| `script.js` | Asignar `gps-new-entity-place` al ancla tras el primer fix (D14). Esperar a `loaded` antes de crear el modelo (D12). Centrado por huesos sobre el ancla (D15). Perímetro: **se conserva**, como parámetro (p. ej. `radio = 200` m o desactivable), según P10. **Bloque de gestos: sin cambios** (🧪 compatible). |
| `style.css` | Probablemente nada. Si la imagen de la cámara se ve estirada (limitación documentada de AR.js), ajustar en una iteración posterior. |
| `lib/` (nuevo) | Copias exactas de las librerías con SHA-256 registrado (ver abajo). |

- Componentes **no** afectados: perímetro y distancia (`watchPosition`, `calcularDistancia`), log, aviso de escritorio y «Continuar igualmente», módulo de gestos.
- **SHA-256 de las librerías verificadas** (npm = tag de GitHub):
  - `aframe-v1.6.0.min.js`: `197b3200cecb0c5638a29788bc4eae42449eada9e4ef23f77c1d5598ecac17fc`
  - `aframe-ar.js` 3.4.8: `aec697f1662c8c2f2257eac149641a9f7b34c7c235fabcf7f67666a711ff917d`
  - `ar-threex-location-only.js` 3.4.8: `bb44e11bad879b7a0c9d74e90bc3cfb383ca6e2c44f3ab6e01a22f722b8f9204`

### 9.6 Riesgos

| # | Riesgo | Naturaleza | Impacto y mitigación |
|---|---|---|---|
| G1 | **Precisión GPS del teléfono**: típicamente 3–10 m a cielo abierto y 10–30 m entre edificios. Altitud poco fiable. | 🟡 Propiedad del hardware; medir en la PoC | Con el usuario a 10 m, 5 m de error equivalen a ~27° de desvío aparente; a 30 m, ~10°. El anclaje se percibe mejor **a 20–50 m** del punto. Mitigación: `positionMinAccuracy` ≈ 30 m, `gpsMinDistance` 5 m (menos temblor, pero saltos de 5 m). Mostrar la precisión en el HUD de la PoC. |
| G2 | **Brújula / norte**: magnetómetro con ±5–20° de error; interferencias de metal, autos y estructuras; requiere calibración (gesto en «8»). | 🟡 Documentado por AR.js como limitación | Un error de 15° a 30 m desplaza el modelo ~8 m. Mitigación: calibrar antes de probar; medir el desvío en la PoC. Si es sistemático en un modelo de teléfono, LocAR plantea una corrección por dispositivo (futuro). |
| G3 | **iOS Safari**: exige permiso de orientación tras un toque (AR.js muestra un aviso y escucha `touchend`). 🟡 Además, el control de AR.js usa `alpha`, que en iOS podría no estar referido al norte (iOS expone `webkitCompassHeading`). | 🟡 Hipótesis, sin probar | Probar en iPhone. Si el norte falla en iOS → plan B (opción C) para la orientación. Nuestro `touchend` no bloquea el de AR.js (sólo usamos `stopPropagation` en `touchstart`/`touchmove`). |
| G4 | **Estabilidad visual**: sin seguimiento visual (SLAM), el modelo «flota» con el ruido de los sensores; el GPS produce saltos discretos. | Inherente a la AR por geolocalización web | Mitigación: `smoothingFactor` 0,1 (documentado) y `gpsMinDistance`. Criterio de aceptación en §9.9 (C5). |
| G5 | **Mercator**: 1 unidad = 1 m × sec(lat). En −29,48°, sec = **1,149** (+14,9 %). | ✅ Confirmado (🧪 11,47 por cada 10 m) | La geometría es coherente (cámara y modelo usan la misma proyección); sólo el tamaño aparente cae ~13 %. Mitigación: multiplicar la escala del modelo por 1,149 si hace falta. |
| G6 | **Migración A-Frame 1.2 → 1.6** (three r125 → r164): color/iluminación (aviso de `useLegacyLights`), `Box3` con esqueletos (D15), `embedded` (D16). | ✅ Detectado (🧪) | Ajustes de §9.4. Revisar visualmente el color del modelo en el teléfono. |
| G7 | **Avisos emergentes de AR.js** ante errores GPS transitorios («GPS satellites not available»). | ✅ Visto en emulación | Mala experiencia si el GPS oscila. Evaluar en la PoC; si molesta, gestionar el evento de error en una iteración posterior. |
| G8 | **Imagen de la cámara estirada** con `videoTexture`. | ✅ Documentado por AR.js; 🧪 visto en emulación | Cosmético. Evaluar en el teléfono. |
| G9 | **Firefox Android**: API de orientación incompleta. | Documentado por LocAR | Indicar Chrome (Android) / Safari (iOS). |
| G10 | **Rendimiento**: `aframe-ar.js` completo pesa 1,6 MB (incluye ARToolKit). | Bajo | Aceptable para la PoC. Más adelante, valorar el build `aframe-ar-new-location-only.js` (15 KB), que necesita una protección extra en iOS (accede a `systems.arjs` sin comprobarlo). |

### 9.7 Recomendación técnica
1. **No migrar todavía la aplicación.** Primero, una **PoC aislada** con la opción A (AR.js 3.4.8 oficial + A-Frame 1.6.0). Justificación:
   - Es la única distribución oficial que ofrece hoy geolocalización real para A-Frame.
   - La combinación de versiones es la del propio proyecto AR.js.
   - El experimento en emulación muestra anclaje real y gestos v78 compatibles, con 5 ajustes conocidos (D12–D16).
2. **Mantener v78 intacta** como versión estable durante toda la PoC.
3. Si la PoC falla **sólo por la brújula en iOS**, evaluar el plan B (opción C) para la orientación. Si falla por la precisión del GPS en el lugar, el anclaje web no es viable allí y se mantiene el perímetro (v78).

### 9.8 Prueba de concepto mínima propuesta (⏳ pendiente de autorización, P9)
- **Archivos nuevos**, sin modificar v78:
  - `poc-geo.html`: la escena de §9.5 con un **cubo rojo de depuración** exactamente en la coordenada y Goku sobre el ancla.
  - `poc-geo.js`: copia de `script.js` v78 con los ajustes D12–D15 y el perímetro configurable.
  - `lib/aframe-v1.6.0.min.js`, `lib/aframe-ar-3.4.8.js`, `lib/ar-threex-location-only-3.4.8.js`: copias exactas, SHA-256 en §9.5.
- **Parámetros por URL** para probar en cualquier lugar sin tocar código:
  - `?lat=..&lon=..`: coordenada objetivo (por defecto, la real).
  - `&radio=..`: perímetro (por defecto, sin límite).
  - `&debug=1`: HUD con precisión GPS, rumbo de la brújula, distancia y posición de la cámara.
- **URLs en GitHub Pages** (misma rama, sin reconfigurar):
  - v78: `https://lgqseiscelularlg-source.github.io/Cloude/`
  - PoC: `https://lgqseiscelularlg-source.github.io/Cloude/poc-geo.html`
- **Verificación automática previa:** la misma batería de emulación de §9.3 contra `poc-geo.html` antes de publicar.
- **Protocolo en el teléfono:**
  1. Elegir un punto reconocible: un poste, árbol o esquina, cuya coordenada se toma en Google Maps manteniendo pulsado el punto.
  2. Abrir la PoC con `?lat=&lon=&debug=1` desde **20–40 m** de distancia, a cielo abierto.
  3. Calibrar la brújula (gesto en «8»).
  4. Comprobar los criterios de §9.9 y anotar los resultados en §8.

### 9.9 Criterios de éxito (medibles en el teléfono)

| # | Criterio | Umbral |
|---|---|---|
| C1 | Carga sin errores en Android Chrome (y en iOS Safari si hay un iPhone disponible): cámara visible, permisos concedidos, HUD con datos | Obligatorio |
| C2 | **Dirección**: el cubo o el modelo aparece sobre el punto de referencia | Desvío ≤ ±15° (≈ un tercio del ancho de la pantalla a 30 m) |
| C3 | **Anclaje al caminar**: caminando 10–20 m en perpendicular, el modelo **permanece sobre el punto de referencia** (no acompaña a la cámara) | Sigue sobre el punto, con un desplazamiento ≤ 5 m |
| C4 | **Girar 360° y volver**: el modelo regresa a la misma posición | ≤ ±10° |
| C5 | **Estabilidad en reposo** (30 s quieto): sin saltos fuera de las actualizaciones GPS; temblor tolerable con `smoothingFactor` 0,1 | Valoración del Capitán y Nami |
| C6 | **Gestos** (horizontal, vertical, pinza, límite de ±80°) iguales que en v78 | Obligatorio |
| C7 | Rendimiento fluido y sin sobrecalentamiento en 5 minutos | Obligatorio |
| C8 | **Repetibilidad**: 3 sesiones, idealmente en 2 teléfonos distintos | Al menos 2 de 3 cumplen C2–C4 |

- **Decisión:** si se cumplen C1–C4 y C6–C8 → proponer la migración (§9.5) con nueva autorización. Si no → mantener v78 y registrar la causa medida.

### 9.10 Estrategia de reversión inmediata a la versión 78
- **Durante la PoC no hay nada que revertir:**
  - v78 (`index.html`, `script.js`, `style.css`) no se modifica; la PoC vive en archivos aparte.
  - Si la PoC falla, simplemente no se usa su URL.
  - Para limpiar: `git revert <commit-poc>`, sin reescribir el historial.
- **Punto de reversión explícito:** etiqueta `v78` en el commit `ab62cc7` (P8, requiere autorización porque se publica en GitHub). Con ella se recupera v78 con `git checkout v78 -- index.html script.js style.css` y un commit nuevo.
- **Si en el futuro se migra la app principal:**
  - Se hará en un commit único y aislado.
  - Volver atrás = `git revert` de ese commit (o restaurar desde la etiqueta `v78`) y push. GitHub Pages republica en 1–3 minutos.
  - La etiqueta «Versión 7x» de la pantalla permite confirmar en el teléfono qué versión está activa.
- **Nota:** `main` sigue en la versión 77. v78 sólo existe en la rama `claude/zealous-ramanujan-j9jf59`. Fusionarla a `main` (P6) daría una base estable antes de la PoC, pero requiere autorización expresa.
