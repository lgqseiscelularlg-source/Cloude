// =============================================================================
// RealityTour – Diagnóstico del módulo RA geo (sólo se carga con ?diag=1)
// HUD, log en pantalla, cubos de referencia, coherencia interna, descomposición
// del movimiento (GPS / giro / brújula / residuo) y «Copiar registro».
// No modifica el comportamiento del módulo: sólo lee window.RAGeo.
// =============================================================================
(function () {
  const G = window.RAGeo;
  if (!G) return;
  const { lugares, estado, camEl, difAng, norm360, calcularDistancia } = G;
  const rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;
  const f = (n, d = 1) => (n === null || n === undefined || !Number.isFinite(n) ? "--" : n.toFixed(d));
  const span = (c, t) => '<span style="color:' + ({ ok: "#7CFC00", warn: "#FFD700", bad: "#FF6B6B" }[c]) + '">' + t + "</span>";

  // ---------------- HUD y log en pantalla (no capturan toques)
  const hud = document.createElement("div");
  hud.id = "hud";
  hud.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:10001;pointer-events:none;font:11px/1.35 ui-monospace,Menlo,monospace;color:#fff;background:rgba(0,0,0,.55);padding:6px 8px;white-space:pre-wrap";
  document.body.appendChild(hud);
  const logBox = document.createElement("div");
  logBox.id = "log-console";
  logBox.style.cssText = "position:fixed;bottom:0;left:0;width:100%;max-height:30vh;overflow-y:auto;background:rgba(0,0,0,.7);color:lime;font-size:12px;z-index:10000;pointer-events:none";
  document.body.appendChild(logBox);
  const oldLog = console.log;
  console.log = function (...a) {
    oldLog.apply(console, a);
    const d = document.createElement("div"); d.textContent = a.join(" "); logBox.appendChild(d);
    while (logBox.childNodes.length > 30) logBox.removeChild(logBox.firstChild);
    logBox.scrollTop = logBox.scrollHeight;
  };
  window.addEventListener("error", (e) => console.log("❌ ERROR JS: " + e.message));
  estado.eventos.forEach((e) => oldLog(e.texto));
  console.log("🔧 Diagnóstico activo (" + G.version + ")");

  // ---------------- Cubo rojo de 1 m sobre cada coordenada
  lugares.forEach((l) => {
    const c = document.createElement("a-box");
    c.setAttribute("color", "red");
    c.setAttribute("position", "0 0.5 0");
    c.classList.add("cubo-ref");
    l.ancla.appendChild(c);
  });

  // ---------------- Geometría de diagnóstico
  const _vc = new THREE.Vector3(), _va = new THREE.Vector3(), _q = new THREE.Quaternion(), _f = new THREE.Vector3();
  function rumboCamara() {
    camEl.object3D.getWorldQuaternion(_q);
    _f.set(0, 0, -1).applyQuaternion(_q);
    return Math.hypot(_f.x, _f.z) < 0.2 ? null : norm360(deg(Math.atan2(_f.x, -_f.z)));
  }
  function rumboGeo(lat1, lon1, lat2, lon2) {
    const φ1 = rad(lat1), φ2 = rad(lat2), Δλ = rad(lon2 - lon1);
    return norm360(deg(Math.atan2(Math.sin(Δλ) * Math.cos(φ2), Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ))));
  }
  // Coherencia: geometría de la escena (ancla − posición OBJETIVO de la cámara) frente
  // a la que predice el GPS (Haversine + rumbo geodésico, calculados aparte).
  function coherencia(l) {
    const o = estado.objetivoCamara, u = estado.ultimoFix;
    if (!o || !u || !l.ancla.hasAttribute("gps-new-entity-place")) return null;
    l.ancla.object3D.getWorldPosition(_va);
    const dx = _va.x - o.x, dz = _va.z - o.z;
    const dEsc = Math.hypot(dx, dz), rEsc = norm360(deg(Math.atan2(dx, -dz)));
    const dGps = calcularDistancia(u.lat, u.lon, l.lat, l.lon), rGps = rumboGeo(u.lat, u.lon, l.lat, l.lon);
    const dD = dEsc - dGps, dR = dGps > 1 ? difAng(rEsc, rGps) : 0;
    return { dEsc, rEsc, dD, dR, ok: Math.abs(dD) < Math.max(0.5, 0.005 * dGps) && Math.abs(dR) < 2 };
  }
  const activo = () => lugares.find((l) => l.pivote && l.pivote === G.modeloActivo) || lugares[0];

  // ---------------- Registro a 10 Hz: Δmodelo = ΔGPS + Δgiro + Δbrújula + residuo
  const registro = [];
  let prev = null;
  setInterval(() => {
    const l = activo();
    if (!estado.origenFijado || !l.ancla.hasAttribute("gps-new-entity-place")) return;
    const t = Date.now();
    camEl.object3D.getWorldPosition(_vc);
    l.ancla.object3D.getWorldPosition(_va);
    const rAncla = norm360(deg(Math.atan2(_va.x - _vc.x, -(_va.z - _vc.z))));
    const rc = rumboCamara(), o = estado.orient, c = estado.ultimoCrudo;
    const r = {
      t, lugar: l.id, lat: c ? c.lat : null, lon: c ? c.lon : null, acc: c ? c.acc : null,
      camX: _vc.x, camZ: _vc.z, dist: Math.hypot(_va.x - _vc.x, _va.z - _vc.z), rumboAncla: rAncla, rumboCam: rc,
      angModelo: rc === null ? null : difAng(rAncla, rc), rumboSensor: o.rumboSensor, brujula: o.brujula,
      alpha: o.alpha, beta: o.beta, gamma: o.gamma, correccion: estado.norte.offset, dGPS: 0, dGiro: 0, dBrujula: 0, residuo: 0,
    };
    if (prev && prev.lugar === r.lugar) {
      r.dGPS = difAng(r.rumboAncla, prev.rumboAncla);
      if (r.rumboSensor !== null && prev.rumboSensor !== null) r.dGiro = -difAng(r.rumboSensor, prev.rumboSensor);
      if (r.correccion !== null && prev.correccion !== null) r.dBrujula = difAng(r.correccion, prev.correccion);
      if (r.angModelo !== null && prev.angModelo !== null) r.residuo = difAng(r.angModelo, prev.angModelo) - (r.dGPS + r.dGiro + r.dBrujula);
    }
    prev = r;
    registro.push(r);
    while (registro.length && t - registro[0].t > 180000) registro.shift();
  }, 100);
  function ventana(ms) {
    const t = Date.now(), s = { gps: 0, giro: 0, brujula: 0, residuo: 0 };
    registro.filter((r) => t - r.t <= ms).forEach((r) => { s.gps += r.dGPS; s.giro += r.dGiro; s.brujula += r.dBrujula; s.residuo += r.residuo; });
    s.total = s.gps + s.giro + s.brujula + s.residuo;
    return s;
  }

  // ---------------- Copiar registro
  const COLS = ["t", "lugar", "lat", "lon", "acc", "camX", "camZ", "dist", "rumboAncla", "rumboCam", "angModelo", "rumboSensor", "brujula", "alpha", "beta", "gamma", "correccion", "dGPS", "dGiro", "dBrujula", "residuo"];
  function textoRegistro() {
    const t0 = registro.length ? registro[0].t : Date.now(), L = [];
    L.push("# RealityTour " + G.version + " · registro diagnóstico · " + new Date().toISOString());
    L.push("# UA: " + navigator.userAgent);
    L.push("# URL: " + location.href);
    L.push("# fixes aceptados " + estado.fixesAceptados + " · saltos retenidos " + estado.saltosRetenidos + " · respaldo orientación " + estado.respaldoOrientacion);
    lugares.forEach((l) => { const co = coherencia(l); L.push("# " + l.id + ": " + l.estado + " · coherencia " + (co ? (co.ok ? "OK" : "ERROR") + " Δdist " + f(co.dD, 2) + " m Δrumbo " + f(co.dR, 1) + "°" : "--")); });
    for (const [n, ms] of [["10 s", 1e4], ["60 s", 6e4]]) {
      const s = ventana(ms);
      L.push("# movimiento últimos " + n + ": total " + f(s.total) + "° = GPS " + f(s.gps) + "° + giro " + f(s.giro) + "° + brújula " + f(s.brujula) + "° + residuo " + f(s.residuo) + "°");
    }
    L.push("# eventos:");
    estado.eventos.slice(-60).forEach((e) => L.push("# +" + ((e.t - t0) / 1000).toFixed(1) + " s " + e.texto));
    L.push(COLS.join(","));
    registro.forEach((r, i) => {
      if (i % 5) return;
      L.push(COLS.map((k) => k === "t" ? ((r.t - t0) / 1000).toFixed(1) : k === "lugar" ? r.lugar :
        (typeof r[k] === "number" ? +r[k].toFixed(k === "lat" || k === "lon" ? 7 : 2) : "")).join(","));
    });
    return L.join("\n");
  }
  G.textoRegistro = textoRegistro;
  const b = document.createElement("button");
  b.id = "btn-registro";
  b.textContent = "📋 Copiar registro";
  b.style.cssText = "position:fixed;left:10px;bottom:calc(30vh + 10px);z-index:10002;padding:8px 12px;font-size:13px;border:none;border-radius:8px;background:#1565c0;color:#fff";
  b.addEventListener("click", () => {
    const txt = textoRegistro();
    const manual = () => {
      const ta = document.createElement("textarea"), x = document.createElement("button");
      ta.value = txt; ta.style.cssText = "position:fixed;inset:10% 5%;z-index:10010;font:10px monospace";
      x.textContent = "Cerrar"; x.style.cssText = "position:fixed;top:4%;right:5%;z-index:10011;padding:8px 12px";
      x.onclick = () => { ta.remove(); x.remove(); };
      document.body.appendChild(ta); document.body.appendChild(x); ta.focus(); ta.select();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(() => console.log("📋 Registro copiado (" + txt.length + " caracteres)"), manual);
    else manual();
  });
  document.body.appendChild(b);

  // ---------------- HUD
  setInterval(() => {
    const L = [G.version + " · diagnóstico"];
    const c = estado.ultimoCrudo;
    L.push(c ? "GPS: " + span(c.acc <= 10 ? "ok" : c.acc <= G.AJUSTES.precisionMin ? "warn" : "bad", "±" + f(c.acc, 0) + " m") +
      " · aceptados " + estado.fixesAceptados + " · último desliz " + f(estado.ultimoSaltoM) + " m · retenidos " + estado.saltosRetenidos : span("warn", "GPS: esperando primer fix…"));
    const o = estado.orient, n = estado.norte, ctrl = G.controlAR();
    const recibe = !!(ctrl && ctrl.deviceOrientation && ctrl.deviceOrientation.type && ctrl.deviceOrientation.alpha !== null);
    L.push("Orientación: " + (recibe ? span("ok", "AR.js recibe datos") : span("bad", "AR.js SIN DATOS")) +
      " · α " + f(o.alpha, 0) + " β " + f(o.beta, 0) + " γ " + f(o.gamma, 0) + " · norte iOS: " + n.estado +
      (n.offset !== null ? " (" + f(difAng(n.offset, 0), 0) + "°)" : ""));
    const rc = rumboCamara();
    lugares.forEach((l) => {
      const co = coherencia(l);
      if (!co) { L.push(l.id + ": " + l.estado); return; }
      const giro = rc === null ? null : difAng(co.rEsc, rc);
      L.push(l.id + (l.pivote === G.modeloActivo ? " ★" : "") + ": " + f(co.dEsc) + " m a " + f(co.rEsc, 0) + "° · " +
        (giro === null ? "" : Math.abs(giro) < 10 ? span("ok", "✅ al frente") : "gira " + f(Math.abs(giro), 0) + "° " + (giro > 0 ? "➡" : "⬅")) +
        " · coherencia " + (co.ok ? span("ok", "OK") : span("bad", "ERROR")));
    });
    if (registro.length) {
      const s = ventana(3000);
      L.push("Movimiento 3 s: GPS " + f(s.gps) + "° · giro " + f(s.giro) + "° · brújula " + f(s.brujula) + "° · residuo " + f(s.residuo) + "°");
    }
    hud.innerHTML = L.join("\n");
  }, 250);
})();
