// =============================================================================
// RealityTour – PoC geo 2 (AR.js 3.4.8 + A-Frame 1.6.0) · corrección orientación iOS (D17, D18)
// Basada en script.js v78. El bloque de GESTOS es una copia textual de v78.
// Parámetros URL: lat, lon, radio (m, 0 = sin perímetro), h (m), acc (m), proj=mercator
// =============================================================================
if (!/Mobi|Android/i.test(navigator.userAgent)) {
  document.getElementById("desktop-warning").classList.remove("hidden");
}

// ---------------------------------------------------------------- Parámetros URL
const params = new URLSearchParams(location.search);
function numParam(name, def) {
  const v = params.get(name);
  if (v === null || v.trim() === "") return def;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}
const DEFAULT_TARGET = { lat: -29.477051, lon: -66.889616 };
const target = { lat: numParam("lat", DEFAULT_TARGET.lat), lon: numParam("lon", DEFAULT_TARGET.lon) };
const targetDesdeUrl = params.has("lat") || params.has("lon");
const radio = numParam("radio", 0);          // m; 0 = sin perímetro
const ALTURA = numParam("h", 3);             // m: centro del modelo sobre el suelo
const MIN_ACC = numParam("acc", 30);         // m: precisión mínima aceptada por AR.js
const USE_MERCATOR = params.get("proj") === "mercator";

const erroresParam = [];
if (!(target.lat >= -90 && target.lat <= 90)) erroresParam.push("lat inválida");
if (!(target.lon >= -180 && target.lon <= 180)) erroresParam.push("lon inválida");
if (!(radio >= 0)) erroresParam.push("radio inválido");
if (!Number.isFinite(ALTURA)) erroresParam.push("h inválida");
if (!(MIN_ACC > 0)) erroresParam.push("acc inválida");

const anchor = document.getElementById("anchor");
const cuboRef = document.getElementById("cubo-ref");
const camEl = document.querySelector("a-camera");
const sceneEl = document.querySelector("a-scene");
let modelClone = null; // pivote del modelo 3D interactivo (hijo del ancla)

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
// GEOLOCALIZACIÓN (PoC)
// =============================================================================
const R_TIERRA = 6371008.8; // m (radio medio)
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const norm360 = (a) => ((a % 360) + 360) % 360;

// Proyección local equirectangular en METROS centrada en el objetivo.
// Sustituye a Spherical Mercator (que en esta latitud agranda las distancias
// un sec(lat) ≈ 15 %). Se puede volver a la de AR.js con ?proj=mercator.
const proyeccionLocal = {
  project(lon, lat) {
    return [
      R_TIERRA * rad(lon - target.lon) * Math.cos(rad(target.lat)),
      R_TIERRA * rad(lat - target.lat),
    ];
  },
  unproject(p) {
    return [
      target.lon + deg(p[0] / (R_TIERRA * Math.cos(rad(target.lat)))),
      target.lat + deg(p[1] / R_TIERRA),
    ];
  },
  getID() { return "local-equirect-m"; },
};

// Estado de diagnóstico (también lo leen las pruebas automáticas)
const diag = {
  proyeccion: "pendiente",
  fixesCrudos: 0,
  fixesDescartados: 0,
  ultimoCrudo: null,          // {lat, lon, acc, t}
  fixesAceptados: 0,
  ultimoAceptado: null,       // {lat, lon} usado por AR.js para la cámara
  ultimoSaltoM: null,
  ancladoEn: null,
  orient: { evento: "sin datos", alpha: null, beta: null, gamma: null, absoluto: null, brujulaIOS: null, n: 0 },
  modelo: "no creado",
};
window.__poc = { diag, target, get currentModel() { return currentModel; } };

// D13 + proyección: configurar gps-new-camera en cuanto se inicializa (antes del primer fix).
function configurarCamara() {
  const comp = camEl.components["gps-new-camera"];
  if (!comp || !comp.threeLoc) return false;
  if (USE_MERCATOR) {
    diag.proyeccion = "Spherical Mercator (AR.js)";
  } else {
    comp.threeLoc.setProjection(proyeccionLocal);
    diag.proyeccion = "local en metros";
  }
  comp.threeLoc.setGpsOptions({ gpsMinAccuracy: MIN_ACC });
  return true;
}
if (!configurarCamara()) {
  camEl.addEventListener("componentinitialized", (e) => {
    if (e.detail.name === "gps-new-camera") configurarCamara();
  });
}

// D14: el ancla recibe su lat/lon DESPUÉS del primer fix aceptado
// (con initialPositionAsOrigin, antes no existe el origen del mundo).
camEl.addEventListener("gps-camera-update-position", (e) => {
  if (erroresParam.length) return; // con parámetros inválidos no se ancla nada
  const p = e.detail.position;
  const camPos = camEl.object3D.position;
  if (diag.ultimoAceptado) {
    diag.ultimoSaltoM = calcularDistancia(diag.ultimoAceptado.lat, diag.ultimoAceptado.lon, p.latitude, p.longitude);
  }
  diag.ultimoAceptado = { lat: p.latitude, lon: p.longitude };
  diag.fixesAceptados++;
  console.log(
    "📍 Fix aceptado #" + diag.fixesAceptados +
    (diag.ultimoSaltoM !== null ? " · salto " + diag.ultimoSaltoM.toFixed(1) + " m" : "") +
    " · cámara x=" + camPos.x.toFixed(1) + " z=" + camPos.z.toFixed(1)
  );
  if (!anchor.hasAttribute("gps-new-entity-place")) {
    anchor.setAttribute("gps-new-entity-place", { latitude: target.lat, longitude: target.lon });
    diag.ancladoEn = { lat: target.lat, lon: target.lon };
    console.log("📌 Ancla geolocalizada en " + target.lat.toFixed(6) + ", " + target.lon.toFixed(6));
  }
  actualizarPerimetro();
});

// Lectura de fixes crudos (incluye los que AR.js descarta por precisión)
let ultimoAvisoDescarte = 0;
if (erroresParam.length === 0) {
  navigator.geolocation.watchPosition(
    (pos) => {
      const c = pos.coords;
      diag.fixesCrudos++;
      diag.ultimoCrudo = { lat: c.latitude, lon: c.longitude, acc: c.accuracy, t: Date.now() };
      if (c.accuracy > MIN_ACC) {
        diag.fixesDescartados++;
        if (Date.now() - ultimoAvisoDescarte > 5000) {
          ultimoAvisoDescarte = Date.now();
          console.log("⚠️ GPS: precisión ±" + c.accuracy.toFixed(0) + " m > " + MIN_ACC + " m (fix descartado por AR.js)");
        }
      }
      const d = calcularDistancia(c.latitude, c.longitude, target.lat, target.lon);
      const display = document.getElementById("distancia-display");
      if (display) display.innerText = "Distancia: " + d.toFixed(1) + " m";
      actualizarPerimetro();
    },
    (err) => console.log("⚠️ GPS error " + err.code + ": " + err.message),
    { enableHighAccuracy: true }
  );
} else {
  console.log("❌ Parámetros URL inválidos: " + erroresParam.join(", "));
}

// Perímetro (se conserva de v78, ahora opcional): radio = 0 → sin límite.
function actualizarPerimetro() {
  if (!diag.ancladoEn) return; // sin ancla geolocalizada no se muestra nada
  const ref = diag.ultimoCrudo || diag.ultimoAceptado;
  const dentro = radio === 0 || (ref && calcularDistancia(ref.lat, ref.lon, target.lat, target.lon) <= radio);
  cuboRef.setAttribute("visible", dentro);
  if (dentro && !modelClone) {
    // D12: no crear el gltf-model antes de que la escena termine de cargar.
    if (sceneEl.hasLoaded) crearModeloInteractivo(anchor);
    else sceneEl.addEventListener("loaded", () => { if (!modelClone) actualizarPerimetro(); }, { once: true });
  }
  if (!dentro && modelClone) {
    modelClone.parentNode.removeChild(modelClone);
    modelClone = null;
    currentModel = null;
    diag.modelo = "fuera del perímetro";
  }
}

// -----------------------------------------------------------------------------
// 🔹 ORIENTACIÓN (PoC geo 2): correcciones D17 y D18 para iOS (Safari y Chrome iOS)
// -----------------------------------------------------------------------------
const USAR_BRUJULA_IOS = params.get("norte") !== "0"; // ?norte=0 desactiva D18 (diagnóstico)
// iOS (Safari, Chrome iOS y demás navegadores WebKit): permiso de orientación explícito
const ES_IOS = !!(window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === "function");
diag.orientAR = { reconectado: false, alimentado: 0, ultimoRespaldo: 0 };
diag.norteIOS = { estado: "sin datos de brújula", offset: null, precision: null };

// Control de orientación de AR.js (THREEx.DeviceOrientationControls de gps-new-camera)
function controlAR() {
  const c = camEl.components["arjs-device-orientation-controls"];
  return c ? c._orientationControls : null;
}
function controlRecibeDatos(ctrl) {
  return !!(ctrl && ctrl.deviceOrientation && ctrl.deviceOrientation.type && ctrl.deviceOrientation.alpha !== null);
}

// D17: AR.js llama a requestPermission() al cargar, SIN gesto; iOS lo rechaza y
// AR.js nunca registra sus listeners (en Safari y en Chrome iOS, ambos WebKit).
// Cuando el permiso ya está concedido (llegan datos), se reintenta connect() una vez.
// Respaldo: si el control sigue sin datos, se le entrega el MISMO evento que
// espera (sólo si coincide el tipo), igual que haría su propio listener.
function asegurarOrientacionAR(e) {
  const ctrl = controlAR();
  if (!ctrl) return;
  if (!diag.orientAR.reconectado) {
    diag.orientAR.reconectado = true;
    if (!controlRecibeDatos(ctrl)) {
      ctrl.connect();
      console.log("🧭 Orientación de AR.js reconectada tras el permiso");
    }
  }
  if (e.type !== ctrl.orientationChangeEventName) return;
  // Tras terminar el despacho del evento: si el listener propio de AR.js no lo recibió, entregárselo.
  setTimeout(() => {
    if (ctrl.deviceOrientation !== e) {
      ctrl.deviceOrientation = e;
      diag.orientAR.alimentado++;
      diag.orientAR.ultimoRespaldo = Date.now();
    }
  }, 0);
}

// D18: en iOS, alpha de 'deviceorientation' es RELATIVO y gps-new-camera no usa
// webkitCompassHeading. Con el teléfono en vertical (beta 60–120°) el rumbo de la
// cámara es −(alpha + offset) ⇒ offset = −brújula − alpha (media circular).
function corregirNorteIOS(e) {
  const n = diag.norteIOS;
  if (typeof e.webkitCompassHeading !== "number") { n.estado = "brújula iOS no disponible (norte relativo, sin corregir)"; return; }
  n.precision = e.webkitCompassAccuracy;
  if (!USAR_BRUJULA_IOS) { n.estado = "desactivada (norte=0)"; return; }
  if (!(e.webkitCompassAccuracy >= 0 && e.webkitCompassAccuracy < 50)) {
    n.estado = "precisión de brújula insuficiente (" + e.webkitCompassAccuracy + "): calibrar con un «8»"; return;
  }
  if (e.alpha === null || !(e.beta > 60 && e.beta < 120)) {
    if (n.offset === null) n.estado = "esperando teléfono en vertical";
    return;
  }
  const ctrl = controlAR();
  if (!ctrl) return;
  const objetivo = norm360(-e.webkitCompassHeading - e.alpha);
  n.offset = n.offset === null ? objetivo : norm360(n.offset + 0.2 * difAng(objetivo, n.offset));
  ctrl.alphaOffset = rad(n.offset);
  n.estado = "aplicada";
}

// Orientación del dispositivo (HUD + correcciones)
function leerOrientacion(nombre) {
  return (e) => {
    if (e.alpha === null && e.beta === null && e.gamma === null) return; // evento vacío (sin sensor)
    const o = diag.orient;
    o.evento = nombre;
    o.alpha = e.alpha; o.beta = e.beta; o.gamma = e.gamma;
    o.absoluto = e.absolute;
    o.brujulaIOS = typeof e.webkitCompassHeading === "number" ? e.webkitCompassHeading : null;
    o.n++;
    asegurarOrientacionAR(e);
  };
}
window.addEventListener("deviceorientationabsolute", leerOrientacion("deviceorientationabsolute"));
window.addEventListener("deviceorientation", (e) => {
  if (e.alpha === null && e.beta === null && e.gamma === null) return;
  corregirNorteIOS(e); // D18: sólo actúa si el evento trae webkitCompassHeading (iOS)
  if (diag.orient.evento !== "deviceorientationabsolute") leerOrientacion("deviceorientation")(e);
  else asegurarOrientacionAR(e);
});

// iOS: el permiso de orientación exige un toque explícito.
if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === "function") {
  const btn = document.createElement("button");
  btn.id = "btn-brujula";
  btn.textContent = "Activar brújula";
  btn.addEventListener("click", () => {
    DeviceOrientationEvent.requestPermission()
      .then((r) => { console.log("Permiso de orientación: " + r); if (r === "granted") btn.remove(); })
      .catch((err) => console.log("❌ Permiso de orientación: " + err));
  });
  document.body.appendChild(btn);
}

// -----------------------------------------------------------------------------
// 🔹 MODELO
// -----------------------------------------------------------------------------
function crearModeloInteractivo(anchor) {
  // Pivote de interacción, hijo del ancla: recibe rotación y escala de los gestos.
  const pivot = document.createElement("a-entity");
  pivot.setAttribute("position", { x: 0, y: ALTURA, z: 0 }); // centro del modelo ALTURA m sobre la coordenada
  pivot.setAttribute("scale", "300 300 300");

  const model = document.createElement("a-entity");
  model.setAttribute("gltf-model", "./models/goku.glb");
  model.addEventListener("model-loaded", () => centrarModeloEnAncla(pivot, model));
  pivot.appendChild(model);
  anchor.appendChild(pivot);

  modelClone = pivot;
  currentModel = pivot;           // 👈 clave: los gestos actúan sobre este
  diag.modelo = "cargando";
  console.log("✅ Modelo 3D interactivo creado");
}

// D15: lleva el centro visual del GLB al ORIGEN del pivote, es decir, sobre la
// coordenada. El centro se estima con las posiciones mundiales de los huesos
// (Box3.setFromObject con esqueleto da una caja errónea en three r164).
// El centro (mundo) se convierte a coordenadas LOCALES del padre del mesh.
function centrarModeloEnAncla(pivot, model) {
  const mesh = model.getObject3D("mesh");
  if (!mesh) return;
  pivot.object3D.updateWorldMatrix(true, true);
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  mesh.traverse((o) => {
    if (o.isBone) box.expandByPoint(o.getWorldPosition(v));
    if (o.isSkinnedMesh) o.frustumCulled = false; // su esfera envolvente en r164 es errónea
  });
  if (box.isEmpty()) box.setFromObject(mesh);
  const centroMundo = box.getCenter(new THREE.Vector3());
  if (![centroMundo.x, centroMundo.y, centroMundo.z].every(Number.isFinite)) return;
  const centroLocalModelo = model.object3D.worldToLocal(centroMundo.clone());
  mesh.position.sub(centroLocalModelo);
  diag.modelo = "centrado sobre el ancla";
  console.log("Modelo centrado sobre el ancla");
}

// -----------------------------------------------------------------------------
// 🔹 HUD DE DIAGNÓSTICO
// -----------------------------------------------------------------------------
const hud = document.getElementById("hud");
const _vc = new THREE.Vector3();
const _va = new THREE.Vector3();
const _qc = new THREE.Quaternion();
const _f = new THREE.Vector3();

function rumboInicial(lat1, lon1, lat2, lon2) {
  const φ1 = rad(lat1), φ2 = rad(lat2), Δλ = rad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return norm360(deg(Math.atan2(y, x)));
}
const difAng = (a, b) => ((a - b + 540) % 360) - 180; // [-180, 180)
const span = (cls, t) => '<span class="' + cls + '">' + t + "</span>";
const f = (n, d = 1) => (n === null || n === undefined || !Number.isFinite(n) ? "--" : n.toFixed(d));

// Coherencia interna: compara la geometría de la ESCENA (ancla − cámara) con la
// esperada por GPS (Haversine + rumbo geodésico), calculada de forma independiente.
// Si coincide, la implementación es correcta y cualquier desvío físico observado
// proviene del GPS o de la brújula.
function coherencia() {
  if (!diag.ancladoEn || !diag.ultimoAceptado) return null;
  camEl.object3D.getWorldPosition(_vc);
  anchor.object3D.getWorldPosition(_va);
  const dx = _va.x - _vc.x, dz = _va.z - _vc.z;
  const distEscena = Math.hypot(dx, dz);
  const rumboEscena = norm360(deg(Math.atan2(dx, -dz)));
  const u = diag.ultimoAceptado;
  const factor = USE_MERCATOR ? 1 / Math.cos(rad((u.lat + target.lat) / 2)) : 1;
  const distEsperada = calcularDistancia(u.lat, u.lon, target.lat, target.lon) * factor;
  const rumboEsperado = rumboInicial(u.lat, u.lon, target.lat, target.lon);
  const dDist = distEscena - distEsperada;
  const dRumbo = distEsperada > 1 ? difAng(rumboEscena, rumboEsperado) : 0;
  const ok = Math.abs(dDist) < Math.max(0.5, 0.005 * distEsperada) && Math.abs(dRumbo) < 2;
  return { distEscena, distEsperada, rumboEscena, rumboEsperado, dDist, dRumbo, ok };
}

function rumboCamara() {
  camEl.object3D.getWorldQuaternion(_qc);
  _f.set(0, 0, -1).applyQuaternion(_qc);
  if (Math.hypot(_f.x, _f.z) < 0.2) return null; // mirando casi vertical
  return norm360(deg(Math.atan2(_f.x, -_f.z)));
}

function actualizarHUD() {
  const L = [];
  L.push("PoC geo 2 · proyección: " + diag.proyeccion);
  if (erroresParam.length) L.push(span("bad", "❌ URL: " + erroresParam.join(", ")));
  L.push("Objetivo " + (targetDesdeUrl ? "(URL)" : "(por defecto)") + ": " + target.lat.toFixed(6) + ", " + target.lon.toFixed(6));

  const c = diag.ultimoCrudo;
  if (c) {
    const cls = c.acc <= 10 ? "ok" : c.acc <= MIN_ACC ? "warn" : "bad";
    const edad = (Date.now() - c.t) / 1000;
    L.push("GPS: " + span(cls, "±" + f(c.acc, 0) + " m") + " · edad " + f(edad, 0) + " s · fixes " + diag.fixesCrudos +
      " (aceptados " + diag.fixesAceptados + ", descartados " + diag.fixesDescartados + ", mín ±" + MIN_ACC + " m)");
    const d = calcularDistancia(c.lat, c.lon, target.lat, target.lon);
    L.push("Distancia real: " + f(d) + " m · rumbo al objetivo: " + f(rumboInicial(c.lat, c.lon, target.lat, target.lon), 0) + "°" +
      (diag.ultimoSaltoM !== null ? " · último salto GPS: " + f(diag.ultimoSaltoM) + " m" : ""));
  } else {
    L.push(span("warn", "GPS: esperando primer fix…"));
  }

  const o = diag.orient;
  if (o.n > 0) {
    L.push("Orientación: " + o.evento + (o.absoluto ? " (absoluta)" : span("warn", " (relativa)")) +
      " · α " + f(o.alpha, 0) + " β " + f(o.beta, 0) + " γ " + f(o.gamma, 0) +
      (o.brujulaIOS !== null ? " · brújula iOS " + f(o.brujulaIOS, 0) + "°" : ""));
  } else {
    L.push(span("warn", "Orientación: sin datos del sensor"));
  }
  const ctrl = controlAR();
  L.push("Control AR.js: " + (controlRecibeDatos(ctrl) ? span("ok", "recibe datos") : span("bad", "SIN DATOS (cámara sin orientar)")) +
    (Date.now() - (diag.orientAR.ultimoRespaldo || 0) < 1500 ? span("warn", " · vía respaldo") : ""));
  if (ES_IOS || o.evento === "deviceorientation" || diag.norteIOS.offset !== null) {
    const n = diag.norteIOS;
    const off = n.offset === null ? null : (n.offset > 180 ? n.offset - 360 : n.offset);
    L.push("Norte iOS: " + (n.estado === "aplicada" ? span("ok", "corregido") : span("warn", n.estado)) +
      (off !== null ? " · corrección " + f(off, 0) + "°" : "") +
      (n.precision !== null && n.precision !== undefined ? " · precisión brújula " + f(n.precision, 0) + "°" : ""));
  }

  const rc = rumboCamara();
  const co = coherencia();
  if (co) {
    let guia = "";
    if (rc !== null) {
      const giro = difAng(co.rumboEscena, rc);
      guia = Math.abs(giro) < 10 ? span("ok", " · ✅ el cubo está al frente") :
        " · gira " + f(Math.abs(giro), 0) + "° a la " + (giro > 0 ? "derecha ➡" : "izquierda ⬅");
    }
    L.push("Cámara apunta a " + f(rc, 0) + "° · cubo (escena) a " + f(co.rumboEscena, 0) + "°" + guia);
    L.push("Coherencia interna: " +
      (co.ok ? span("ok", "OK") : span("bad", "ERROR DE IMPLEMENTACIÓN")) +
      " · Δdist " + f(co.dDist, 2) + " m · Δrumbo " + f(co.dRumbo, 1) + "° (escena " + f(co.distEscena) + " m / GPS " + f(co.distEsperada) + " m)");
  } else {
    L.push(span("warn", "Ancla: " + (diag.ancladoEn ? "geolocalizada, esperando fix" : "esperando primer fix aceptado")));
  }
  L.push("Modelo: " + diag.modelo + (currentModel ? " · escala " + f(currentModel.object3D.scale.x, 0) : "") +
    " · perímetro: " + (radio === 0 ? "sin límite" : radio + " m"));
  hud.innerHTML = L.join("\n");
}
setInterval(actualizarHUD, 250);
actualizarHUD();

// Distancia Haversine
function calcularDistancia(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
