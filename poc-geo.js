// =============================================================================
// RealityTour – PoC geo 3 (AR.js 3.4.8 + A-Frame 1.6.0)
// Orientación iOS: D17, D18 + M1 (rumbo con α, β, γ) y M2 (filtro lento del norte, opcional).
// GPS: M3 (Kalman experimental, opcional). Diagnóstico: M5 (registro) y M6 (aislamiento).
// Basada en script.js v78. El bloque de GESTOS es una copia textual de v78.
// Parámetros URL: lat, lon, radio (m, 0 = sin perímetro), h (m), acc (m), proj=mercator,
//   modo=geo2, norte=0, tauNorte (s), filtro=kalman, q (m²/s), gps=fijo, suave (0–1), diag=0
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
const difAng = (a, b) => ((a - b + 540) % 360) - 180; // [-180, 180)

// ---------------------------------------------------------------- PoC geo 3: modos
// modo=geo2 reproduce la PoC geo 2 (fórmula de norte sólo con α, filtro rápido,
// GPS de AR.js con gpsMinDistance 5, suave 0.1). El registro diagnóstico es pasivo.
const MODO_GEO2 = params.get("modo") === "geo2";
const FORMULA_COMPLETA = !MODO_GEO2;                                   // M1
const TAU_NORTE = MODO_GEO2 ? 0 : numParam("tauNorte", 0);             // M2 (s); 0 = filtro rápido (geo 2)
const FILTRO_KALMAN = !MODO_GEO2 && params.get("filtro") === "kalman"; // M3 (experimental)
const KALMAN_Q = numParam("q", 1);                                     // M3: ruido de proceso (m²/s)
const GPS_FIJO = !MODO_GEO2 && params.get("gps") === "fijo";           // M6
const SUAVE = MODO_GEO2 ? 0.1 : numParam("suave", 0.1);                // M6: smoothingFactor de AR.js
const DIAG_ON = params.get("diag") !== "0";                            // M5
const VERSION = "PoC geo 3" + (MODO_GEO2 ? " (modo geo2)" : "");
if (!(TAU_NORTE >= 0)) erroresParam.push("tauNorte inválido");
if (!(KALMAN_Q > 0)) erroresParam.push("q inválido");
if (!(SUAVE > 0 && SUAVE <= 1)) erroresParam.push("suave inválido (0–1)");
document.getElementById("version-label").textContent = VERSION + " (base v78)";

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
  version: VERSION,
  proyeccion: "pendiente",
  fixesCrudos: 0,
  fixesDescartados: 0,
  ultimoCrudo: null,          // {lat, lon, acc, t}
  fixesAceptados: 0,
  ultimoAceptado: null,       // {lat, lon} posición que usa la cámara
  ultimoSaltoM: null,
  ancladoEn: null,
  gpsCongelado: false,
  kalman: null,               // {saltoM, P, atipicos, rechazados}
  orient: { evento: "sin datos", alpha: null, beta: null, gamma: null, absoluto: null, brujulaIOS: null, n: 0, rumboSensor: null },
  modelo: "no creado",
  eventos: [],                // marcas del registro diagnóstico
};
window.__poc = { diag, target, get currentModel() { return currentModel; } };

function marcarEvento(tipo, texto) {
  diag.eventos.push({ t: Date.now(), tipo, texto });
  if (diag.eventos.length > 200) diag.eventos.shift();
  console.log(texto);
}

// D13 + proyección: configurar gps-new-camera en cuanto se inicializa (antes del primer fix).
// M3 (filtro=kalman): AR.js ignora los fixes reales (precisión mínima ~0) y la PoC le
// entrega la posición filtrada. gps=fijo: tras el primer fix AR.js deja de aceptar fixes.
function configurarCamara() {
  const comp = camEl.components["gps-new-camera"];
  if (!comp || !comp.threeLoc) return false;
  if (USE_MERCATOR) {
    diag.proyeccion = "Spherical Mercator (AR.js)";
  } else {
    comp.threeLoc.setProjection(proyeccionLocal);
    diag.proyeccion = "local en metros";
  }
  const accAR = FILTRO_KALMAN ? 0.0001 : MIN_ACC;
  comp.threeLoc.setGpsOptions({ gpsMinAccuracy: accAR });
  camEl.setAttribute("gps-new-camera", { positionMinAccuracy: accAR, gpsMinDistance: FILTRO_KALMAN ? 0 : 5 });
  return true;
}
if (!configurarCamara()) {
  camEl.addEventListener("componentinitialized", (e) => {
    if (e.detail.name === "gps-new-camera") configurarCamara();
  });
}
function congelarGpsAR() {
  camEl.setAttribute("gps-new-camera", "positionMinAccuracy", 0.0001);
  diag.gpsCongelado = true;
  marcarEvento("gps", "🧊 GPS congelado (gps=fijo): la cámara ya no cambiará de posición");
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
    if (GPS_FIJO) congelarGpsAR();
  }
  actualizarPerimetro();
});

// ---------------------------------------------------------------- M3: filtro GPS (experimental)
// Kalman 2D de posición constante en metros (proyección local), ponderado por la
// precisión de cada fix. Rechaza un fix atípico aislado; si se repiten (el usuario
// camina), re-sincroniza. La cámara se desplaza suavemente hacia la estimación.
const kf = { x: null, y: null, P: 0, t: 0, atipicos: 0, rechazados: 0 };
let camObjetivo = null; // {x, z} posición de escena hacia la que se interpola la cámara
function kalmanPaso(lat, lon, acc, t) {
  const [x, y] = proyeccionLocal.project(lon, lat);
  const Rm = Math.max(acc, 1) ** 2;
  if (kf.x === null) { kf.x = x; kf.y = y; kf.P = Rm; kf.t = t; return true; }
  const dt = Math.max(0, (t - kf.t) / 1000);
  kf.t = t;
  kf.P += KALMAN_Q * dt;
  const ix = x - kf.x, iy = y - kf.y;
  const nis = (ix * ix + iy * iy) / (kf.P + Rm); // ~χ² con 2 g.l.
  if (nis > 13.8) {
    kf.atipicos++;
    if (kf.atipicos < 2) { kf.rechazados++; return false; } // fix aislado atípico: se descarta
    kf.P = Math.max(kf.P, Rm);                              // atípicos seguidos: re-sincronizar
  } else {
    kf.atipicos = 0;
  }
  const K = kf.P / (kf.P + Rm);
  kf.x += K * ix; kf.y += K * iy; kf.P *= 1 - K;
  return true;
}
let ultimoFixKalman = null;
function aplicarKalman(lat, lon, acc) {
  ultimoFixKalman = { lat, lon, acc, t: Date.now() };
  const comp = camEl.components["gps-new-camera"];
  if (!comp || !comp.threeLoc) return;
  if (GPS_FIJO && diag.gpsCongelado) return;
  const antes = kf.x === null ? null : { x: kf.x, y: kf.y };
  if (!kalmanPaso(lat, lon, acc, Date.now())) return;
  const [lonE, latE] = proyeccionLocal.unproject([kf.x, kf.y]);
  if (!diag.ancladoEn) {
    // Primer fix filtrado: AR.js fija el origen del mundo y coloca la cámara.
    comp.threeLoc.fakeGps(lonE, latE, null, 0);
    camObjetivo = { x: camEl.object3D.position.x, z: camEl.object3D.position.z };
    return;
  }
  const w = comp.threeLoc.lonLatToWorldCoords(lonE, latE);
  camObjetivo = { x: w[0], z: w[1] };
  diag.ultimoAceptado = { lat: latE, lon: lonE };
  const salto = antes ? Math.hypot(kf.x - antes.x, kf.y - antes.y) : 0;
  diag.kalman = { saltoM: salto, P: kf.P, rechazados: kf.rechazados };
  if (GPS_FIJO) congelarGpsAR();
}
// Si el navegador deja de entregar fixes (usuario quieto), se re-aplica el último
// para que la estimación converja a él en lugar de quedarse rezagada.
if (FILTRO_KALMAN) setInterval(() => {
  const u = ultimoFixKalman;
  if (u && Date.now() - u.t > 1500) aplicarKalman(u.lat, u.lon, u.acc);
}, 1000);
AFRAME.registerComponent("poc-suavizado-camara", {
  tick: function (t, dt) {
    if (!FILTRO_KALMAN || !camObjetivo || !dt) return;
    const p = this.el.object3D.position;
    const k = 1 - Math.exp(-dt / 700); // ≈ 0,7 s
    p.x += (camObjetivo.x - p.x) * k;
    p.z += (camObjetivo.z - p.z) * k;
  },
});
if (FILTRO_KALMAN) camEl.setAttribute("poc-suavizado-camara", "");

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
          console.log("⚠️ GPS: precisión ±" + c.accuracy.toFixed(0) + " m > " + MIN_ACC + " m (fix descartado)");
        }
      } else if (FILTRO_KALMAN) {
        aplicarKalman(c.latitude, c.longitude, c.accuracy);
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
// 🔹 ORIENTACIÓN: correcciones D17, D18 (+M1, M2) para iOS (Safari y Chrome iOS)
// -----------------------------------------------------------------------------
const USAR_BRUJULA_IOS = params.get("norte") !== "0"; // ?norte=0 desactiva D18 (diagnóstico)
// iOS (Safari, Chrome iOS y demás navegadores WebKit): permiso de orientación explícito
const ES_IOS = !!(window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === "function");
diag.orientAR = { reconectado: false, alimentado: 0, ultimoRespaldo: 0 };
diag.norteIOS = { estado: "sin datos de brújula", offset: null, precision: null, rechazos: 0, filtro: "" };

// Control de orientación de AR.js (THREEx.DeviceOrientationControls de gps-new-camera)
function controlAR() {
  const c = camEl.components["arjs-device-orientation-controls"];
  return c ? c._orientationControls : null;
}
function controlRecibeDatos(ctrl) {
  return !!(ctrl && ctrl.deviceOrientation && ctrl.deviceOrientation.type && ctrl.deviceOrientation.alpha !== null);
}
function aplicarSuave() {
  if (camEl.components["arjs-device-orientation-controls"]) {
    camEl.setAttribute("arjs-device-orientation-controls", "smoothingFactor", SUAVE);
  }
}
if (sceneEl.hasLoaded) aplicarSuave(); else sceneEl.addEventListener("loaded", aplicarSuave, { once: true });

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
    aplicarSuave();
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

// M1: rumbo de la cámara (0° = norte, horario) que AR.js produce para (α, β, γ) SIN
// alphaOffset, con la MISMA convención que THREEx.DeviceOrientationControls:
// Euler(β, α, −γ, 'YXZ') · q(−90° en X) · q(−orientación de pantalla en Z).
const _eu = new THREE.Euler();
const _qs = new THREE.Quaternion();
const _qz = new THREE.Quaternion();
const _qx90 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
const _eje = new THREE.Vector3(0, 0, 1);
const _fw = new THREE.Vector3();
function rumboDesdeSensor(alpha, beta, gamma, orientPantalla) {
  _eu.set(rad(beta || 0), rad(alpha || 0), -rad(gamma || 0), "YXZ");
  _qs.setFromEuler(_eu).multiply(_qx90).multiply(_qz.setFromAxisAngle(_eje, -rad(orientPantalla || 0)));
  _fw.set(0, 0, -1).applyQuaternion(_qs);
  if (Math.hypot(_fw.x, _fw.z) < 0.5) return null; // apuntando al cielo o al suelo: sin rumbo fiable
  return norm360(deg(Math.atan2(_fw.x, -_fw.z)));
}

// D18 (+M1, M2): en iOS, alpha de 'deviceorientation' es RELATIVO y gps-new-camera no
// usa webkitCompassHeading. Sumar alphaOffset gira la cámara en torno a la vertical:
//   rumbo = rumboDesdeSensor(α, β, γ) − offset  ⇒  offset = rumboDesdeSensor − brújula.
// (modo=geo2: fórmula anterior offset = −brújula − α, que ignora γ: defecto D19.)
let normaInicio = null, ultimoT = null, ultimoRumbo0 = null, rechazoDesde = null;
function corregirNorteIOS(e) {
  const n = diag.norteIOS;
  if (typeof e.webkitCompassHeading !== "number") { n.estado = "brújula iOS no disponible (norte relativo, sin corregir)"; return; }
  n.precision = e.webkitCompassAccuracy;
  if (!USAR_BRUJULA_IOS) { n.estado = "desactivada (norte=0)"; return; }
  const precisionMax = TAU_NORTE > 0 ? 25 : 50;
  if (!(e.webkitCompassAccuracy >= 0 && e.webkitCompassAccuracy < precisionMax)) {
    n.estado = "precisión de brújula insuficiente (" + e.webkitCompassAccuracy + "): calibrar con un «8»"; return;
  }
  const ctrl = controlAR();
  if (!ctrl || e.alpha === null) return;
  let objetivo;
  if (FORMULA_COMPLETA) {
    const r0 = rumboDesdeSensor(e.alpha, e.beta, e.gamma, ctrl.screenOrientation);
    if (r0 === null) { if (n.offset === null) n.estado = "esperando teléfono apuntando al horizonte"; return; }
    objetivo = norm360(r0 - e.webkitCompassHeading);
  } else {
    if (!(e.beta > 60 && e.beta < 120)) { if (n.offset === null) n.estado = "esperando teléfono en vertical"; return; }
    objetivo = norm360(-e.webkitCompassHeading - e.alpha);
  }
  const t = e.timeStamp || performance.now();
  if (n.offset === null) {
    n.offset = objetivo; normaInicio = t;
  } else if (TAU_NORTE > 0) {
    // M2: filtro lento (complementario). El giroscopio manda a corto plazo; la brújula
    // corrige el desfase con constante τ. Convergencia rápida los primeros 2 s.
    const dt = Math.max(0, Math.min(1, (t - (ultimoT || t)) / 1000));
    const r0 = FORMULA_COMPLETA ? rumboDesdeSensor(e.alpha, e.beta, e.gamma, ctrl.screenOrientation) : null;
    const giroRapido = r0 !== null && ultimoRumbo0 !== null && dt > 0 && Math.abs(difAng(r0, ultimoRumbo0)) / dt > 90;
    ultimoRumbo0 = r0;
    const err = difAng(objetivo, n.offset);
    const convergiendo = t - normaInicio < 2000;
    if (!convergiendo && Math.abs(err) > 25) {
      n.rechazos++;
      if (rechazoDesde === null) rechazoDesde = t;
      if (t - rechazoDesde > 5000) { normaInicio = t; rechazoDesde = null; marcarEvento("brujula", "🧭 Brújula: desvío persistente > 25° durante 5 s → re-convergencia"); }
    } else if (!giroRapido) {
      rechazoDesde = null;
      const k = convergiendo ? 0.2 : 1 - Math.exp(-dt / TAU_NORTE);
      n.offset = norm360(n.offset + k * err);
    }
  } else {
    n.offset = norm360(n.offset + 0.2 * difAng(objetivo, n.offset)); // filtro rápido (geo 2)
  }
  ultimoT = t;
  ctrl.alphaOffset = rad(n.offset);
  n.filtro = TAU_NORTE > 0 ? "lento τ=" + TAU_NORTE + " s" : "rápido (geo 2)";
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
    const ctrl = controlAR();
    o.rumboSensor = rumboDesdeSensor(e.alpha, e.beta, e.gamma, ctrl ? ctrl.screenOrientation : 0);
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
const span = (cls, t) => '<span class="' + cls + '">' + t + "</span>";
const f = (n, d = 1) => (n === null || n === undefined || !Number.isFinite(n) ? "--" : n.toFixed(d));

// Coherencia interna: compara la geometría de la ESCENA (ancla − cámara) con la
// esperada por GPS (Haversine + rumbo geodésico), calculada de forma independiente.
// Si coincide, la implementación es correcta y cualquier desvío físico observado
// proviene del GPS o de la brújula. Con filtro=kalman se usa la posición objetivo
// de la cámara (la interpolación visual tarda ≈ 0,7 s en alcanzarla).
function coherencia() {
  if (!diag.ancladoEn || !diag.ultimoAceptado) return null;
  camEl.object3D.getWorldPosition(_vc);
  if (FILTRO_KALMAN && camObjetivo) { _vc.x = camObjetivo.x; _vc.z = camObjetivo.z; }
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

// -----------------------------------------------------------------------------
// 🔹 M5: REGISTRO DIAGNÓSTICO (10 Hz)
// Ángulo del modelo en pantalla = rumbo cámara→ancla (sólo POSICIÓN/GPS)
//                               − rumbo de la cámara (rumbo del sensor − corrección de norte)
// ⇒ Δmodelo = ΔGPS − Δgiro del teléfono + Δcorrección de brújula (+ residuo: suavizado/implementación)
// -----------------------------------------------------------------------------
const registro = [];          // filas de 10 Hz (últimos 180 s)
let muestraPrev = null;
let ultimoAvisoBrujula = 0;
let acumBrujula = [];         // [t, Δcorrección] del último segundo
function muestrear() {
  if (!diag.ancladoEn) return;
  const t = Date.now();
  camEl.object3D.getWorldPosition(_vc);
  anchor.object3D.getWorldPosition(_va);
  const rumboAncla = norm360(deg(Math.atan2(_va.x - _vc.x, -(_va.z - _vc.z))));
  const dist = Math.hypot(_va.x - _vc.x, _va.z - _vc.z);
  const rc = rumboCamara();
  const o = diag.orient, n = diag.norteIOS, c = diag.ultimoCrudo;
  const fila = {
    t, lat: c ? c.lat : null, lon: c ? c.lon : null, acc: c ? c.acc : null,
    camX: _vc.x, camZ: _vc.z, dist, rumboAncla, rumboCam: rc,
    angModelo: rc === null ? null : difAng(rumboAncla, rc),
    rumboSensor: o.rumboSensor, brujula: o.brujulaIOS, precBrujula: n.precision,
    alpha: o.alpha, beta: o.beta, gamma: o.gamma, correccion: n.offset,
    dGPS: 0, dGiro: 0, dBrujula: 0, residuo: 0,
  };
  if (muestraPrev) {
    const p = muestraPrev;
    fila.dGPS = difAng(rumboAncla, p.rumboAncla);
    if (fila.rumboSensor !== null && p.rumboSensor !== null) fila.dGiro = -difAng(fila.rumboSensor, p.rumboSensor);
    if (fila.correccion !== null && p.correccion !== null) fila.dBrujula = difAng(fila.correccion, p.correccion);
    if (fila.angModelo !== null && p.angModelo !== null) {
      fila.residuo = difAng(fila.angModelo, p.angModelo) - (fila.dGPS + fila.dGiro + fila.dBrujula);
    }
    const mov = Math.hypot(fila.camX - p.camX, fila.camZ - p.camZ);
    if (mov > 0.5 && !FILTRO_KALMAN) {
      marcarEvento("gps", "⚡ GPS: la cámara se movió " + mov.toFixed(1) + " m → modelo Δ " + fila.dGPS.toFixed(1) + "° (a " + dist.toFixed(1) + " m)");
    }
    acumBrujula.push([t, fila.dBrujula]);
    acumBrujula = acumBrujula.filter((x) => t - x[0] <= 1000);
    const dB = acumBrujula.reduce((s, x) => s + x[1], 0);
    if (Math.abs(dB) > 2 && t - ultimoAvisoBrujula > 1000) {
      ultimoAvisoBrujula = t;
      marcarEvento("brujula", "🧭 Brújula: la corrección de norte cambió " + dB.toFixed(1) + "° en 1 s → el modelo se movió " + dB.toFixed(1) + "° sin girar el teléfono");
    }
  }
  if (FILTRO_KALMAN && diag.kalman && diag.kalman.saltoM > 0.5 && !diag.kalman.marcado) {
    diag.kalman.marcado = true;
    marcarEvento("gps", "⚡ GPS (Kalman): estimación movida " + diag.kalman.saltoM.toFixed(1) + " m (transición suave ≈ 0,7 s)");
  }
  muestraPrev = fila;
  registro.push(fila);
  while (registro.length && t - registro[0].t > 180000) registro.shift();
}
if (DIAG_ON) setInterval(muestrear, 100);

function resumenVentana(ms) {
  const t = Date.now();
  const v = registro.filter((r) => t - r.t <= ms);
  const s = { gps: 0, giro: 0, brujula: 0, residuo: 0 };
  for (const r of v) { s.gps += r.dGPS; s.giro += r.dGiro; s.brujula += r.dBrujula; s.residuo += r.residuo; }
  s.total = s.gps + s.giro + s.brujula + s.residuo;
  return s;
}

const COLS = ["t", "lat", "lon", "acc", "camX", "camZ", "dist", "rumboAncla", "rumboCam", "angModelo", "rumboSensor", "brujula", "precBrujula", "alpha", "beta", "gamma", "correccion", "dGPS", "dGiro", "dBrujula", "residuo"];
function textoRegistro() {
  const t0 = registro.length ? registro[0].t : Date.now();
  const L = [];
  L.push("# RealityTour " + VERSION + " · registro diagnóstico");
  L.push("# fecha: " + new Date().toISOString() + " · UA: " + navigator.userAgent);
  L.push("# URL: " + location.href);
  L.push("# modo: fórmula norte " + (FORMULA_COMPLETA ? "completa (M1)" : "sólo α (geo2)") + " · filtro norte " + (TAU_NORTE > 0 ? "lento τ=" + TAU_NORTE + " s" : "rápido") +
    " · GPS " + (FILTRO_KALMAN ? "kalman q=" + KALMAN_Q : "AR.js (mín 5 m)") + (GPS_FIJO ? " · gps=fijo" : "") + " · norte=" + (USAR_BRUJULA_IOS ? "1" : "0") + " · suave=" + SUAVE);
  const co = coherencia();
  L.push("# coherencia: " + (co ? (co.ok ? "OK" : "ERROR") + " Δdist " + f(co.dDist, 2) + " m Δrumbo " + f(co.dRumbo, 1) + "°" : "--"));
  for (const [nom, ms] of [["últimos 10 s", 10000], ["últimos 60 s", 60000]]) {
    const s = resumenVentana(ms);
    L.push("# movimiento del modelo " + nom + ": total " + f(s.total) + "° = GPS " + f(s.gps) + "° + giro " + f(s.giro) + "° + brújula " + f(s.brujula) + "° + residuo " + f(s.residuo) + "°");
  }
  L.push("# eventos:");
  for (const e of diag.eventos.slice(-60)) L.push("# +" + ((e.t - t0) / 1000).toFixed(1) + " s " + e.texto);
  L.push(COLS.join(","));
  // CSV a 2 Hz (cada 5.ª muestra) para que el texto sea manejable
  registro.forEach((r, i) => {
    if (i % 5 !== 0) return;
    L.push(COLS.map((k) => (k === "t" ? ((r.t - t0) / 1000).toFixed(1) : (typeof r[k] === "number" ? +r[k].toFixed(k === "lat" || k === "lon" ? 7 : 2) : ""))).join(","));
  });
  return L.join("\n");
}
window.__poc.textoRegistro = textoRegistro;

if (DIAG_ON) {
  const b = document.createElement("button");
  b.id = "btn-registro";
  b.textContent = "📋 Copiar registro";
  b.style.cssText = "position:fixed;left:10px;bottom:calc(30vh + 10px);z-index:10002;padding:8px 12px;font-size:13px;border:none;border-radius:8px;background:#1565c0;color:#fff";
  b.addEventListener("click", () => {
    const txt = textoRegistro();
    const fallback = () => {
      const ta = document.createElement("textarea");
      ta.value = txt;
      ta.style.cssText = "position:fixed;inset:10% 5%;z-index:10010;font:10px monospace";
      const cerrar = document.createElement("button");
      cerrar.textContent = "Cerrar";
      cerrar.style.cssText = "position:fixed;top:4%;right:5%;z-index:10011;padding:8px 12px";
      cerrar.onclick = () => { ta.remove(); cerrar.remove(); };
      document.body.appendChild(ta); document.body.appendChild(cerrar);
      ta.focus(); ta.select();
      console.log("📋 Selecciona todo el texto y cópialo manualmente");
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(() => console.log("📋 Registro copiado (" + txt.length + " caracteres)"), fallback);
    } else fallback();
  });
  document.body.appendChild(b);
}

function actualizarHUD() {
  const L = [];
  L.push(VERSION + " · proyección: " + diag.proyeccion);
  if (erroresParam.length) L.push(span("bad", "❌ URL: " + erroresParam.join(", ")));
  L.push("Objetivo " + (targetDesdeUrl ? "(URL)" : "(por defecto)") + ": " + target.lat.toFixed(6) + ", " + target.lon.toFixed(6));
  L.push("Modo: norte " + (FORMULA_COMPLETA ? "α+β+γ (M1)" : "sólo α (geo2)") + " · filtro norte " + (TAU_NORTE > 0 ? "lento τ=" + TAU_NORTE + " s" : "rápido") +
    " · GPS " + (FILTRO_KALMAN ? "Kalman q=" + KALMAN_Q : "AR.js mín 5 m") + (GPS_FIJO ? span("warn", " · FIJO") : "") + " · suave " + SUAVE);

  const c = diag.ultimoCrudo;
  if (c) {
    const cls = c.acc <= 10 ? "ok" : c.acc <= MIN_ACC ? "warn" : "bad";
    const edad = (Date.now() - c.t) / 1000;
    L.push("GPS: " + span(cls, "±" + f(c.acc, 0) + " m") + " · edad " + f(edad, 0) + " s · fixes " + diag.fixesCrudos +
      " (aceptados " + diag.fixesAceptados + ", descartados " + diag.fixesDescartados + ", mín ±" + MIN_ACC + " m)" +
      (diag.gpsCongelado ? span("warn", " · CONGELADO") : "") +
      (FILTRO_KALMAN && diag.kalman ? " · Kalman σ " + f(Math.sqrt(diag.kalman.P), 1) + " m, atípicos " + diag.kalman.rechazados : ""));
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
    L.push("Norte iOS: " + (n.estado === "aplicada" ? span("ok", "corregido") + " · " + n.filtro : span("warn", n.estado)) +
      (off !== null ? " · corrección " + f(off, 0) + "°" : "") +
      (n.precision !== null && n.precision !== undefined ? " · precisión brújula " + f(n.precision, 0) + "°" : "") +
      (n.rechazos ? " · rechazos " + n.rechazos : ""));
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
  if (DIAG_ON && registro.length) {
    const s = resumenVentana(3000);
    L.push("Movimiento 3 s: GPS " + f(s.gps) + "° · giro " + f(s.giro) + "° · brújula " + f(s.brujula) + "° · residuo " + f(s.residuo) + "°");
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
