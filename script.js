// ----------------------------------------------------------------------------
// 📍 GEOPOSICIÓN + MODELO INTERACTIVO
// -----------------------------------------------------------------------------
if (!/Mobi|Android/i.test(navigator.userAgent)) {
  document.getElementById("desktop-warning").classList.remove("hidden");
}

const radio = 15; // metros
const target = { lat: -29.477051, lon: -66.889616 };
const anchor = document.getElementById("anchor");

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

//-----------------------------------------------------------------------------
// Observa la ubicación
navigator.geolocation.watchPosition(
  (pos) => {
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;

    const distancia = calcularDistancia(lat, lon, target.lat, target.lon);
    console.log("Distancia actual: " + distancia.toFixed(2) + " m");

    const display = document.getElementById("distancia-display");
    if (display) display.innerText = "Distancia: " + distancia.toFixed(1) + " m";

    // Entró en el radio → crear modelo
    if (distancia <= radio && !modelClone) {
      crearModeloInteractivo(anchor);
    }

    // Salió del radio → eliminar modelo
    if (distancia > radio && modelClone) {
      modelClone.parentNode.removeChild(modelClone);
      modelClone = null;
      currentModel = null;
    }
  },
  (err) => console.error("Error de geolocalización:", err),
  { enableHighAccuracy: true }
);

// -----------------------------------------------------------------------------
// 🔹 FUNCIONES AUXILIARES
// -----------------------------------------------------------------------------
function crearModeloInteractivo(anchor) {
  // Pivote de interacción, hijo del ancla: recibe rotación y escala de los gestos.
  const pivot = document.createElement("a-entity");
  pivot.setAttribute("position", "0 2 0"); // 2 m sobre el ancla
  pivot.setAttribute("scale", "300 300 300");

  const model = document.createElement("a-entity");
  model.setAttribute("gltf-model", "./models/goku.glb");
  model.addEventListener("model-loaded", () => centrarModeloEnPivote(pivot, model));
  pivot.appendChild(model);
  anchor.appendChild(pivot);

  modelClone = pivot;
  currentModel = pivot;           // 👈 clave: los gestos actúan sobre este
  console.log("✅ Modelo 3D interactivo creado");
}

// Lleva el centro visual del GLB al origen del pivote (para que rote y escale
// sobre su centro) sin mover el modelo en pantalla.
// El centro se mide en coordenadas MUNDIALES y se convierte a las coordenadas
// LOCALES de cada padre antes de usarlo como desplazamiento.
function centrarModeloEnPivote(pivot, model) {
  const mesh = model.getObject3D("mesh");
  if (!mesh) return;
  pivot.object3D.updateWorldMatrix(true, true);
  const centroMundo = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
  if (![centroMundo.x, centroMundo.y, centroMundo.z].every(Number.isFinite)) return;

  // 1) Desplazar el mesh en el espacio local de su padre (la entidad del modelo).
  const centroLocalModelo = model.object3D.worldToLocal(centroMundo.clone());
  mesh.position.sub(centroLocalModelo);

  // 2) Mover el pivote al antiguo centro, expresado en el espacio local del ancla.
  const centroLocalAncla = pivot.object3D.parent.worldToLocal(centroMundo.clone());
  pivot.setAttribute("position", {
    x: centroLocalAncla.x,
    y: centroLocalAncla.y,
    z: centroLocalAncla.z,
  });
  console.log("Modelo centrado en su pivote");
}


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
