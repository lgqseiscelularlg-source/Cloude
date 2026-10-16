# Bitácora técnica – RealityTour RA (repositorio `Cloude`)

> Responsable técnica: **Robin** (IA de ingeniería). Supervisión: **Nami** (IA supervisora). Dirección: **Ale / Capitán**.
> Rama de trabajo: `claude/zealous-ramanujan-j9jf59` (no fusionada a `main`).
> Última actualización: 2026-10-16. Entrada #3: implementación de los gestos. Validada en emulación; **pendiente de validar en smartphone**.

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
| **Posicionamiento 3D por GPS** (`gps-camera` / `gps-entity-place`) | ⚠️ **No existe** en AR.js 1.7.5 (ver D10) | Sin cambios: fuera del alcance autorizado (§7) |
| Rotación horizontal (1 dedo) | Funciona | 🔵 reimplementada (🧪) |
| Rotación vertical (1 dedo) | No funciona | 🔵 implementada (🧪) |
| Zoom con pinza (2 dedos) | Falla (salta a escala máxima) | 🔵 corregido (🧪) |
| El modelo no se desplaza con los gestos | Parcial | 🔵 (🧪) |

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

**D11 – 🟡 HIPÓTESIS: el cálculo de límites del GLB es aproximado.**
El GLB es un *SkinnedMesh* con 1 skin y 15 animaciones (que no se reproducen). En three.js, `Box3.setFromObject` usa la geometría sin aplicar los huesos, así que el tamaño medido (≈ 2 × 6 × 2 cm) no coincide con el renderizado (~5 m de alto a 30 m). Aun así, el centro medido **coincide con la posición del modelo en pantalla**: en las capturas el modelo gira en su sitio. Falta confirmar en el teléfono que gira sobre su centro visual (§6.2, paso 3).

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
| P5 | **Anclaje GPS real del modelo** (D10): AR.js 1.7.5 no lo soporta. Opciones: (a) migrar a AR.js 3.x location-based (`AR-js-org`), (b) calcular la posición del ancla en `script.js` a partir de `watchPosition` y la brújula, (c) mantener el comportamiento actual. | ⏳ Pendiente del Capitán (requiere justificar el cambio de versión) |
| P6 | Fusionar la rama a `main` | ⏳ Pendiente; sólo tras la validación en smartphone y con autorización expresa |
| P7 | Sentido de la inclinación (R4) y sensibilidad | ⏳ Según el resultado de la prueba en el teléfono |

---

## 8. Historial cronológico de intervenciones

| # | Fecha | Autor | Tipo | Descripción | Archivos | Verificación |
|---|---|---|---|---|---|---|
| 1 | 2026-10-15 | Robin | Análisis | Auditoría de la interacción táctil (Fase 1) y propuesta de solución (Fase 2). Sin cambios funcionales. | — | N/A |
| 2 | 2026-10-16 | Robin | Documentación | Creación de `BITACORA_RA.md`. Autorizado por el Capitán. Commit `fc65971`. | `BITACORA_RA.md` | N/A |
| 3 | 2026-10-16 | Robin | Implementación | Autorizada por el Capitán y Nami, con precauciones de espacios de coordenadas y límite de ±80°. Pivote hijo del ancla con centrado del GLB; rotación horizontal y vertical con cuaterniones y límite de ±80°; pinza protegida; `touchend`/`touchcancel`; log y etiquetas sin captura de toques; GLB extraído sin modificar; `.nojekyll`; versión 78. Hallazgos nuevos: D10 (AR.js 1.7.5 sin GPS 3D) y D11. D3 pasa de hipótesis a confirmado. | `script.js`, `index.html`, `style.css`, `models/goku.glb`, `.nojekyll`, `BITACORA_RA.md` | 🧪 30/31 en emulación (la única falla es del entorno). 🔵 **Pendiente en smartphone.** |

<!-- Nuevas entradas: añadir filas al final; no borrar historial. -->
