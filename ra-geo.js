// =============================================================================
// RealityTour – Módulo RA geolocalizado 1.0 (AR.js 3.4.8 + A-Frame 1.6.0)
// Origen: PoC geo 3 validada en iPhone (Chrome iOS). Gestos: copia textual de v78.
//
// Configuración (para integrar en otra página, definir ANTES de cargar este script):
//   window.RAGEO_CONFIG = { lugares: [
//     { id: "goku", lat: -29.47, lon: -66.88, modelo: "./models/goku.glb", escala: 300, altura: 3 },
//     ... (2 o 3 lugares, cada uno con su ancla, su modelo y sus gestos)
//   ] };
// Parámetros URL: lat, lon (reemplazan las coordenadas del 1.er lugar), acc (m),
//   radio (m, 0 = sin perímetro), diag=1 (carga ra-geo-diag.js: HUD y registro).
// =============================================================================
if (!/Mobi|Android/i.test(navigator.userAgent)) {
  document.getElementById("desktop-warning").classList.remove("hidden");
}

// ---------------------------------------------------------------- Configuración
const params = new URLSearchParams(location.search);
function numParam(name, def) {
  const v = params.get(name);
  if (v === null || v.trim() === "") return def;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}
const LUGARES_POR_DEFECTO = [
  { id: "goku", lat: -29.477051, lon: -66.889616, modelo: "./models/goku.glb", escala: 300, altura: 3 },
];
const lugares = ((window.RAGEO_CONFIG && window.RAGEO_CONFIG.lugares) || LUGARES_POR_DEFECTO)
  .map((l, i) => ({ id: l.id || "lugar" + (i + 1), lat: l.lat, lon: l.lon, modelo: l.modelo,
    escala: l.escala || 300, altura: l.altura === undefined ? 3 : l.altura, ancla: null, pivote: null, estado: "esperando GPS" }));
if (params.has("lat")) lugares[0].lat = numParam("lat", lugares[0].lat);
if (params.has("lon")) lugares[0].lon = numParam("lon", lugares[0].lon);

const AJUSTES = {
  precisionMin: numParam("acc", 20),  // m: fixes con peor precisión se ignoran
  distanciaMin: 1.5,                  // m: cambio mínimo de posición para mover la cámara
  saltoSospechoso: 8,                 // m: un salto mayor se retiene hasta que otro fix lo confirme
  confirmacion: 4,                    // m: radio en que el fix siguiente confirma el salto
  tauDeslizamiento: 800,              // ms: la cámara se desliza hacia la nueva posición
  radio: numParam("radio", 0),        // m: 0 = sin perímetro
  diag: params.get("diag") === "1",
};
const errores = [];
lugares.forEach((l) => {
  if (!(l.lat >= -90 && l.lat <= 90 && l.lon >= -180 && l.lon <= 180)) errores.push(l.id + ": coordenadas inválidas");
  if (!l.modelo) errores.push(l.id + ": falta el modelo");
});
if (!(AJUSTES.precisionMin > 0)) errores.push("acc inválida");
if (!(AJUSTES.radio >= 0)) errores.push("radio inválido");

const sceneEl = document.querySelector("a-scene");
const camEl = document.querySelector("a-camera");

// Estado compartido (lo lee el diagnóstico opcional y las pruebas automáticas)
const estado = {
  version: "RA geo 1.0",
  origenFijado: false,
  fixesAceptados: 0,
  ultimoFix: null,          // {lat, lon} posición GPS que representa la cámara
  ultimoCrudo: null,        // {lat, lon, acc, t}
  ultimoSaltoM: null,
  saltosRetenidos: 0,
  objetivoCamara: null,     // {x, z} hacia donde se desliza la cámara
  norte: { estado: "sin datos de brújula", offset: null, precision: null },
  orient: { alpha: null, beta: null, gamma: null, rumboSensor: null, brujula: null, n: 0 },
  respaldoOrientacion: 0,
  eventos: [],
};
function evento(tipo, texto) {
  estado.eventos.push({ t: Date.now(), tipo, texto });
  if (estado.eventos.length > 200) estado.eventos.shift();
  console.log(texto);
}

// Anclas: una entidad por lugar, DESPUÉS de la cámara en el DOM (D13).
lugares.forEach((l) => {
  const a = document.createElement("a-entity");
  a.setAttribute("id", "ancla-" + l.id);
  a.setAttribute("position", "0 0 0");
  sceneEl.appendChild(a);
  l.ancla = a;
});

// Selección del modelo que reciben los gestos: el más cercano al centro de la
// pantalla en el momento de tocar (con un solo lugar, siempre es ese).
const _vSel = new THREE.Vector3();
function seleccionarModelo() {
  const cam = sceneEl.camera;
  if (!cam) return;
  let mejor = null, dMin = Infinity;
  for (const l of lugares) {
    if (!l.pivote) continue;
    l.pivote.object3D.getWorldPosition(_vSel).project(cam);
    if (_vSel.z >= 1 || Math.abs(_vSel.x) > 1.2 || Math.abs(_vSel.y) > 1.2) continue;
    const d = _vSel.x * _vSel.x + _vSel.y * _vSel.y;
    if (d < dMin) { dMin = d; mejor = l; }
  }
  if (mejor) currentModel = mejor.pivote;
}
// Registrado ANTES que los gestos: se ejecuta primero en cada touchstart.
document.getElementById("gesture-layer").addEventListener("touchstart", (e) => {
  if (e.touches.length === 1 || e.touches.length === 2) seleccionarModelo();
}, { passive: true });

//-----------------------------------------------------------------------------

// ====== GESTOS EN CAPA SUPERIOR (1 dedo: rotar horizontal/vertical, 2 dedos: zoom) ======
// Los gestos actúan SOLO sobre el pivote (rotación y escala visual).
// El ancla geolocalizada nunca se rota, escala ni desplaza.
const gestureLayer = document.getElementById('gesture-layer');

let currentModel = null;        // pivote activo (se setea al crear)
let gestureMode = null;         // 'rotate' | 'pinch' | null
let lastX = 0;
let lastY = 0;
let pinchStartDist = 0;
let baseScale = 300;            // tu escala inicial
const ROT_SENS = 0.005;         // sensibilidad rotación (rad por píxel)
const SCALE_MIN = 50;
const SCALE_MAX = 1500;
const MIN_PINCH_DIST = 10;      // px: por debajo, la pinza no tiene referencia fiable
const MAX_TILT = (80 * Math.PI) / 180; // inclinación máxima respecto a la vertical

const _q = new THREE.Quaternion();
const _qCand = new THREE.Quaternion();
const _qParentInv = new THREE.Quaternion();
const _up = new THREE.Vector3();
const _right = new THREE.Vector3();
const _modelUp = new THREE.Vector3();

function distTouches(t0, t1) {
  const dx = t0.pageX - t1.pageX;
  const dy = t0.pageY - t1.pageY;
  return Math.hypot(dx, dy);
}

// Reinicia la referencia del gesto cada vez que cambia el número de dedos,
// para que no haya saltos al pasar de pinza a rotación (o al revés).
function syncGesture(e) {
  if (e.touches.length === 1) {
    gestureMode = 'rotate';
    lastX = e.touches[0].pageX;
    lastY = e.touches[0].pageY;
  } else if (e.touches.length === 2) {
    gestureMode = 'pinch';
    pinchStartDist = distTouches(e.touches[0], e.touches[1]);
    baseScale = currentModel.object3D.scale.x;
  } else {
    gestureMode = null;
  }
}

// Calcula, en el espacio LOCAL del padre del pivote (el ancla):
//  - _up: la vertical del mundo
//  - _right: la "derecha" de la cámara proyectada al plano horizontal
// Devuelve null si no hay un eje horizontal fiable.
function computeAxes(obj) {
  obj.parent.getWorldQuaternion(_qParentInv).conjugate();
  _up.set(0, 1, 0).applyQuaternion(_qParentInv);
  obj.el.sceneEl.camera.getWorldQuaternion(_q);
  _right.set(1, 0, 0).applyQuaternion(_q).applyQuaternion(_qParentInv);
  _right.addScaledVector(_up, -_right.dot(_up));
  return _right.lengthSq() > 1e-6 ? _right.normalize() : null;
}

// Inclinación = ángulo entre el "arriba" del modelo y la vertical del mundo.
// La rotación horizontal (sobre _up) no la cambia, así que el límite se
// mantiene al combinar ambos gestos.
function tiltOf(q) {
  _modelUp.set(0, 1, 0).applyQuaternion(q);
  return Math.acos(Math.min(1, Math.max(-1, _modelUp.dot(_up))));
}

function applyTilt(obj, axis, angle) {
  const before = tiltOf(obj.quaternion);
  _q.setFromAxisAngle(axis, angle);
  _qCand.copy(obj.quaternion).premultiply(_q);
  const after = tiltOf(_qCand);
  if (after <= MAX_TILT || after <= before) {
    obj.quaternion.copy(_qCand);
    return;
  }
  // Se pasaría del límite: aplicar la mayor fracción del giro que lo respete.
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    _q.setFromAxisAngle(axis, angle * mid);
    _qCand.copy(obj.quaternion).premultiply(_q);
    if (tiltOf(_qCand) <= MAX_TILT) lo = mid;
    else hi = mid;
  }
  _q.setFromAxisAngle(axis, angle * lo);
  obj.quaternion.premultiply(_q);
}

gestureLayer.addEventListener('touchstart', (e) => {
  if (!currentModel) return;
  syncGesture(e);
  e.preventDefault();
  e.stopPropagation();
}, { passive: false });

gestureLayer.addEventListener('touchmove', (e) => {
  if (!currentModel) return;
  const obj = currentModel.object3D;
  if (gestureMode === 'rotate' && e.touches.length === 1) {
    const t = e.touches[0];
    const dx = t.pageX - lastX;
    const dy = t.pageY - lastY;
    lastX = t.pageX;
    lastY = t.pageY;
    const right = computeAxes(obj);
    _q.setFromAxisAngle(_up, -dx * ROT_SENS);  // horizontal: sobre la vertical
    obj.quaternion.premultiply(_q);
    if (right) applyTilt(obj, right, dy * ROT_SENS); // vertical: hacia/desde la cámara
    obj.quaternion.normalize();
  } else if (gestureMode === 'pinch' && e.touches.length === 2) {
    const now = distTouches(e.touches[0], e.touches[1]);
    if (pinchStartDist < MIN_PINCH_DIST) {
      // Dedos demasiado juntos al empezar: tomar referencia ahora.
      pinchStartDist = now;
      baseScale = obj.scale.x;
    } else {
      let s = baseScale * (now / pinchStartDist);
      s = Math.min(SCALE_MAX, Math.max(SCALE_MIN, s));
      obj.scale.set(s, s, s);
    }
  }
  e.preventDefault();
  e.stopPropagation();
}, { passive: false });

const onTouchEnd = (e) => {
  if (!currentModel) return;
  syncGesture(e);
};
gestureLayer.addEventListener('touchend', onTouchEnd);
gestureLayer.addEventListener('touchcancel', onTouchEnd);

// iOS Safari: evita el zoom nativo de la página durante la pinza.
document.addEventListener('gesturestart', (e) => e.preventDefault());

// =============================================================================
// GEOMETRÍA
// =============================================================================
const R_TIERRA = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const norm360 = (a) => ((a % 360) + 360) % 360;
const difAng = (a, b) => ((a - b + 540) % 360) - 180; // [-180, 180)

// Proyección local en METROS centrada en el primer lugar (1 unidad = 1 m real).
// Sustituye a Spherical Mercator de AR.js (+15 % de distancia en esta latitud).
const ORIGEN_PROY = { lat: lugares[0].lat, lon: lugares[0].lon };
const proyeccionLocal = {
  project: (lon, lat) => [R_TIERRA * rad(lon - ORIGEN_PROY.lon) * Math.cos(rad(ORIGEN_PROY.lat)), R_TIERRA * rad(lat - ORIGEN_PROY.lat)],
  unproject: (p) => [ORIGEN_PROY.lon + deg(p[0] / (R_TIERRA * Math.cos(rad(ORIGEN_PROY.lat)))), ORIGEN_PROY.lat + deg(p[1] / R_TIERRA)],
  getID: () => "local-equirect-m",
};

function calcularDistancia(lat1, lon1, lat2, lon2) {
  const φ1 = rad(lat1), φ2 = rad(lat2), Δφ = rad(lat2 - lat1), Δλ = rad(lon2 - lon1);
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 6371e3 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// =============================================================================
// GPS: AR.js (gps-new-camera) + deslizamiento de la cámara
// - AR.js sólo acepta fixes con precisión ≤ precisionMin y cambios ≥ distanciaMin (1,5 m).
// - En vez de saltar, la cámara se DESLIZA hacia la nueva posición (≈ 0,8 s).
// - Un salto > 8 m se retiene hasta que el fix siguiente lo confirme (picos del GPS).
// - Las anclas NUNCA se mueven: sólo cambia la estimación de la posición del usuario.
// =============================================================================
function configurarCamara() {
  const comp = camEl.components["gps-new-camera"];
  if (!comp || !comp.threeLoc) return false;
  comp.threeLoc.setProjection(proyeccionLocal);
  comp.threeLoc.setGpsOptions({ gpsMinAccuracy: AJUSTES.precisionMin, gpsMinDistance: AJUSTES.distanciaMin });
  camEl.setAttribute("gps-new-camera", { positionMinAccuracy: AJUSTES.precisionMin, gpsMinDistance: AJUSTES.distanciaMin });
  return true;
}
if (!configurarCamara()) {
  camEl.addEventListener("componentinitialized", (e) => { if (e.detail.name === "gps-new-camera") configurarCamara(); });
}

let posVisual = null;      // {x, z} posición mostrada (la que se desliza)
let saltoPendiente = null; // {x, z, lat, lon} salto sospechoso a la espera de confirmación

camEl.addEventListener("gps-camera-update-position", (e) => {
  if (errores.length) return;
  const p = e.detail.position;
  const cam = camEl.object3D.position;
  const nuevo = { x: cam.x, z: cam.z, lat: p.latitude, lon: p.longitude };
  estado.fixesAceptados++;

  if (!estado.origenFijado) {
    // Primer fix: origen del mundo (initialPositionAsOrigin) y anclas (D14).
    estado.origenFijado = true;
    posVisual = { x: nuevo.x, z: nuevo.z };
    aceptarPosicion(nuevo, 0);
    lugares.forEach((l) => {
      l.ancla.setAttribute("gps-new-entity-place", { latitude: l.lat, longitude: l.lon });
      l.estado = "anclado";
    });
    evento("gps", "📌 Anclas geolocalizadas (" + lugares.length + ")");
    actualizarLugares();
    return;
  }

  // AR.js ya movió la cámara: se restaura la posición visual y se desliza en tick().
  cam.x = posVisual.x;
  cam.z = posVisual.z;
  const obj = estado.objetivoCamara;
  const salto = Math.hypot(nuevo.x - obj.x, nuevo.z - obj.z);

  if (saltoPendiente) {
    const conf = Math.hypot(nuevo.x - saltoPendiente.x, nuevo.z - saltoPendiente.z);
    saltoPendiente = null;
    if (conf <= AJUSTES.confirmacion) {
      evento("gps", "✅ GPS: salto de " + salto.toFixed(1) + " m confirmado");
      aceptarPosicion(nuevo, salto);
      return;
    }
  }
  if (salto > AJUSTES.saltoSospechoso) {
    saltoPendiente = { ...nuevo, t: Date.now() };
    estado.saltosRetenidos++;
    evento("gps", "🚫 GPS: salto sospechoso de " + salto.toFixed(1) + " m retenido hasta confirmar");
    return;
  }
  aceptarPosicion(nuevo, salto);
});

function aceptarPosicion(n, salto) {
  estado.objetivoCamara = { x: n.x, z: n.z };
  estado.ultimoFix = { lat: n.lat, lon: n.lon };
  estado.ultimoSaltoM = salto;
  if (salto > 0) evento("gps", "⚡ GPS: la cámara se desliza " + salto.toFixed(1) + " m");
}

// Si en 2 s no llega ningún fix que contradiga un salto retenido, se acepta
// (iOS puede dejar de entregar fixes cuando la posición no cambia).
setInterval(() => {
  if (!saltoPendiente || Date.now() - saltoPendiente.t < 2000) return;
  const pend = saltoPendiente, o = estado.objetivoCamara;
  saltoPendiente = null;
  evento("gps", "✅ GPS: salto de " + Math.hypot(pend.x - o.x, pend.z - o.z).toFixed(1) + " m confirmado (sin fixes contradictorios)");
  aceptarPosicion(pend, Math.hypot(pend.x - o.x, pend.z - o.z));
}, 500);

AFRAME.registerComponent("rageo-deslizamiento", {
  tick: function (t, dt) {
    const obj = estado.objetivoCamara;
    if (!obj || !posVisual || !dt) return;
    const k = 1 - Math.exp(-dt / AJUSTES.tauDeslizamiento);
    posVisual.x += (obj.x - posVisual.x) * k;
    posVisual.z += (obj.z - posVisual.z) * k;
    const p = this.el.object3D.position;
    p.x = posVisual.x;
    p.z = posVisual.z;
  },
});
camEl.setAttribute("rageo-deslizamiento", "");

// Fixes crudos: distancia mostrada y perímetro opcional
if (errores.length === 0) {
  navigator.geolocation.watchPosition(
    (pos) => {
      const c = pos.coords;
      estado.ultimoCrudo = { lat: c.latitude, lon: c.longitude, acc: c.accuracy, t: Date.now() };
      // Un salto retenido también se confirma si el GPS se queda junto a él (AR.js no
      // emite actualización porque el cambio es < distanciaMin).
      if (saltoPendiente && Date.now() - saltoPendiente.t > 800 && c.accuracy <= AJUSTES.precisionMin &&
          calcularDistancia(c.latitude, c.longitude, saltoPendiente.lat, saltoPendiente.lon) <= AJUSTES.confirmacion) {
        const pend = saltoPendiente, o = estado.objetivoCamara;
        saltoPendiente = null;
        evento("gps", "✅ GPS: salto de " + Math.hypot(pend.x - o.x, pend.z - o.z).toFixed(1) + " m confirmado");
        aceptarPosicion(pend, Math.hypot(pend.x - o.x, pend.z - o.z));
      }
      const d = Math.min(...lugares.map((l) => calcularDistancia(c.latitude, c.longitude, l.lat, l.lon)));
      const display = document.getElementById("distancia-display");
      if (display) display.innerText = "Distancia: " + d.toFixed(1) + " m";
      actualizarLugares();
    },
    (err) => console.log("⚠️ GPS error " + err.code + ": " + err.message),
    { enableHighAccuracy: true }
  );
} else {
  console.log("❌ Configuración inválida: " + errores.join(", "));
}

// =============================================================================
// MODELOS (uno por lugar)
// =============================================================================
function actualizarLugares() {
  if (!estado.origenFijado) return;
  if (!sceneEl.hasLoaded) { sceneEl.addEventListener("loaded", actualizarLugares, { once: true }); return; } // D12
  const ref = estado.ultimoCrudo || estado.ultimoFix;
  for (const l of lugares) {
    const dentro = AJUSTES.radio === 0 || (ref && calcularDistancia(ref.lat, ref.lon, l.lat, l.lon) <= AJUSTES.radio);
    if (dentro && !l.pivote) crearModelo(l);
    if (!dentro && l.pivote) {
      if (currentModel === l.pivote) currentModel = null;
      l.pivote.parentNode.removeChild(l.pivote);
      l.pivote = null;
      l.estado = "fuera del perímetro";
    }
  }
  if (!currentModel) seleccionarModelo();
  if (!currentModel) { const l = lugares.find((x) => x.pivote); if (l) currentModel = l.pivote; }
}

function crearModelo(l) {
  // Pivote de interacción, hijo del ancla: recibe rotación y escala de los gestos.
  const pivot = document.createElement("a-entity");
  pivot.setAttribute("position", { x: 0, y: l.altura, z: 0 });
  pivot.setAttribute("scale", { x: l.escala, y: l.escala, z: l.escala });
  const model = document.createElement("a-entity");
  model.setAttribute("gltf-model", l.modelo);
  model.addEventListener("model-loaded", () => { centrarModelo(pivot, model); l.estado = "visible"; });
  pivot.appendChild(model);
  l.ancla.appendChild(pivot);
  l.pivote = pivot;
  l.estado = "cargando";
}

// D15: centro visual del GLB (posiciones mundiales de los huesos) llevado al
// origen del pivote, es decir, sobre la coordenada; convertido a coordenadas
// LOCALES del padre del mesh. Mallas con esqueleto: sin frustum culling (r164).
function centrarModelo(pivot, model) {
  const mesh = model.getObject3D("mesh");
  if (!mesh) return;
  pivot.object3D.updateWorldMatrix(true, true);
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  mesh.traverse((o) => {
    if (o.isBone) box.expandByPoint(o.getWorldPosition(v));
    if (o.isSkinnedMesh) o.frustumCulled = false;
  });
  if (box.isEmpty()) box.setFromObject(mesh);
  const centro = box.getCenter(new THREE.Vector3());
  if (![centro.x, centro.y, centro.z].every(Number.isFinite)) return;
  mesh.position.sub(model.object3D.worldToLocal(centro.clone()));
}

// =============================================================================
// ORIENTACIÓN (iOS: Safari y Chrome iOS; Android sin cambios)
// =============================================================================
function controlAR() {
  const c = camEl.components["arjs-device-orientation-controls"];
  return c ? c._orientationControls : null;
}
function controlRecibeDatos(ctrl) {
  return !!(ctrl && ctrl.deviceOrientation && ctrl.deviceOrientation.type && ctrl.deviceOrientation.alpha !== null);
}

// D17: AR.js pide el permiso al cargar SIN gesto; iOS lo rechaza y AR.js no registra
// sus listeners. Al llegar datos (permiso ya concedido) se reintenta connect(); si el
// control sigue sin recibir el evento, se le entrega el mismo evento que espera.
let reconectado = false;
function asegurarOrientacionAR(e) {
  const ctrl = controlAR();
  if (!ctrl) return;
  if (!reconectado) {
    reconectado = true;
    if (!controlRecibeDatos(ctrl)) ctrl.connect();
  }
  if (e.type !== ctrl.orientationChangeEventName) return;
  setTimeout(() => {
    if (ctrl.deviceOrientation !== e) { ctrl.deviceOrientation = e; estado.respaldoOrientacion++; }
  }, 0);
}

// Rumbo de la cámara (0° = norte, horario) que AR.js produce para (α, β, γ) sin
// alphaOffset — misma convención que THREEx.DeviceOrientationControls (M1).
const _eu = new THREE.Euler(), _qs = new THREE.Quaternion(), _qz = new THREE.Quaternion();
const _qx90 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
const _eje = new THREE.Vector3(0, 0, 1), _fw = new THREE.Vector3();
function rumboDesdeSensor(alpha, beta, gamma, orientPantalla) {
  _eu.set(rad(beta || 0), rad(alpha || 0), -rad(gamma || 0), "YXZ");
  _qs.setFromEuler(_eu).multiply(_qx90).multiply(_qz.setFromAxisAngle(_eje, -rad(orientPantalla || 0)));
  _fw.set(0, 0, -1).applyQuaternion(_qs);
  if (Math.hypot(_fw.x, _fw.z) < 0.5) return null;
  return norm360(deg(Math.atan2(_fw.x, -_fw.z)));
}

// D18 + M1: en iOS alpha es RELATIVO; el norte se corrige con webkitCompassHeading:
//   offset = rumbo(α, β, γ) − brújula   (validado en dispositivo: 0,7° en 60 s)
function corregirNorteIOS(e) {
  const n = estado.norte;
  if (typeof e.webkitCompassHeading !== "number") { n.estado = "brújula iOS no disponible"; return; }
  n.precision = e.webkitCompassAccuracy;
  if (!(e.webkitCompassAccuracy >= 0 && e.webkitCompassAccuracy < 50)) { n.estado = "calibrar brújula (gesto en «8»)"; return; }
  const ctrl = controlAR();
  if (!ctrl || e.alpha === null) return;
  const r0 = rumboDesdeSensor(e.alpha, e.beta, e.gamma, ctrl.screenOrientation);
  if (r0 === null) { if (n.offset === null) n.estado = "apuntar al horizonte"; return; }
  const objetivo = norm360(r0 - e.webkitCompassHeading);
  n.offset = n.offset === null ? objetivo : norm360(n.offset + 0.2 * difAng(objetivo, n.offset));
  ctrl.alphaOffset = rad(n.offset);
  n.estado = "corregido";
}

function leerOrientacion(e) {
  if (e.alpha === null && e.beta === null && e.gamma === null) return; // evento vacío
  const o = estado.orient, ctrl = controlAR();
  o.alpha = e.alpha; o.beta = e.beta; o.gamma = e.gamma; o.n++;
  o.brujula = typeof e.webkitCompassHeading === "number" ? e.webkitCompassHeading : o.brujula;
  o.rumboSensor = rumboDesdeSensor(e.alpha, e.beta, e.gamma, ctrl ? ctrl.screenOrientation : 0);
  asegurarOrientacionAR(e);
}
let hayAbsoluta = false;
window.addEventListener("deviceorientationabsolute", (e) => { hayAbsoluta = true; leerOrientacion(e); });
window.addEventListener("deviceorientation", (e) => {
  if (e.alpha === null && e.beta === null && e.gamma === null) return;
  corregirNorteIOS(e);
  if (!hayAbsoluta) leerOrientacion(e); else asegurarOrientacionAR(e);
});

// iOS: el permiso de orientación exige un toque explícito.
if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === "function") {
  const btn = document.createElement("button");
  btn.id = "btn-brujula";
  btn.textContent = "Activar brújula";
  btn.addEventListener("click", () => {
    DeviceOrientationEvent.requestPermission()
      .then((r) => { if (r === "granted") btn.remove(); })
      .catch((err) => console.log("❌ Permiso de orientación: " + err));
  });
  document.body.appendChild(btn);
}

// =============================================================================
// API y diagnóstico opcional (?diag=1 carga ra-geo-diag.js; el módulo no depende de él)
// =============================================================================
window.RAGeo = {
  version: estado.version, lugares, estado, AJUSTES, camEl, sceneEl,
  controlAR, rumboDesdeSensor, calcularDistancia, difAng, norm360,
  get modeloActivo() { return currentModel; },
};
if (AJUSTES.diag) {
  const s = document.createElement("script");
  s.src = "ra-geo-diag.js";
  document.body.appendChild(s);
}
