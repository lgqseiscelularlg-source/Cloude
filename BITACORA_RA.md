# Bitácora técnica – RealityTour RA (repositorio `Cloude`)

> Responsable técnica: **Robin** (IA de ingeniería). Supervisión: **Nami** (IA supervisora). Dirección: **Ale / Capitán**.
> Rama de trabajo: `claude/zealous-ramanujan-j9jf59` (no fusionada a `main`).
> Última actualización: 2026-10-16. Entrada #9: **prueba real #2 (PoC geo 2, Chrome iOS)**: cubo y Goku visibles, norte corregido y gestos OK. Persisten desplazamientos al caminar y movimientos espontáneos estando detenido. Análisis: saltos GPS discretos por `gpsMinDistance=5` (D20) y error de norte proporcional a la inclinación lateral (**D19, error de implementación de D18**). Propuesta de PoC geo 3 y prueba diagnóstica #3 **pendientes de autorización**. Ver **§10.11**.
> *Corrección de registro:* la prueba real #1 (entrada #7) se hizo con **Google Chrome para iOS**, no con Safari.
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
| P8 | Crear la etiqueta `v78` en el commit `ab62cc7` como punto de reversión | ⚠️ Autorizada. Creada **localmente**, pero el entorno de Robin rechaza publicar etiquetas (HTTP 403 del proxy de git; sólo admite la rama de trabajo). **Crearla desde GitHub** (pasos en §10.8) |
| P9 | Implementar la prueba de concepto de §9.8 (archivos nuevos, sin tocar v78) | ✅ Autorizada e implementada (entrada #6). Pendiente de validar en smartphone |
| P10 | Coordenada de prueba para la PoC | ✅ Resuelto: configurable por URL (`?lat=&lon=`); por defecto, el objetivo real |
| P11 | Migrar la aplicación principal | ⏳ **No autorizada**. Sólo tras la validación real de la PoC (§9.9) |
| P12 | Aplicar en `poc-geo.js` la corrección de orientación iOS (D17 + D18, §10.9) | ✅ Autorizada e implementada como **PoC geo 2** (entrada #8). ⏳ Revisión de Nami y prueba en el iPhone |
| P13 | Orden de prueba en el iPhone | ✅ Primero **Chrome iOS**; comparar con Safari si hace falta |
| P14 | PoC geo 3: corrección de D19, filtro de norte lento, registro diagnóstico y filtro GPS opcional (§10.11) | ⏳ Pendiente de autorización |

---

## 8. Historial cronológico de intervenciones

| # | Fecha | Autor | Tipo | Descripción | Archivos | Verificación |
|---|---|---|---|---|---|---|
| 1 | 2026-10-15 | Robin | Análisis | Auditoría de la interacción táctil (Fase 1) y propuesta de solución (Fase 2). Sin cambios funcionales. | — | N/A |
| 2 | 2026-10-16 | Robin | Documentación | Creación de `BITACORA_RA.md`. Autorizado por el Capitán. Commit `fc65971`. | `BITACORA_RA.md` | N/A |
| 3 | 2026-10-16 | Robin | Implementación | Autorizada por el Capitán y Nami, con precauciones de espacios de coordenadas y límite de ±80°. Pivote hijo del ancla con centrado del GLB; rotación horizontal y vertical con cuaterniones y límite de ±80°; pinza protegida; `touchend`/`touchcancel`; log y etiquetas sin captura de toques; GLB extraído sin modificar; `.nojekyll`; versión 78. Hallazgos nuevos: D10 (AR.js 1.7.5 sin GPS 3D) y D11. D3 pasa de hipótesis a confirmado. Commit `ab62cc7`. | `script.js`, `index.html`, `style.css`, `models/goku.glb`, `.nojekyll`, `BITACORA_RA.md` | 🧪 30/31 en emulación (la única falla es del entorno). Ver #4 |
| 4 | 2026-10-16 | Capitán / Nami | Prueba en dispositivo | v78 en smartphone real: rotación horizontal, vertical, zoom y rotación sin quedar boca abajo **confirmados**. Observaciones O1 (desaparece al girar) y O2 (acompaña al caminar). Contexto: el perímetro de 15 m fue una decisión deliberada. | — | 🟢 Gestos v78 verificados en dispositivo. Pasos 7, 9 y 10 de §6.2 sin reportar |
| 5 | 2026-10-16 | Robin | Análisis + experimento aislado | Evaluación de la geolocalización real (§9): fuentes oficiales de AR.js (npm `@ar-js-org/ar.js` 3.4.8, documentación y ejemplos oficiales) y LocAR.js. Experimento en el scratchpad (**fuera del repo**) con A-Frame 1.6.0 + AR.js 3.4.8 + `script.js` v78: 16/16 en emulación tras 5 ajustes necesarios (D12–D16). Recomendación: PoC aislada. Sin cambios funcionales en el repo. | `BITACORA_RA.md` | 🧪 Emulación. 🔵 **Nada verificado en dispositivo** |
| 6 | 2026-10-16 | Robin | Implementación PoC | Autorizada por el Capitán y Nami. `poc-geo.html` + `poc-geo.js` + `lib/` (A-Frame 1.6.0, AR.js 3.4.8). Ajustes D12–D16. Proyección local en metros. Parámetros URL. Cubo de referencia. HUD con autodiagnóstico de coherencia. Gestos v78 copiados textualmente. Corregido durante las pruebas: con `lat`/`lon` inválidas el ancla recibía NaN. Etiqueta `v78` creada localmente; su publicación fue rechazada por el entorno (403). | `poc-geo.html`, `poc-geo.js`, `lib/*`, `BITACORA_RA.md` | 🧪 PoC 30/30; regresión v78 30/31 (la única falla es del entorno); v78 sin cambios respecto de `ab62cc7`. 🔵 **Pendiente en smartphone** |
| 7 | 2026-10-16 | Capitán / Robin | Prueba real + diagnóstico | iPhone con **Chrome iOS** (corregido en la entrada #8; se había anotado Safari) en el árbol (−29.477168, −66.889542) a 17,8 m, en retrato vertical. GPS ±5–9 m, ancla y modelo OK, coherencia OK, permiso concedido, pero `Cámara apunta a —°` y ni el cubo ni Goku visibles. Diagnóstico: D17 (AR.js pide el permiso sin gesto y nunca conecta; la cámara queda mirando al suelo) y D18 (iOS: `alpha` relativo; `gps-new-camera` ignora `webkitCompassHeading`). Escala de Goku descartada. Corrección propuesta (+41 líneas en `poc-geo.js`) probada en una copia aislada. | `BITACORA_RA.md` (sin cambios funcionales) | 🟢 GPS/anclaje en iPhone. 🔴 Orientación en iOS. 🧪 Corrección: iOS 8/8, Android 30/30. ⏳ Pendiente de autorización (P12) |
| 8 | 2026-10-16 | Robin | Implementación PoC geo 2 | Autorizada por el Capitán y Nami. D17: reintento de `connect()` cuando llegan datos del sensor, más un respaldo que entrega el evento al control de AR.js si sigue sin recibirlo. D18: `alphaOffset` desde `webkitCompassHeading` con el teléfono en vertical; `norte=0` lo desactiva. HUD: líneas «Control AR.js» y «Norte iOS». Etiqueta «PoC geo 2». Corregido el registro de la prueba #1 (**Chrome iOS**, no Safari). Comprobado que el regex de AR.js para Safari no reconoce Chrome iOS. | `poc-geo.js`, `poc-geo.html`, `BITACORA_RA.md` | 🧪 iOS emulado (Safari + Chrome iOS, 5 escenarios) 30/30. Android 30/30. v78 30/31 (la única falla es del entorno). v78, gestos, GPS y `lib/` sin cambios. 🔵 **Pendiente: revisión de Nami y prueba en el iPhone** |
| 9 | 2026-10-16 | Capitán / Nami / Robin | Prueba real #2 + análisis | Chrome iOS: control AR.js con datos, norte corregido, rumbo numérico, **cubo y Goku visibles**, gestos OK, coherencia OK, GPS ±3–5 m, distancias 11,6 y 22,1 m, saltos aceptados de 5,2 a 10,7 m. Desplazamientos al caminar, movimientos espontáneos también **estando detenido**, Goku sobre un auto, entra y sale del encuadre. Análisis: D19 (error de implementación: norte ignora γ; 🧪 error = γ), D20 (saltos GPS de ≥ 5 m), D21 (filtro de norte casi sin suavizado), D22 (encuadre de 42° y retardo de suavizado). Propuestas M1–M6. Sin cambios de código. | `BITACORA_RA.md` | 🟢 D17 y D18 resueltos en el dispositivo (visibilidad y norte). 🔴 Estabilidad. ⏳ P14 |

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

---

## 10. PoC geolocalizada (entrada #6) — 🔵 implementada, 🧪 verificada en emulación, **pendiente de validar en smartphone**

### 10.1 Archivos (todos nuevos; la v78 no se tocó)

| Archivo | Contenido |
|---|---|
| `poc-geo.html` | Escena de la PoC con los ajustes D13 y D16; HUD; log en pantalla con captura de errores JS (`❌ ERROR JS`); reutiliza `style.css` (sólo lectura) |
| `poc-geo.js` | Lógica geolocalizada con los ajustes D12, D14 y D15, más los parámetros URL, el HUD y el **bloque de gestos copiado textualmente de `script.js` v78** (verificado con `diff`: idéntico) |
| `lib/aframe-v1.6.0.min.js` | A-Frame 1.6.0 (SHA-256 `197b3200…ac17fc`) |
| `lib/aframe-ar-3.4.8.js` | AR.js 3.4.8, build A-Frame (SHA-256 `aec697f1…f917d`) |
| `lib/ar-threex-location-only-3.4.8.js` | AR.js 3.4.8, `THREEx` de geolocalización (SHA-256 `bb44e11b…9204`) |

- `git diff ab62cc7 -- index.html script.js style.css models/goku.glb .nojekyll` → **vacío**: la v78 está intacta.
- La PoC no carga nada de CDNs externas: todo se sirve desde el repo.

### 10.2 Cómo funciona
- **Escena:** sin `embedded` (D16). `<a-camera>` **antes** que el ancla (D13), con:
  - `gps-new-camera="gpsMinDistance: 5; positionMinAccuracy: 30; initialPositionAsOrigin: true"`
  - `arjs-device-orientation-controls="smoothingFactor: 0.1"`
- **Proyección local en metros** (novedad respecto de §9):
  - Se reemplaza la Spherical Mercator de AR.js por una equirectangular local centrada en el objetivo, mediante la API documentada `threeLoc.setProjection()`.
  - Así **1 unidad = 1 m real**: se elimina el +15 % de la Mercator (G5).
  - Error de la aproximación: < 0,1 m a 1 km.
  - Para comparar con la de AR.js: `&proj=mercator`.
- **Ancla (D14):** recibe `gps-new-entity-place` con la coordenada objetivo en el **primer fix aceptado**, cuando ya existe el origen del mundo.
- **Modelo (D12, D15):**
  - Se crea sólo con la escena cargada y el ancla ya geolocalizada.
  - Su centro visual, estimado con los huesos, queda **sobre la coordenada**, a `h` metros del suelo (por defecto 3 m: Goku mide ≈ 4,8 m, así que queda de pie sobre el cubo).
  - `frustumCulled = false` en las mallas con esqueleto: su esfera envolvente en three r164 es errónea.
- **Cubo de referencia:** rojo, de 1 m, apoyado en el suelo **exactamente** en la coordenada. Es el testigo físico del anclaje, independiente del GLB.
- **Perímetro:** se conserva como parámetro. `radio=0` (por defecto) = sin límite; `radio=15` = como en v78.
- **Gestos:** idénticos a v78. Actúan sólo sobre el pivote; el ancla nunca se rota, escala ni mueve.

### 10.3 Parámetros URL

| Parámetro | Por defecto | Uso |
|---|---|---|
| `lat`, `lon` | −29.477051, −66.889616 (objetivo real) | Coordenada donde se ancla el cubo y el modelo. Admite punto o coma decimal |
| `radio` | `0` (sin perímetro) | Metros. Si es > 0, el cubo y el modelo sólo se muestran dentro del radio |
| `h` | `3` | Altura en metros del centro del modelo sobre el suelo |
| `acc` | `30` | Precisión mínima en metros que acepta AR.js. Si el HUD muestra muchos «descartados», probar `50` |
| `proj` | (local en metros) | `mercator` = proyección original de AR.js, sólo para comparar |

- Si un parámetro es inválido, el HUD muestra `❌ URL: …` y no se ancla nada.

### 10.4 HUD de diagnóstico (franja superior)
- **Proyección** activa y **objetivo** (indica si viene de la URL o por defecto).
- **GPS:**
  - Precisión: verde ≤ 10 m, amarillo ≤ `acc`, rojo si es peor.
  - Edad del último fix.
  - Fixes recibidos, aceptados y descartados por precisión.
- **Distancia real** (Haversine), **rumbo geodésico** al objetivo y **último salto GPS** aceptado.
- **Orientación:**
  - Evento del sensor (`deviceorientationabsolute` = absoluta / `deviceorientation` = relativa).
  - Ángulos α β γ y, en iPhone, la brújula iOS.
- **Rumbo de la cámara** en la escena, rumbo al cubo y **guía**: «gira X° a la derecha/izquierda» o «✅ el cubo está al frente».
- **Coherencia interna:** compara la geometría de la escena (vector ancla − cámara) con la que predice el GPS, calculada **de forma independiente** con Haversine y rumbo geodésico.
  - **OK** si Δdist < 0,5 m (o 0,5 %) y Δrumbo < 2°.
  - **ERROR DE IMPLEMENTACIÓN** en caso contrario.
- **Log inferior:**
  - `📍 Fix aceptado #n · salto X m · cámara x,z`
  - `📌 Ancla geolocalizada`
  - `⚠️ GPS: precisión ±X m > acc` (fix descartado)
  - `⚠️ GPS error`
  - `❌ ERROR JS` (error de implementación)

### 10.5 Cómo distinguir errores del GPS, de la brújula y de implementación

| Lo que se observa en el teléfono | Coherencia interna | Clasificación |
|---|---|---|
| `❌ ERROR JS` en el log, o el HUD congelado | — | **Implementación** |
| Coherencia **ERROR** | ERROR | **Implementación**: la escena no refleja lo que dice el GPS |
| El cubo «acompaña» al caminar mientras llegan `📍 Fix aceptado` con saltos | OK | No debería ocurrir con coherencia OK; si ocurre, **implementación** |
| El cubo «acompaña» al caminar y **no** llegan fixes aceptados (sólo «descartados» o nada) | OK | **GPS**: precisión peor que `acc` o movimiento menor de 5 m. Probar `acc=50` o esperar mejor señal |
| El cubo salta de golpe justo cuando aparece `📍 Fix aceptado · salto X m` estando quieto | OK | **GPS** (ruido de posición). Normal hasta ≈ la precisión mostrada |
| El cubo queda desplazado del punto real en una magnitud parecida a la precisión GPS, y la distancia del HUD no coincide con la real | OK | **GPS** |
| El cubo queda desplazado lateralmente por un ángulo casi constante, que cambia tras calibrar (gesto en «8») o cerca de metal o autos | OK | **Brújula** (sensor) |
| El HUD dice «Orientación: (relativa)» o «sin datos» | — | **Sensor o permiso** (navegador o iOS). Pulsar «Activar brújula» en iPhone |
| «Cámara apunta a X°» difiere más de 15° de la app de brújula del teléfono apuntando igual | OK | **Brújula**: sensor o su lectura por AR.js. Anotar la diferencia y el modelo de teléfono |

- **Regla práctica:** con coherencia **OK** y sin `❌`, el código coloca el cubo exactamente donde dicen el GPS y la brújula. Cualquier desvío físico restante es error de esos sensores.

### 10.6 Pruebas automáticas (🧪 emulación; **no** sustituyen la prueba en el teléfono)
- **Entorno:** Chromium headless + Playwright 1.56.1, toques CDP, GPS simulado con precisión configurable y orientación simulada (`deviceorientationabsolute`).
- **Servidor:** se sirven **los archivos reales del repo**, sin sustituciones.
- **Resultado: 30/30 PASS.**

| Grupo | Comprobaciones | Resultado |
|---|---|---|
| A. Arranque (usuario 20 m al sur) | Ancla tras el primer fix. Modelo centrado. Proyección en metros. **Ancla a 20,000 m al norte** (en metros reales). Coherencia OK (Δ 0,00 m / 0,0°). Pivote = ancla + 3 m. Centro de huesos = pivote (< 5 cm). Mirando al norte, cubo y modelo centrados. Guía «al frente» | ✅ 9/9 |
| **B. Anclaje al caminar** | Recorrido de 5 tramos: 15 m E → 10 m N → 30 m O → rodear al norte del objetivo → volver. En cada tramo, mirando según el rumbo GPS: deriva del ancla **0 m**, error de la cámara frente al GPS ≤ **0,0001 m**, cubo **centrado en pantalla** (NDC x ≤ 0,0001) y coherencia OK | ✅ 6/6 |
| C. Errores de GPS | Fix con ±60 m descartado, sin salto y visible en el HUD. Movimiento de 3 m (< 5 m) ignorado | ✅ 3/3 |
| D. Gestos v78 | Horizontal; vertical ≤ 80°; combinado ≤ 80°; pinza con el 2.º dedo sobre el log (300 → 450); soltar un dedo sin salto; el ancla y el pivote no se mueven; sin errores de implementación | ✅ 7/7 |
| E. Parámetros URL | `radio=5`: oculto a 20 m y visible a 3 m. `lat`/`lon` de otra ciudad: ancla a 30,0 m al oeste. `lat=abc`: error en el HUD y sin anclaje. `proj=mercator`: 22,999 m = 20 × sec(lat), con coherencia OK | ✅ 5/5 |

- **Regresión v78** (`gestures.test.js` sobre `index.html`): 30/31, idéntico a la entrada #3. La única «falla» son mensajes del entorno de prueba: 404 de favicon, sin acceso a `camera_para.dat`, y el aviso del GPS simulado.
- **Errores corregidos durante las pruebas:**
  1. Con `lat`/`lon` inválidas, el evento de AR.js anclaba igualmente con NaN. Ahora se bloquea.
  2. En el test (no en el código): la orientación suavizada (`smoothingFactor` 0,1) necesita ≈ 2 s para converger tras un giro brusco simulado.
- **Límites de la emulación:** GPS y brújula perfectos (sin ruido). La prueba demuestra que **la implementación** ancla correctamente, **no** que los sensores del teléfono sean suficientemente precisos. Eso sólo lo mide la prueba real (§9.9).

### 10.7 Procedimiento en el smartphone
- **URL base:** `https://lgqseiscelularlg-source.github.io/Cloude/poc-geo.html` (GitHub Pages ya sirve esta rama).
- **Preparación:**
  1. Elegir un punto físico reconocible a cielo abierto: poste, árbol, esquina o banco.
  2. En Google Maps, mantener pulsado exactamente ese punto y copiar las coordenadas (6 decimales).
  3. Armar la URL: `…/poc-geo.html?lat=<LAT>&lon=<LON>`. Ejemplo con el objetivo real: `…/poc-geo.html?lat=-29.477051&lon=-66.889616`.
  4. Ubicarse a **20–40 m** del punto. Usar Chrome en Android o Safari en iPhone (no Firefox).
- **Prueba:**
  1. Abrir la URL. Comprobar «**PoC geo 1 (base v78)**» abajo a la izquierda y «proyección: local en metros» en el HUD. Si no aparece, recargar sin caché.
  2. Aceptar cámara y ubicación. En iPhone, pulsar «**Activar brújula**».
  3. **Calibrar la brújula:** mover el teléfono en forma de «8» unos segundos.
  4. Esperar a que el GPS marque **±10–15 m o mejor** y que el log muestre «📌 Ancla geolocalizada». Comprobar «Coherencia interna: **OK**».
  5. Seguir la guía «gira X°…» hasta «✅ el cubo está al frente».
     - **C2:** ¿el cubo rojo y Goku están sobre el punto elegido? Estimar el desvío en grados o metros.
  6. **C3 (prioridad):** caminar **10–20 m en perpendicular** a la línea hacia el punto, sin dejar de apuntarle.
     - El cubo debe **quedarse sobre el punto**, no acompañar.
     - Observar en el log los `📍 Fix aceptado · salto X m`.
     - Repetir acercándose y alejándose.
  7. **C4:** girar 360° y volver a apuntar: el cubo debe volver al mismo lugar (±10°).
  8. **C5:** quedarse quieto 30 s. Anotar los saltos y la precisión mostrada.
  9. **C6:** probar los gestos (horizontal, vertical, pinza) sobre Goku.
  10. **C7 y C8:** 5 minutos de uso. Repetir en 3 sesiones e, idealmente, en 2 teléfonos.
- **Registrar para Nami** en §8 y §10.9:
  - Teléfono y navegador.
  - Coordenada usada y distancia inicial.
  - Precisión GPS típica.
  - Resultado de C1–C8.
  - Clasificación de cada desvío según §10.5.
  - Capturas con el HUD visible.

### 10.8 Reversión y respaldo
- La v78 sigue intacta en `https://lgqseiscelularlg-source.github.io/Cloude/` y no se modificó.
- Para retirar la PoC: dejar de usar su URL, o `git revert` de su commit (sin reescribir el historial).
- **Etiqueta `v78`:** creada localmente sobre `ab62cc7`, pero **no publicada** (el entorno de Robin sólo puede publicar en la rama de trabajo; HTTP 403). Para crearla en GitHub, cualquiera de estas opciones:
  - **Web:** repositorio → *Releases* → *Draft a new release* → *Choose a tag*: escribir `v78` → *Create new tag* → *Target*: elegir la rama `claude/zealous-ramanujan-j9jf59` o el commit `ab62cc7` → *Publish*. *Ojo: comprobar en «Target» que es el commit `ab62cc7`, no el último de la rama.*
  - **Terminal:** `git fetch origin && git tag v78 ab62cc7 && git push origin v78`

### 10.9 Resultados en smartphone

#### Prueba real #1 — iPhone, **Google Chrome para iOS** (entrada #7)

> **Corrección de registro (entrada #8):** el navegador fue **Chrome para iOS**, no Safari como se anotó al principio. Chrome iOS usa el motor WebKit de Apple (WKWebView), con la misma API de orientación y el mismo `requestPermission`. Por eso D17 aplica igual; ver la verificación específica más abajo.
- **Coordenada (árbol):** `lat=-29.477168`, `lon=-66.889542`. El usuario abrió la PoC junto al árbol, se alejó ≈ 17,8 m según el HUD y apuntó hacia él **sosteniendo el iPhone en vertical (retrato), como para una foto normal**.

| Observación | Resultado | Lectura |
|---|---|---|
| GPS | ±5 a ±9 m | 🟢 Bueno: dentro de `acc` = 30 |
| `📌 Ancla geolocalizada` en el log | Sí | 🟢 |
| Modelo creado y centrado (log) | Sí | 🟢 |
| Coherencia interna | **OK** | 🟢 La escena coincide con el GPS: el GPS y la geometría funcionan |
| Permiso de orientación | `granted` | 🟢 Concedido (botón «Activar brújula») |
| HUD «Orientación» | `deviceorientation (relativa)` | Esperado en iOS: WebKit (Safari y Chrome iOS) no tiene `deviceorientationabsolute` |
| HUD «Cámara apunta a» | **`—°` en todas las capturas** | 🔴 La cámara 3D no está orientada en horizontal |
| Cubo rojo y Goku | **Nunca aparecieron** | 🔴 |

#### Diagnóstico (entrada #7) — ✅ CONFIRMADO en el código y 🧪 reproducido en emulación de iOS
- **D17 – Causa raíz: AR.js 3.4.8 nunca conecta sus listeners de orientación en iOS.**
  - `arjs-device-orientation-controls` (lo añade `gps-new-camera` en móviles) crea `THREEx.DeviceOrientationControls`, cuyo `connect()` se ejecuta **al cargar la página**.
  - En iOS, `connect()` llama a `DeviceOrientationEvent.requestPermission()` **sin gesto del usuario**, e iOS lo rechaza (`NotAllowedError`).
  - Código de `lib/ar-threex-location-only-3.4.8.js`: `requestPermission().then(t => { "granted"===t && addEventListener(...) }).catch(console.error)`. Los listeners **sólo** se registran si el permiso se concede en ese instante.
  - Después, el permiso sí se concede, pero ninguno de los tres pedidos con gesto reconecta los controles de AR.js:
    - el diálogo propio de A-Frame 1.6, `device-orientation-permission-ui`;
    - el `touchend` de `_setupSafariOrientationPermissions` de AR.js;
    - nuestro botón «Activar brújula».
  - **Nuestro HUD sí recibe los eventos** (por eso muestra `deviceorientation`), pero **la cámara 3D no**.
- **Por qué la cámara mira al suelo aunque el teléfono esté en retrato:**
  - Sin eventos, el objeto `deviceOrientation` del control queda en `{}`, y `update()` usa α=β=γ=0. Eso equivale a un teléfono **acostado boca arriba**.
  - Con la corrección de pantalla (−90° en X), la cámara apunta a **(0, −1, 0), directo al suelo**, sea cual sea la postura real del teléfono.
  - El vector horizontal de la cámara mide 0 < 0,2, así que `rumboCamara()` devuelve `null` → `—°`. *(La observación de Nami es correcta: el `null` es un síntoma, no la causa.)*
  - El cubo y Goku están a 17,8 m en horizontal: fuera de un encuadre que mira al suelo.
- **Reproducción 🧪:** emulación de Safari iOS con `requestPermission` que rechaza sin gesto, pulsando el diálogo de A-Frame y «Activar brújula» y simulando retrato vertical (β=90°). Con la PoC actual sale lo mismo que en el iPhone:
  - Error `THREE.DeviceOrientationControls: Unable to use DeviceOrientation API: NotAllowedError`.
  - Control de AR.js sin datos; cámara `forward = (0, −1, 0)`; HUD `--°`; cubo fuera de pantalla (NDC y = 19).
  - Coherencia interna OK.
- **Por qué no lo detectaron las pruebas anteriores:** Chromium/Android no tiene `requestPermission`, así que AR.js conecta los listeners directamente. El fallo es **exclusivo de iOS**.
- **D18 – Problema secundario en iOS (afecta a la dirección, no a la visibilidad):**
  - El control de `gps-new-camera` usa **sólo `alpha`**. En Safari, `alpha` de `deviceorientation` es **relativo** (referencia arbitraria).
  - En `lib/aframe-ar-3.4.8.js`, `webkitCompassHeading` sólo lo usa el componente **clásico** `gps-camera`, no el de `gps-new-camera`.
  - Corregido sólo D17, en iPhone el cubo se vería pero **en una dirección arbitraria** (norte incorrecto). Es el riesgo G3 de §9.6, ahora confirmado en el código.
- **Hipótesis descartadas:**
  - **Escala de Goku (300):** mide ≈ 4,8 m. A 17,8 m ocupa ≈ 15° de los 80° de campo vertical, perfectamente visible. Además, el **cubo de 1 m tampoco se ve**: no es un problema de escala.
  - **GPS o anclaje:** coherencia OK y precisión de ±5–9 m.
  - **Renderizado:** el mismo render funciona en emulación en cuanto la cámara se orienta.
  - **Visibilidad o perímetro:** `radio=0` por defecto; el log confirma la creación del modelo.

#### Corrección mínima propuesta — ⏳ pendiente de autorización (sólo `poc-geo.js`, +41 líneas)
1. **Reconectar la orientación de AR.js tras el permiso (D17).**
   - Cuando nuestro listener recibe el primer evento de orientación con datos, señal de que el permiso ya está concedido por cualquier vía, se llama una vez a `controles.connect()`.
   - Ahora `requestPermission()` resuelve `granted` y AR.js registra sus listeners. `addEventListener` ignora duplicados, así que es idempotente en Android.
   - Se ignoran los eventos vacíos (α=β=γ=null).
2. **Norte correcto en iOS con `webkitCompassHeading` (D18).**
   - Con el teléfono en vertical (β entre 60° y 120°) y `webkitCompassAccuracy` < 50, se fija `controles.alphaOffset` para que el rumbo de la cámara coincida con la brújula: `offset = −brújula − alpha`, filtrado con una media circular (factor 0,2) para que no tiemble.
   - No afecta a Android, donde ese dato no existe.
   - `?norte=0` lo desactiva, como diagnóstico.
3. **HUD.**
   - Nueva línea «Control AR.js: **recibe datos** / **SIN DATOS (cámara sin orientar)**» y la corrección de norte aplicada en grados.
   - Log: `🧭 Orientación de AR.js reconectada tras el permiso`.
4. **Etiqueta:** «PoC geo 2» para distinguir la versión en el teléfono.
- Sin cambios en la v78, los gestos, el GPS, el anclaje ni las librerías (no se modifica AR.js: la corrección se hace desde fuera).

#### Verificación de la corrección (🧪, en una copia aislada fuera del repo)

| Prueba | PoC actual | Con la corrección |
|---|---|---|
| Emulación iOS: control de AR.js recibe datos | ❌ | ✅ |
| Emulación iOS: cámara en horizontal con retrato vertical | ❌ (0, −1, 0) | ✅ (0, 0, −1) |
| Emulación iOS: HUD con rumbo numérico | ❌ `--°` | ✅ `0°` |
| Emulación iOS: cubo centrado al apuntar al norte real (alpha relativo desfasado 40°, brújula iOS 0°) | ❌ fuera de pantalla | ✅ NDC (0, −0,07) |
| Batería completa Android de la PoC (§10.6) | 30/30 | **30/30** (sin regresión) |

- **Límite:** la emulación no reproduce el comportamiento exacto de `webkitCompassHeading` con el teléfono en vertical ni el ruido del magnetómetro.
- 🟡 **Hipótesis pendiente:** que con el iPhone vertical iOS reporte el rumbo hacia donde apunta la cámara trasera. Se verifica con la prueba diagnóstica de abajo.

#### Prueba diagnóstica propuesta en el iPhone (tras autorizar la corrección)
1. Abrir `…/poc-geo.html?lat=-29.477168&lon=-66.889542` y comprobar la etiqueta «**PoC geo 2**». Conceder permisos y pulsar «Allow» o «Activar brújula».
2. **Comprobación de D17:**
   - El HUD debe decir «Control AR.js: **recibe datos**» (verde).
   - El log debe mostrar `🧭 Orientación de AR.js reconectada…`.
   - «Cámara apunta a» debe mostrar **un número**, no `—°`.
   - Si sigue «SIN DATOS» → la corrección no funcionó (implementación).
3. **Comprobación de D18:**
   - Abrir la app **Brújula** del iPhone y anotar el rumbo apuntando a un objeto lejano.
   - Volver a la PoC y apuntar al mismo objeto. «Cámara apunta a» debe coincidir con la app Brújula en **±15°**.
   - Si difiere en un ángulo constante → anotarlo: es el sesgo de `webkitCompassHeading` en vertical o la declinación magnética.
4. **Visibilidad:** seguir la guía «gira X°» hasta «✅ el cubo está al frente». El cubo rojo y Goku deben verse.
5. **Anclaje:** ¿están sobre el árbol? Caminar 10 m en perpendicular: deben quedarse sobre el árbol (C3).
6. **Comparación opcional:** repetir con `&norte=0`. El cubo debería aparecer desviado un ángulo arbitrario, lo que confirma la necesidad de D18.
7. Anotar las capturas con el HUD completo en esta sección.


### 10.10 PoC geo 2 — corrección de orientación iOS (entrada #8) · 🔵 pendiente de revisión de Nami y de prueba en el iPhone

#### Chrome iOS frente a Safari iOS (verificado en el código)

| Aspecto | Safari iOS | Chrome iOS (prueba #1) | Efecto en la PoC |
|---|---|---|---|
| Motor | WebKit | WebKit (WKWebView; Apple obliga a usarlo en iOS) | Misma API de orientación |
| `DeviceOrientationEvent.requestPermission` | Sí | Sí (la prueba #1 obtuvo `granted`) | D17 aplica a ambos |
| `deviceorientationabsolute` | No | No | AR.js escucha `deviceorientation` (relativo) en ambos |
| Detección «Safari» de AR.js (`/Version\/[\d.]+.*Safari/`) | Coincide | **No coincide** (el UA lleva `CriOS/…` y no `Version/…`) | En Chrome iOS, AR.js **ni siquiera** instala su pedido de permiso en `touchend` ni su aviso. El permiso sólo llega por el diálogo de A-Frame o por «Activar brújula» |
| `webkitCompassHeading` | Sí (documentado) | 🟡 Esperable al ser WebKit; **no confirmado** en el dispositivo | Si falta, el HUD dice «brújula iOS no disponible» y el norte queda sin corregir |

- **Conclusión:** D17 depende sólo de que exista `requestPermission`, no del navegador, así que la corrección es la misma para ambos. Además, **no usa el UA**: se activa cuando llegan los datos del sensor.

#### Qué se implementó (sólo `poc-geo.js` y la etiqueta en `poc-geo.html`)
- **D17 – Orientación de AR.js:**
  1. Al llegar el **primer evento con datos** (prueba de que el permiso ya está concedido, por cualquier vía), se llama una vez a `connect()` del control de AR.js. Ahora `requestPermission()` resuelve `granted` y AR.js registra sus listeners.
  2. **Respaldo para WebKit:** si tras terminar el despacho de un evento el control de AR.js no lo recibió, se le entrega el **mismo** evento. Sólo cuando coincide con el tipo que espera, así que en Android nunca actúa. Cubre el peor caso, un WKWebView que siga rechazando `connect()`.
  3. Se ignoran los eventos vacíos (α=β=γ=null).
- **D18 – Norte en iOS:**
  - Con el teléfono en vertical (β entre 60° y 120°) y `webkitCompassAccuracy` entre 0 y 50, se fija `alphaOffset = −brújula − alpha`, filtrado con una media circular de factor 0,2.
  - `?norte=0` lo desactiva, para diagnóstico.
  - En Android no actúa: no existe `webkitCompassHeading`.
- **HUD:**
  - «**Control AR.js:** recibe datos / SIN DATOS (cámara sin orientar)», con «· vía respaldo» si el respaldo actuó en el último segundo y medio.
  - «**Norte iOS:** corregido · corrección X° · precisión brújula Y°», o el motivo si no se corrige: `brújula iOS no disponible`, `desactivada (norte=0)`, `precisión insuficiente: calibrar con un «8»`, `esperando teléfono en vertical`.
  - Log: `🧭 Orientación de AR.js reconectada tras el permiso`.
- **Etiqueta:** «PoC geo 2 (base v78)».
- **Sin cambios:** v78 (`git diff ab62cc7` vacío), bloque de gestos (`diff` idéntico), GPS y anclaje, `lib/` (AR.js no se modifica).

#### Pruebas automáticas (🧪)

| Batería | Resultado |
|---|---|
| **iOS emulado: Safari y Chrome iOS × 5 escenarios** (`requestPermission` que rechaza sin gesto; «Allow» de A-Frame + «Activar brújula»; iPhone en retrato β=90°; alpha relativo desfasado 40°; brújula 0°) | ✅ **30/30** |
| · Normal: control con datos por su **propio** listener (sin respaldo), cámara horizontal (0, 0, −1), rumbo numérico, norte corregido (−40°), **cubo centrado** al apuntar al norte real, coherencia OK, log de reconexión, sin errores | ✅ ambos navegadores |
| · Rechazo persistente de `connect()` (peor caso WKWebView): el respaldo entrega los datos, cámara horizontal y cubo centrado | ✅ ambos |
| · Sin `webkitCompassHeading`: cámara horizontal, HUD «no disponible», cubo desviado 40° (esperado) | ✅ ambos |
| · `norte=0`: corrección desactivada y visible en el HUD | ✅ ambos |
| · Brújula sin calibrar (precisión −1): el HUD pide calibrar y no aplica la corrección | ✅ ambos |
| Android: batería completa de la PoC (§10.6) | ✅ **30/30**, sin regresión |
| v78: `gestures.test.js` | 30/31, igual que antes (la única falla son mensajes del entorno) |

- **Límites de la emulación:**
  - No reproduce el `webkitCompassHeading` real con el teléfono en vertical, el ruido del magnetómetro ni la declinación magnética.
  - En Chromium hubo que enviar los eventos también con el nombre `deviceorientationabsolute`, porque es el que AR.js escucha allí. En iOS real sólo existe `deviceorientation`.

#### Riesgos pendientes (a medir en el iPhone)

| # | Riesgo | Cómo se verá en el HUD |
|---|---|---|
| I1 | 🟡 Con el teléfono en vertical, `webkitCompassHeading` podría no referirse a la dirección de la cámara trasera | «Cámara apunta a X°» difiere de la app Brújula del iPhone en un ángulo constante → anotarlo |
| I2 | 🟡 Chrome iOS podría no exponer `webkitCompassHeading` | «Norte iOS: brújula iOS no disponible» → el cubo se verá, pero en dirección arbitraria |
| I3 | Declinación magnética: `webkitCompassHeading` es magnético, no geográfico | Desvío constante de pocos grados; aceptable dentro de ±15° |
| I4 | Varios diálogos de permiso en Safari (A-Frame, aviso de AR.js «tap the screen», botón) | Molestia de experiencia de usuario, no funcional |
| I5 | Teléfono en horizontal (apaisado) no probado | Probar sólo en retrato por ahora |

#### Instrucciones simplificadas para el iPhone (primero Chrome iOS, luego Safari si hace falta)
1. Abrir: `https://lgqseiscelularlg-source.github.io/Cloude/poc-geo.html?lat=-29.477168&lon=-66.889542`. Abajo debe decir «**PoC geo 2**»; si no, recargar o usar una pestaña de incógnito.
2. Aceptar cámara y ubicación. Pulsar «**Allow**» si aparece y luego «**Activar brújula**».
3. Sostener el iPhone **en vertical**, como para una foto. Mover el teléfono en forma de «8» unos segundos.
4. Mirar el HUD:
   - «Control AR.js: **recibe datos**» (verde). Si dice SIN DATOS → captura y fin de la prueba: error de implementación.
   - «Norte iOS: **corregido**». Si dice otra cosa, anotar el texto.
   - «Cámara apunta a **número**°». Ya no debe aparecer `—°`.
5. Alejarse 15–20 m del árbol y seguir la guía «gira X°» hasta «✅ el cubo está al frente». ¿Se ven el cubo rojo y Goku? ¿Están sobre el árbol?
6. Caminar 10 m de costado: ¿se quedan sobre el árbol?
7. Opcional: comparar «Cámara apunta a» con la app Brújula del iPhone. Repetir con `&norte=0` y, si hace falta, en Safari.
8. Enviar capturas con el HUD completo e indicar el navegador usado.


### 10.11 Prueba real #2 (PoC geo 2, Chrome iOS) y análisis de estabilidad (entrada #9) — sin cambios de código

#### Resultados confirmados en el iPhone (Chrome iOS)

| Indicador | Resultado | Estado |
|---|---|---|
| Control AR.js | recibe datos | 🟢 **D17 resuelto en el dispositivo** |
| Norte iOS | corregido | 🟢 D18 activo (con defecto D19, ver abajo) |
| Cámara apunta a | rumbo numérico | 🟢 |
| Cubo rojo y Goku | **visibles** | 🟢 |
| Gestos (horizontal, vertical, zoom) | funcionan | 🟢 |
| Coherencia interna | OK | 🟢 La escena coincide siempre con lo que dice el GPS |
| Precisión GPS | ±3 a ±5 m | 🟢 Buena |
| Distancias al objetivo | ≈ 11,6 m y 22,1 m | — |
| Saltos GPS aceptados | 5,2 a 10,7 m | 🔴 Perceptibles |

**Observaciones (🔴 estabilidad):**
1. Al caminar o mover el teléfono, el modelo se desplaza o se reajusta respecto del entorno.
2. **Movimientos espontáneos también con el usuario detenido.**
3. En una captura, Goku aparece sobre un automóvil aunque el objetivo es el árbol.
4. En el video, el modelo entra y sale del encuadre al mover el teléfono.

#### Análisis: cuánto movimiento viene del GPS y cuánto de la orientación
- **Ángulo en pantalla del modelo** = (rumbo de la cámara al ancla, que depende sólo de la **posición GPS**) − (rumbo de la cámara, que depende sólo de la **orientación**).
- La coherencia interna OK descarta errores en el paso de GPS a escena.
- **Encuadre:** con `fov` 80° vertical y el iPhone en retrato (390×844), el campo horizontal es ≈ **42,4°**, es decir **±21,2°** desde el centro. Cualquier error mayor que ~21° saca el modelo de la pantalla.

**D20 – ✅ CONFIRMADO (cálculo + simulación): `gpsMinDistance=5` convierte el ruido GPS en saltos grandes.**
- AR.js sólo mueve la cámara cuando el nuevo fix se aleja **≥ 5 m del último aceptado**. Con el usuario quieto, el error GPS deriva lentamente y, al acumular 5 m, la cámara **salta de golpe ≥ 5 m**. Coincide con el salto de 5,2 m registrado y explica los **movimientos espontáneos estando detenido**.
- **Desvío angular** de un salto lateral:

| Distancia | Salto 5,2 m | Salto 10,7 m |
|---|---|---|
| 11,6 m | **24,1°** (> medio encuadre) | **42,7°** (todo el encuadre) |
| 22,1 m | 13,2° | 25,8° |

- **Simulación** (scratchpad, 200 corridas): teléfono detenido 10 min, error GPS correlado con σ = 3 m por eje y τ = 20 s, 1 fix/s, a 11,6 m del objetivo.

| Estrategia | Saltos > 0,5 m / 10 min | Salto mediano | Desvío RMS | Desvío máx |
|---|---|---|---|---|
| GPS crudo (`gpsMinDistance=0`) | 520 (temblor continuo) | 1,2 m | 13,8° | 36,7° |
| **Actual (`gpsMinDistance=5`)** | **27 (uno cada ~22 s)** | **5,4 m** | 13,9° | 32,6° |
| Kalman, modo caminando | 239 (pequeños) | 0,7 m | 12,9° | 32,3° |
| **Kalman, modo detenido** | **≈ 1** | 0,4 m | **10,0°** | 22,9° |

- **Conclusiones:**
  - El umbral de 5 m **no reduce el error**: el RMS es igual al del GPS crudo. Sólo lo **cuantiza en saltos perceptibles**.
  - Un filtro que sepa que el usuario está quieto **elimina casi todos los saltos**.
  - Lo que queda es el **sesgo lento del GPS** (unos metros), que ningún filtro puede eliminar: se percibe como un **desplazamiento fijo** del modelo respecto del árbol, no como movimiento. *Goku sobre el auto* es compatible con ese sesgo más un salto.
- **Saltos de 10,7 m:** más probables al caminar (fixes acumulados) o por un fix atípico. El registro de la prueba #3 lo dirá.

**D19 – ✅ CONFIRMADO (matemática + 🧪 emulación): error de implementación en la corrección de norte de PoC geo 2.**
- Con el teléfono vertical (β≈90°), el rumbo real de la cámara según el modelo W3C, que es el que usa AR.js, es **−(α + γ)**, no −α.
- La fórmula de D18, `offset = −brújula − α`, **ignora γ** (la inclinación lateral). Cada grado de inclinación lateral de la mano se convierte en un grado de error de norte.

| Prueba (teléfono apuntando siempre al árbol, emulación de Chrome iOS) | Rumbo en el HUD | Cubo en pantalla | Desvío |
|---|---|---|---|
| γ = 0° | 0° | centrado | 0,0° |
| γ = 8° | 352° | NDC x = 0,36 | **8,0°** |
| γ = 15° | 345° | NDC x = 0,69 | **15,0°** |
| γ = −15° | 15° | NDC x = −0,69 | **15,0°** |

- Al caminar o mover el teléfono, la inclinación lateral cambia continuamente, así que **el modelo se mueve con la mano**. Es un contribuyente directo de la observación 1 y, en parte, de la 2.
- **Es un error de Robin, no del sensor ni del GPS.** Se corrige calculando el rumbo con la orientación completa (α, β, γ), igual que AR.js.

**D21 – ✅ CONFIRMADO (código): el filtro de la corrección de norte casi no suaviza.**
- La media circular con factor 0,2 se aplica **en cada evento** (~60 Hz), así que su constante de tiempo es ≈ 0,08 s. El ruido de `webkitCompassHeading` (magnetómetro) pasa casi intacto al rumbo; sólo lo atenúa el `smoothingFactor` 0,1 de AR.js (≈ 0,15 s).
- En teoría, el desfase entre `alpha` relativo (giroscopio, suave) y la brújula es **casi constante**: debería estimarse **lentamente**, en segundos, y no seguir la brújula al instante.
- Las perturbaciones magnéticas cercanas (un **automóvil**, estructuras metálicas) desvían la brújula varios grados. Con el filtro actual, ese desvío se traslada de inmediato a la escena.

**D22 – 🟡 HIPÓTESIS (a medir): retardo de orientación y encuadre estrecho.**
- `smoothingFactor` 0,1 de AR.js introduce ≈ 150 ms de retardo. En giros rápidos, el modelo «nada» respecto del video.
- Junto con el encuadre de ±21°, explica en parte que el modelo entre y salga del encuadre en el video.
- Que salga del encuadre al apuntar hacia otro lado es **esperable**: un objeto anclado sólo se ve en su dirección.

**Resumen de atribución (a confirmar con la prueba #3):**

| Situación | Causa principal | Tipo |
|---|---|---|
| Detenido: saltos espontáneos cada decenas de segundos | D20 (saltos GPS ≥ 5 m) | GPS (sensor) agravado por la configuración |
| Detenido: temblor o deriva de pocos grados | D21 (ruido de la brújula sin filtrar) | Brújula agravada por la implementación |
| Al mover la mano o el teléfono: el modelo se desplaza | **D19** (γ ignorado) + D22 | **Implementación** + retardo |
| Al caminar: saltos de 5–10 m | D20 | GPS |
| Goku sobre el auto | Sesgo GPS (3–5 m) + salto D20 + posible desvío magnético por el auto | GPS / brújula |

#### Mejoras propuestas (PoC geo 3) — ⏳ pendientes de autorización (P14)
Todas son **reversibles por parámetro URL** (los valores por defecto se indican; con `modo=geo2` se reproduce exactamente la PoC geo 2) y se revierten con `git revert`. El ancla **nunca se mueve**: los filtros actúan sólo sobre la estimación de la posición y el rumbo de la **cámara**.

| # | Mejora | Justificación | Riesgo / retraso | Parámetro |
|---|---|---|---|---|
| **M1** | **Corregir D19**: `offset = rumbo(α, β, γ) − brújula`, calculando el rumbo con la orientación completa (misma convención que AR.js) | Error de implementación confirmado (error = γ) | Ninguno. Verificable en emulación (desvío 0° con γ = ±15°) | — (corrección) |
| **M2** | **Filtro lento del norte** (complementario): el giroscopio (`alpha`) manda a corto plazo y la brújula sólo corrige el desfase a largo plazo (τ ≈ 4 s). Convergencia rápida los primeros 2 s. Rechazo de lecturas que difieran > 25° de la estimación (perturbación magnética). Se actualiza sólo con precisión de brújula ≤ 25° y el teléfono sin giros rápidos | D21. Cerca del auto, la brújula se desvía y el giroscopio no | Tras una perturbación real, el norte tarda ~4 s en reajustarse | `tauNorte=4` (0 = comportamiento geo 2) |
| **M3** | **Filtro GPS propio** (Kalman 2D ponderado por la precisión de cada fix), con `gpsMinDistance` de AR.js a 0. La cámara se desplaza **suavemente** (interpolación ≈ 0,7 s) en vez de saltar. Ruido de proceso adaptativo: alto al caminar, muy bajo detenido | D20: la simulación pasa de 27 saltos de 5,4 m a ≈ 1 estando detenido | Al caminar, un retraso de 1–2 s (≈ 1–2 m) en la posición estimada. No corrige el sesgo absoluto del GPS | `filtro=kalman` / `filtro=0` |
| **M4** | **Detección de movimiento** con el acelerómetro (`DeviceMotionEvent`; su permiso iOS se pide con el mismo botón) para decidir entre modo detenido y caminando en M3. Respaldo: velocidad GPS si no hay permiso | Sin saber si el usuario camina, M3 debe elegir entre temblor y retraso | Permiso adicional en iOS | dentro de `filtro=kalman` |
| **M5** | **Registro diagnóstico**: muestras a 10 Hz (fix crudo, precisión, posición filtrada y de la cámara, rumbo de la cámara, brújula, α β γ, offset, ángulo del modelo en pantalla y su descomposición **Δ por GPS / Δ por orientación**). Marcas de eventos en el log (`⚡ salto GPS X m → Δ Y°`, `🧭 Δ orientación Z° sin GPS`) y botón «**Copiar registro**» (portapapeles) para enviarlo a Robin | Requisito de Nami: separar GPS, brújula e implementación | Ninguno (sólo diagnóstico; se oculta con `diag=0`) | `diag=1` (por defecto) |
| **M6** | **Parámetros de aislamiento**: `gps=fijo` congela la posición de la cámara tras el primer fix (aísla la orientación); `norte=0` (ya existe) aísla la brújula; `suave=0.1` ajusta el `smoothingFactor` de AR.js (retardo frente a temblor) | Permite pruebas A/B en el mismo lugar sin tocar código | Ninguno | `gps`, `norte`, `suave` |

- **Prioridad recomendada:** M1 + M5 + M6 (imprescindibles para diagnosticar con datos limpios), luego M2 y M3 + M4.
- Propongo incluir M2 y M3 en la misma PoC geo 3, **activables por parámetro**, para compararlos en una sola salida de campo:
  - M2 activo por defecto, porque es de bajo riesgo.
  - M3 **desactivado por defecto** en la primera prueba, para tener una línea base.
- **Verificación previa (🧪):** pruebas existentes (iOS 30/30, Android 30/30, v78) más pruebas nuevas:
  - inclinación lateral: desvío < 1° con γ = ±15°;
  - brújula con ruido y perturbación de 30° durante 2 s: el modelo no se mueve más de 3°;
  - GPS con ruido correlado en reposo: < 3 saltos > 1 m en 10 min con `filtro=kalman`;
  - caminata simulada: la cámara sigue la trayectoria con un retraso ≤ 2 m;
  - el registro descompone correctamente los movimientos inyectados por GPS y por orientación.

#### Prueba diagnóstica #3 propuesta (Chrome iOS, mismo árbol, ~15 min)
- **Antes de empezar:** calibrar la brújula con un «8», alejarse **≥ 3 m del automóvil** y ubicarse a 15–20 m del árbol.
- **Para cada tramo:** pulsar «Copiar registro» y pegarlo en un mensaje, además de una captura con el HUD.

| Tramo | URL extra | Cómo | Qué separa |
|---|---|---|---|
| T1 Base detenida | (ninguna) | Teléfono **apoyado** en algo fijo (pared, poste, mochila), apuntando al árbol, **2 min sin tocarlo** | Cada movimiento queda marcado como ⚡ GPS o 🧭 orientación |
| T2 Sin GPS | `&gps=fijo` | Igual que T1, 1 min | Todo movimiento restante es **orientación** (brújula o giroscopio) |
| T3 Sin brújula | `&gps=fijo&norte=0` | Igual que T1, 1 min | Todo movimiento restante es el **giroscopio** (debería ser casi nulo). T2 − T3 = brújula |
| T4 Inclinación lateral | (ninguna) | Apuntando al árbol, inclinar el teléfono de lado ±15° **sin girarlo** | **Verifica M1** (D19): el modelo no debe moverse |
| T5 Filtro GPS detenido | `&filtro=kalman` | Igual que T1, 2 min | **Verifica M3**: los saltos espontáneos deberían desaparecer |
| T6 Caminata | sin y con `&filtro=kalman` | Caminar 10 m de costado, ida y vuelta, apuntando al árbol | Anclaje al caminar: saltos frente a desplazamiento suave |

**Cómo se clasificará cada movimiento con el registro:**
- **GPS:** el movimiento coincide con un `⚡ salto GPS`, y su magnitud angular ≈ atan(salto/distancia).
- **Brújula:** `🧭 Δ orientación` aparece con el teléfono apoyado y desaparece con `norte=0`.
- **Giroscopio:** deriva lenta que persiste en T3 (esperable < 1–2°/min).
- **Implementación:**
  - coherencia ERROR;
  - el modelo se mueve en T4 (γ) después de M1;
  - movimientos con el teléfono apoyado **sin** ninguna marca ⚡ ni 🧭;
  - la suma Δ GPS + Δ orientación no coincide con el movimiento medido del modelo.

**Criterios de aceptación para la PoC geo 3:**
- T4: desvío ≤ 3°.
- T2: deriva ≤ 3° en 1 min.
- T5: como máximo 1 salto visible > 5° en 2 min.
- T6: el modelo vuelve a quedar sobre el árbol en ±10° tras volver al punto de partida.
