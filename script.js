// === CONTROL DE GESTOS (rotación + zoom) ===
AFRAME.registerComponent("gesture-controls", {
  schema: { rotFactor: { default: 0.35 }, minScale: { default: 50 }, maxScale: { default: 1500 } },
  init: function () {
    this.model = this.el;
    this.startX = 0;
    this.startScale = this.model.object3D.scale.x;
    this.baseRot = this.model.object3D.rotation.y;
    this.pinchStart = 0;

    const dist = (a, b) => Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);

    window.addEventListener("touchstart", (e) => {
      if (e.touches.length === 1) {
        this.startX = e.touches[0].pageX;
        this.baseRot = this.model.object3D.rotation.y;
      } else if (e.touches.length === 2) {
        this.pinchStart = dist(e.touches[0], e.touches[1]);
        this.startScale = this.model.object3D.scale.x;
      }
    });

    window.addEventListener("touchmove", (e) => {
      if (e.touches.length === 1) {
        const dx = e.touches[0].pageX - this.startX;
        this.model.object3D.rotation.y = this.baseRot - dx * this.data.rotFactor * 0.01745; // grados→rad
      } else if (e.touches.length === 2) {
        const pinchNow = dist(e.touches[0], e.touches[1]);
        const factor = pinchNow / this.pinchStart;
        let newScale = this.startScale * factor;
        newScale = Math.min(this.data.maxScale, Math.max(this.data.minScale, newScale));
        this.model.object3D.scale.set(newScale, newScale, newScale);
      }
      e.preventDefault();
    }, { passive: false });
  }
});

// ----------------------------------------------------------------------------
// 📍 GEOPOSICIÓN + CLON DEL MODELO INTERACTIVO
// -----------------------------------------------------------------------------
if (!/Mobi|Android/i.test(navigator.userAgent)) {
  document.getElementById("desktop-warning").classList.remove("hidden");
}

const radio = 15; // metros
const target = { lat: -29.477051, lon: -66.889616 };
const anchor = document.getElementById("anchor");

let modelClone = null; // el modelo 3D interactivo

//-----------------------------------------------------------------------------

// ====== GESTOS EN CAPA SUPERIOR (rotar con 1 dedo, zoom con 2) ======
const gestureLayer = document.getElementById('gesture-layer');

let currentModel = null;        // referencia al clon activo (se setea al crear)
let startX = 0;
let baseRotY = 0;               // en radianes
let pinchStartDist = 0;
let baseScale = 300;            // tu escala inicial
const ROT_SENS = 0.005;         // sensibilidad rotación (sube/baja si quieres)
const SCALE_MIN = 50;
const SCALE_MAX = 1500;

function distTouches(t0, t1) {
  const dx = t0.pageX - t1.pageX;
  const dy = t0.pageY - t1.pageY;
  return Math.hypot(dx, dy);
}

gestureLayer.addEventListener('touchstart', (e) => {
  if (!currentModel) return;
  if (e.touches.length === 1) {
    startX = e.touches[0].pageX;
    baseRotY = currentModel.object3D.rotation.y;
  } else if (e.touches.length === 2) {
    pinchStartDist = distTouches(e.touches[0], e.touches[1]);
    baseScale = currentModel.object3D.scale.x;
  }
  e.preventDefault();
  e.stopPropagation();
}, { passive: false });

gestureLayer.addEventListener('touchmove', (e) => {
  if (!currentModel) return;
  if (e.touches.length === 1) {
    const dx = e.touches[0].pageX - startX;
    currentModel.object3D.rotation.y = baseRotY - dx * ROT_SENS; // rotar Y
  } else if (e.touches.length === 2) {
    const now = distTouches(e.touches[0], e.touches[1]);
    let s = baseScale * (now / pinchStartDist);
    s = Math.min(SCALE_MAX, Math.max(SCALE_MIN, s));
    currentModel.object3D.scale.set(s, s, s);
  }
  e.preventDefault();
  e.stopPropagation();
}, { passive: false });

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

    // Entró en el radio → clonar modelo
    if (distancia <= radio && !modelClone) {
      crearModeloInteractivo(anchor);
    }

    // Salió del radio → eliminar modelo
    if (distancia > radio && modelClone) {
      modelClone.parentNode.removeChild(modelClone);
      modelClone = null;
    }
  },
  (err) => console.error("Error de geolocalización:", err),
  { enableHighAccuracy: true }
);

// -----------------------------------------------------------------------------
// 🔹 FUNCIONES AUXILIARES
// -----------------------------------------------------------------------------
function crearModeloInteractivo(anchor) {
  const scene = document.querySelector("a-scene");

  // Crear el clon (modelo libre, no GPS)
  const model = document.createElement("a-entity");
  model.setAttribute("gltf-model", "./models/goku.glb");
  model.setAttribute("scale", "300 300 300");
  model.setAttribute("rotation", "0 0 0");
  scene.appendChild(model);

  // Posicionarlo donde está el anchor actualmente
  const anchorWorldPos = new THREE.Vector3();
  anchor.object3D.updateMatrixWorld(true);
  anchor.object3D.getWorldPosition(anchorWorldPos);

  model.object3D.position.copy(anchorWorldPos);
  model.object3D.position.y += 2; // 2 m sobre el suelo

  modelClone = model;
  currentModel = model;           // 👈 clave: los gestos actúan sobre este
  console.log("✅ Modelo 3D interactivo creado");
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







