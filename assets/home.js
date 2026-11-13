/* The page: a real-time 3D hero, and the route of light that follows the scroll. */
(function () {
  'use strict';
  var M = window.LegMath, CFG = window.SCENE;
  var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (id) { return document.getElementById(id); };
  var cv = $('scene'), stage = $('stage'), K = CFG.k;

  /* ---------------- shared state: the same three runs as the original figure ---------------- */
  var world = JSON.parse(JSON.stringify(M.DEFAULT)), sol = M.solve(world), N = sol.short.pts.length;
  var phase = still ? 3 : 0, phaseStart = 0, paused = still, inView = true, dragging = null, raf = 0, runOnce = false, cur = still ? 1 : 0, touched = false;
  var DUR = 3600, HOLD = 3200;

  function at(arr, u) {
    var f = Math.max(0, Math.min(1, u)) * (arr.length - 1), i = Math.max(0, Math.min(arr.length - 2, Math.floor(f))), t = f - i;
    return typeof arr[i] === 'number' ? arr[i] + (arr[i + 1] - arr[i]) * t
      : { x: arr[i].x + (arr[i + 1].x - arr[i].x) * t, y: arr[i].y + (arr[i + 1].y - arr[i].y) * t };
  }
  function state(u) {                       /* what is showing at this instant */
    var rest = phase === 3, name = phase === 0 ? 'short' : phase === 1 ? 'free' : 'safe', ent = sol.free.enters ? sol.free.entry / (N - 1) : 2;
    return {
      rest: rest, run: sol[name], ent: ent,
      entered: sol.free.enters && (phase > 1 || (phase === 1 && u >= ent)),
      rejected: sol.free.enters && phase >= 2,
      us: phase === 0 ? u : 1, uf: phase < 1 ? 0 : phase === 1 ? u : 1, ua: sol.safe.same || phase < 2 ? 0 : phase === 2 ? u : 1,
      where: rest ? sol.safe.pts[N - 1] : at(sol[name].pts, u)
    };
  }
  function pct(v) { return Math.round(v * 100) + '%'; }
  function when(p) { return p.sureBy === null ? 'only on arrival' : 'by ' + pct(p.sureBy); }
  function status(u) {
    if (phase === 0) return '1/3 Shortest safe path. Watcher sure ' + when(sol.short) + '.';
    if (phase === 1) {
      if (!sol.free.enters) return '2/3 Legible path. Sure ' + when(sol.free) + ', and clear of the zone.';
      return u < sol.free.entry / (N - 1) ? '2/3 Legible path. It commits to A early.' : '2/3 Legible path. Sure ' + when(sol.free) + ', but it enters the zone. Rejected.';
    }
    if (phase === 2) return sol.safe.fallback ? '3/3 No clear curve exists. The safe route is kept.' : '3/3 Recovered. Sure ' + when(sol.safe) + ', and clear of the zone.';
    if (dragging) return 'Replanning as you drag.';
    if (paused) return 'Paused. Drag anything in the scene, or press play.';
    return touched ? 'Replanned.' : 'Now drag the start, a goal or the zone.';
  }
  function hud(u, st) {
    var belief = st.rest ? 1 : at(st.run.belief, u);
    $('bar-a').style.width = (belief * 100).toFixed(1) + '%';
    $('pct-a').textContent = 'Goal A ' + Math.round(belief * 100) + '%'; $('pct-b').textContent = 'Goal B ' + Math.round((1 - belief) * 100) + '%';
    var text = status(u); if ($('status').textContent !== text) $('status').textContent = text;
  }

  /* ---------------- the real-time scene ---------------- */

  /* Real shadows from the key light, and dust drifting through its beam. Returns a per-frame step. */
  function realism(T, renderer, scene, key, floor, centre, quiet) {
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
    key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.0006; key.shadow.radius = 5; key.shadow.camera.near = 2; key.shadow.camera.far = 22;
    scene.traverse(function (o) { if (o.isMesh && o.material && o.material.isMeshStandardMaterial) { o.receiveShadow = true; if (o !== floor) o.castShadow = true; } });
    var N = 150, pos = new Float32Array(N * 3), seed = [], i;
    for (i = 0; i < N; i++) { pos[i * 3] = centre.x + (Math.random() - 0.5) * 7; pos[i * 3 + 1] = 0.1 + Math.random() * 2.6; pos[i * 3 + 2] = centre.z + (Math.random() - 0.5) * 5; seed.push(Math.random() * 6.28, 0.00012 + Math.random() * 0.0003); }
    var g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3));
    var c = document.createElement('canvas'); c.width = c.height = 32; var x = c.getContext('2d'), gr = x.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 32, 32);
    var dust = new T.Points(g, new T.PointsMaterial({ size: 0.03, map: new T.CanvasTexture(c), color: 0xcfd8ff, transparent: true, opacity: 0.5, depthWrite: false, blending: T.AdditiveBlending, sizeAttenuation: true }));
    dust.frustumCulled = false; scene.add(dust);
    var last = 0;
    return function (now) {
      if (quiet) return; var dt = Math.min(60, now - last); last = now;
      for (var i = 0; i < N; i++) { pos[i * 3 + 1] += seed[i * 2 + 1] * dt; pos[i * 3] += Math.sin(now / 2600 + seed[i * 2]) * 0.00006 * dt; if (pos[i * 3 + 1] > 2.8) pos[i * 3 + 1] = 0.1; }
      g.attributes.position.needsUpdate = true;
    };
  }
  function make3D() {
    var T = window.THREE, renderer;
    if (!T) return null;
    try { renderer = new T.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance' }); } catch (e) { return null; }
    if (!renderer.getContext()) return null;
    renderer.setClearColor(0x08090b, 1); renderer.outputEncoding = T.sRGBEncoding;
    var scene = new T.Scene(); scene.fog = new T.Fog(0x08090b, 9, 26);
    var cam = new T.PerspectiveCamera(40, 1, 0.1, 80), W = 1, H = 1, narrow = false;
    var CENTRE = new T.Vector3(260 * K, 0, 170 * K), home = new T.Vector3(), look = new T.Vector3(), mx = 0, my = 0, cx = 0, cy = 0;
    var PERI = 0x7b93ff, PT = 0xb7c4ff, ORG = 0xff8a3d, WH = 0xf4f3ef;

    /* small generated textures */
    function tex(w, h, paint, repeat) { var c = document.createElement('canvas'); c.width = w; c.height = h; paint(c.getContext('2d'), w, h); var t = new T.CanvasTexture(c); if (repeat) t.wrapS = t.wrapT = T.RepeatWrapping; t.encoding = T.sRGBEncoding; return t; }
    var tHalo = tex(4, 128, function (g, w, h) { var gr = g.createLinearGradient(0, 0, 0, h); for (var i = 0; i <= 16; i++) { var x = i / 16 * 2 - 1; gr.addColorStop(i / 16, 'rgba(255,255,255,' + Math.exp(-x * x * 7).toFixed(3) + ')'); } g.fillStyle = gr; g.fillRect(0, 0, w, h); });
    var tBlob = tex(128, 128, function (g, w) { var gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, w); });
    var tRing = tex(256, 256, function (g, w) { var gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.42, 'rgba(255,255,255,.05)'); gr.addColorStop(0.62, 'rgba(255,255,255,.75)'); gr.addColorStop(0.8, 'rgba(255,255,255,.08)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, w); });
    var tHatch = tex(64, 64, function (g, w) { g.strokeStyle = '#fff'; g.lineWidth = 5; for (var i = -w; i < w * 2; i += 32) { g.beginPath(); g.moveTo(i, w); g.lineTo(i + w, 0); g.stroke(); } }, true);
    var tFloor = tex(256, 256, function (g, w) { var d = g.createImageData(w, w); for (var i = 0; i < w * w; i++) { var v = 228 + Math.random() * 27; d.data[i * 4] = d.data[i * 4 + 1] = d.data[i * 4 + 2] = v; d.data[i * 4 + 3] = 255; } g.putImageData(d, 0, 0); }, true);
    tFloor.repeat.set(60, 60);

    /* the floor and its light */
    var floor = new T.Mesh(new T.PlaneGeometry(90, 90), new T.MeshStandardMaterial({ color: 0x121318, roughness: 0.7, metalness: 0.1, map: tFloor }));
    floor.rotation.x = -Math.PI / 2; scene.add(floor);
    scene.add(new T.HemisphereLight(0xc6ccdf, 0x050506, 0.25));
    var key = new T.SpotLight(0xfff1e0, 1.32, 30, 0.6, 1, 1.2); key.position.set(CENTRE.x + 0.6, 8.5, CENTRE.z + 1.2); key.target.position.copy(CENTRE); scene.add(key); scene.add(key.target);
    var rim = new T.DirectionalLight(0x8fa3ff, 0.55); rim.position.set(-4, 3, -6); scene.add(rim);

    function decal(map, color, opacity, additive) { return new T.MeshBasicMaterial({ map: map || null, color: color, transparent: true, opacity: opacity, depthWrite: false, blending: additive === false ? T.NormalBlending : T.AdditiveBlending, side: T.DoubleSide, fog: false }); }
    function flat(size, mat, y) { var m = new T.Mesh(new T.PlaneGeometry(size, size), mat); m.rotation.x = -Math.PI / 2; m.position.y = y; scene.add(m); return m; }

    /* ribbons of light on the floor */
    var SUB = 4;
    function dense(pts) { var out = []; for (var i = 0; i < pts.length - 1; i++) for (var j = 0; j < SUB; j++) out.push({ x: pts[i].x + (pts[i + 1].x - pts[i].x) * j / SUB, y: pts[i].y + (pts[i + 1].y - pts[i].y) * j / SUB }); out.push(pts[pts.length - 1]); return out; }
    function ribbon(pts, width, y, dash, closed) {
      var n = pts.length, L = [], R = [], pos = [], uv = [], h = width / 2, i;
      for (i = 0; i < n; i++) {
        var a = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)], dx = (b.x - a.x), dz = (b.y - a.y), l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l;
        L.push([pts[i].x * K + nx * h, pts[i].y * K + nz * h]); R.push([pts[i].x * K - nx * h, pts[i].y * K - nz * h]);
      }
      var segs = closed ? n : n - 1;
      for (i = 0; i < segs; i++) {
        var k = (i + 1) % n, on = !dash || (i % dash[1]) < dash[0];
        var q = on ? [L[i], R[i], L[k], R[i], R[k], L[k]] : [L[i], L[i], L[i], L[i], L[i], L[i]], vs = [0, 1, 0, 1, 1, 0];
        for (var j = 0; j < 6; j++) { pos.push(q[j][0], y, q[j][1]); uv.push(i / segs, vs[j]); }
      }
      var g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); return g;
    }
    function Line(coreMat, haloMat, w, hw, dash) {
      this.core = new T.Mesh(new T.BufferGeometry(), coreMat); this.core.frustumCulled = false; scene.add(this.core);
      this.halo = haloMat ? new T.Mesh(new T.BufferGeometry(), haloMat) : null; if (this.halo) { this.halo.frustumCulled = false; scene.add(this.halo); }
      this.w = w; this.hw = hw; this.dash = dash; this.n = 0;
    }
    Line.prototype.set = function (pts, y) {
      var d = dense(pts); this.n = d.length - 1;
      this.core.geometry.dispose(); this.core.geometry = ribbon(d, this.w, y, this.dash);
      if (this.halo) { this.halo.geometry.dispose(); this.halo.geometry = ribbon(d, this.hw, y - 0.002); }
    };
    Line.prototype.show = function (from, upto) {
      var a = Math.round(Math.max(0, Math.min(1, from)) * this.n), b = Math.round(Math.max(0, Math.min(1, upto)) * this.n), vis = b > a;
      this.core.visible = vis; this.core.geometry.setDrawRange(a * 6, (b - a) * 6);
      if (this.halo) { this.halo.visible = vis; this.halo.geometry.setDrawRange(a * 6, (b - a) * 6); }
    };
    var lShort = new Line(decal(null, WH, 0.8), null, 0.022, 0, [SUB * 1, SUB * 2]);
    var lFree = new Line(decal(null, PT, 1), decal(tHalo, PERI, 0.8), 0.04, 0.46);
    var lBad = new Line(decal(null, 0xffd0a8, 1), decal(tHalo, ORG, 0.5), 0.04, 0.42);
    var lRej = new Line(decal(null, ORG, 0.55), null, 0.026, 0, [SUB * 1, SUB * 2]);
    var lSafe = new Line(decal(null, PT, 1), decal(tHalo, PERI, 0.9), 0.042, 0.5);

    /* zone, start, goals */
    var zFill = new T.Mesh(new T.PlaneGeometry(1, 1), decal(tHatch.clone(), ORG, 0.7)); zFill.material.map.needsUpdate = true; zFill.rotation.x = -Math.PI / 2; zFill.position.y = 0.004; scene.add(zFill);
    var zWash = new T.Mesh(new T.PlaneGeometry(1, 1), decal(null, ORG, 0.05)); zWash.rotation.x = -Math.PI / 2; zWash.position.y = 0.003; scene.add(zWash);
    var zEdge = new Line(decal(null, 0xff9a50, 1), decal(tHalo, ORG, 0.55), 0.026, 0.26);
    var sEdge = new Line(decal(null, WH, 0.9), decal(tHalo, WH, 0.12), 0.02, 0.14);
    function loop(pts) { return pts.concat([pts[0], pts[1]]); }
    function goal(color, bright) {
      var g = new T.Group();
      var ring = new T.Mesh(new T.TorusGeometry(17 * K, bright ? 0.011 : 0.008, 10, 72), new T.MeshBasicMaterial({ color: bright ? PT : WH, transparent: true, opacity: bright ? 1 : 0.6, fog: false })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.012; g.add(ring);
      var gl = new T.Mesh(new T.PlaneGeometry(1.25, 1.25), decal(tRing, color, bright ? 0.85 : 0.1)); gl.rotation.x = -Math.PI / 2; gl.position.y = 0.006; g.add(gl);
      if (bright) { var dot = new T.Mesh(new T.CircleGeometry(5 * K, 32), decal(null, PT, 0.9)); dot.rotation.x = -Math.PI / 2; dot.position.y = 0.008; g.add(dot); }
      var post = new T.Mesh(new T.CylinderGeometry(0.008, 0.008, 0.95, 10), new T.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.5 })); post.position.set(22 * K, 0.475, -12 * K); g.add(post);
      var tip = new T.Mesh(new T.SphereGeometry(0.024, 16, 12), new T.MeshBasicMaterial({ color: bright ? PT : WH, fog: false })); tip.position.set(22 * K, 0.97, -12 * K); g.add(tip);
      scene.add(g); return g;
    }
    var gA = goal(PERI, true), gB = goal(WH, false);
    var marks = []; for (var mi = 0; mi < 4; mi++) { var mk = new T.Mesh(new T.TorusGeometry(1, 0.12, 8, 40), new T.MeshBasicMaterial({ color: WH, fog: false })); mk.rotation.x = Math.PI / 2; mk.position.y = 0.014; scene.add(mk); marks.push(mk); }
    function mark(i, w, r, color) { var m = marks[i]; m.visible = !!w; if (!w) return; m.position.x = w.x * K; m.position.z = w.y * K; m.scale.setScalar(r * K); m.material.color.setHex(color); }

    /* the robot: a real model that turns along its path */
    var bot = new T.Group(), dark = new T.MeshStandardMaterial({ color: 0x15161a, roughness: 0.45, metalness: 0.35 }), shell = new T.MeshStandardMaterial({ color: 0xb9bcc6, roughness: 0.35, metalness: 0.2 });
    function part(geo, mat, y) { var m = new T.Mesh(geo, mat); m.position.y = y; bot.add(m); return m; }
    part(new T.CylinderGeometry(0.19, 0.2, 0.06, 56), dark, 0.04);
    part(new T.CylinderGeometry(0.196, 0.196, 0.014, 56), new T.MeshBasicMaterial({ color: WH, fog: false }), 0.077);
    part(new T.CylinderGeometry(0.178, 0.19, 0.075, 56), shell, 0.122);
    part(new T.CylinderGeometry(0.15, 0.178, 0.016, 56), shell, 0.167);
    part(new T.CylinderGeometry(0.062, 0.066, 0.05, 32), dark, 0.2);
    part(new T.CylinderGeometry(0.064, 0.064, 0.008, 32), new T.MeshBasicMaterial({ color: PERI, fog: false }), 0.205);
    var eye = part(new T.BoxGeometry(0.02, 0.022, 0.13), new T.MeshBasicMaterial({ color: PT, fog: false }), 0.125); eye.position.x = 0.181;
    var nose = new T.Mesh(new T.PlaneGeometry(0.5, 0.34), decal(tBlob, PERI, 0.3)); nose.rotation.x = -Math.PI / 2; nose.position.set(0.36, 0.007, 0); bot.add(nose);
    scene.add(bot);
    var shadow = flat(0.95, decal(tBlob, 0x000000, 0.8, false), 0.0025), under = flat(0.9, decal(tBlob, WH, 0.07), 0.005);
    var heading = 0;

    /* labels sit in the page, pinned to points in the scene */
    var tags = {}; [['a', 'Goal A', 'p'], ['b', 'Goal B', ''], ['zone', 'Keep-out zone', 'o'], ['start', 'Start', '']].forEach(function (d) { var e = document.createElement('div'); e.className = 'tag3 mono ' + d[2]; e.textContent = d[1]; e.setAttribute('aria-hidden', 'true'); stage.appendChild(e); tags[d[0]] = e; });
    var v = new T.Vector3();
    function scr(w, h) { v.set(w.x * K, h || 0, w.y * K).project(cam); return [(v.x + 1) / 2 * W, (1 - v.y) / 2 * H]; }
    var ray = new T.Raycaster(), ground = new T.Plane(new T.Vector3(0, 1, 0), 0), ndc = new T.Vector2(), hit = new T.Vector3();
    function unscr(x, y) { ndc.set(x / W * 2 - 1, 1 - y / H * 2); ray.setFromCamera(ndc, cam); if (!ray.ray.intersectPlane(ground, hit)) return { x: 260, y: 170 }; return { x: hit.x / K, y: hit.z / K }; }
    function pin(el, p, dx, dy) { var x = Math.max(4, Math.min(W - el.offsetWidth - 4, p[0] + dx)), y = Math.max(72, Math.min(H - 30, p[1] + dy)); el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)'; }

    function rebuild() {                    /* the world or its solution changed */
      var z = world.zone, s = world.start, h = 9;
      lShort.set(sol.short.pts, 0.009); lFree.set(sol.free.pts, 0.011); lBad.set(sol.free.pts, 0.011); lRej.set(sol.free.pts, 0.009); lSafe.set(sol.safe.pts, 0.012);
      zFill.scale.set(z.w * K, z.h * K, 1); zWash.scale.copy(zFill.scale); zFill.position.x = zWash.position.x = (z.x + z.w / 2) * K; zFill.position.z = zWash.position.z = (z.y + z.h / 2) * K;
      zFill.material.map.repeat.set(z.w * K / 0.2, z.h * K / 0.2);
      zEdge.set(loop([{ x: z.x, y: z.y }, { x: z.x + z.w, y: z.y }, { x: z.x + z.w, y: z.y + z.h }, { x: z.x, y: z.y + z.h }]), 0.008); zEdge.show(0, 1);
      sEdge.set(loop([{ x: s.x - h, y: s.y - h }, { x: s.x + h, y: s.y - h }, { x: s.x + h, y: s.y + h }, { x: s.x - h, y: s.y + h }]), 0.008); sEdge.show(0, 1);
      gA.position.set(world.a.x * K, 0, world.a.y * K); gB.position.set(world.b.x * K, 0, world.b.y * K);
    }
    function size() {
      var r = stage.getBoundingClientRect(); W = Math.max(1, r.width); H = Math.max(1, r.height); narrow = W < 900;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.setSize(W, H, false);
      cam.aspect = W / H;
      var hf = (narrow ? 60 : 61) * Math.PI / 180; cam.fov = 2 * Math.atan(Math.tan(hf / 2) / cam.aspect) * 180 / Math.PI;
      if (narrow) { home.set(CENTRE.x - 0.9, 4.3, CENTRE.z + 4.0); look.set(CENTRE.x + 0.1, 0, CENTRE.z + 0.15); cam.clearViewOffset(); }
      else { home.set(CENTRE.x - 2.3, 5.2, CENTRE.z + 6.9); look.set(CENTRE.x - 0.15, 0, CENTRE.z - 0.2); cam.setViewOffset(W, H, -0.185 * W, -0.02 * H, W, H); }
      cam.updateProjectionMatrix();
    }
    function draw(u) {
      var st = state(u), now = Date.now();
      cx += (mx - cx) * 0.06; cy += (my - cy) * 0.06;
      cam.position.set(home.x + cx * 0.55, home.y - cy * 0.3, home.z + cx * 0.2); cam.lookAt(look);
      lShort.show(0, st.us); lShort.core.material.opacity = phase === 0 ? 0.85 : 0.36;
      if (st.rejected) { lRej.show(0, 1); lFree.show(0, 0); lBad.show(0, 0); }
      else { lRej.show(0, 0); lFree.show(0, Math.min(st.uf, st.ent)); lBad.show(Math.min(st.ent, 1), st.uf > st.ent ? st.uf : 0); }
      lSafe.show(0, st.ua);
      zWash.material.opacity = st.entered && phase === 1 ? 0.2 : 0.05;
      mark(0, st.entered ? sol.free.pts[sol.free.entry] : null, 9 + (phase === 1 ? 1.5 * Math.sin(now / 160) : 0), ORG);
      [['short', st.us, WH], ['free', st.uf, PT], ['safe', st.ua, PT]].forEach(function (d, i) { var p = sol[d[0]], on = d[1] > 0 && p.sureBy !== null && d[1] >= p.sureBy && !(d[0] === 'free' && st.rejected); mark(i + 1, on ? at(p.pts, p.sureBy) : null, 5, d[2]); });
      var w = st.where, ahead = st.rest ? at(sol.safe.pts, 1) : at(st.run.pts, Math.min(1, u + 0.02)), behind = st.rest ? at(sol.safe.pts, 0.97) : at(st.run.pts, Math.max(0, u - 0.02));
      var want = Math.atan2(-(ahead.y - behind.y), ahead.x - behind.x), d = want - heading; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; heading += d * (still ? 1 : 0.2);
      bot.position.set(w.x * K, 0, w.y * K); bot.rotation.y = heading;
      shadow.position.x = under.position.x = w.x * K; shadow.position.z = under.position.z = w.y * K;
      fx(now);
      renderer.render(scene, cam);
      pin(tags.a, scr({ x: world.a.x + 22, y: world.a.y - 12 }, 0.97), 12, -11); pin(tags.b, scr({ x: world.b.x + 22, y: world.b.y - 12 }, 0.97), 12, -11);
      pin(tags.zone, scr({ x: world.zone.x + world.zone.w, y: world.zone.y + world.zone.h }), 10, 8); pin(tags.start, scr(world.start), 16, 14);
      hud(u, st); placeHandles();
    }
    var heroEl = stage.parentNode;
    heroEl.addEventListener('pointermove', function (ev) { if (ev.pointerType === 'touch' || dragging) return; var r = heroEl.getBoundingClientRect(); mx = (ev.clientX - r.left) / r.width * 2 - 1; my = (ev.clientY - r.top) / r.height * 2 - 1; });
    heroEl.addEventListener('pointerleave', function () { mx = my = 0; });
    cv.addEventListener('webglcontextlost', function (e) { e.preventDefault(); });
    rebuild();
    var fx = realism(T, renderer, scene, key, floor, CENTRE, still);
    return { live: !still, size: size, draw: draw, scr: scr, unscr: unscr, rebuild: rebuild };
  }

  /* ---------------- fallback for browsers without WebGL: the same scene drawn over a rendered floor ---------------- */
  function make2D() {
  /* ---------------- camera: the same one the floor was rendered with ---------------- */
  var PW = CFG.pw, PH = CFG.ph, K = CFG.k, X0 = CFG.x0, Y0 = CFG.y0;
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function norm(a) { var l = Math.sqrt(dot(a, a)); return [a[0] / l, a[1] / l, a[2] / l]; }
  var LOC = CFG.loc, FWD = norm(sub(CFG.look, LOC)), RIGHT = norm(cross(FWD, [0, 0, 1])), UP = cross(RIGHT, FWD);
  var F = CFG.lens / 36 * PW, SHX = -CFG.shiftx * PW;
  var view = { s: 1, ox: 0, oy: 0, w: 0, h: 0 };
  function plate(p) {                       /* floor metres -> plate pixels */
    var d = sub(p, LOC), z = dot(d, FWD);
    return [PW / 2 + F * dot(d, RIGHT) / z + SHX, PH / 2 - F * dot(d, UP) / z];
  }
  function floorOf(w) { return [X0 + w.x * K, Y0 + (M.H - w.y) * K, 0]; }
  function scr(w, z) { var f = floorOf(w); f[2] = z || 0; var q = plate(f); return [q[0] * view.s + view.ox, q[1] * view.s + view.oy]; }
  function unscr(x, y) {                    /* screen pixels -> world units, on the floor */
    var px = (x - view.ox) / view.s, py = (y - view.oy) / view.s;
    var a = (px - PW / 2 - SHX) / F, b = -(py - PH / 2) / F;
    var dir = [FWD[0] + RIGHT[0] * a + UP[0] * b, FWD[1] + RIGHT[1] * a + UP[1] * b, FWD[2] + RIGHT[2] * a + UP[2] * b];
    var t = -LOC[2] / dir[2];
    return { x: (LOC[0] + t * dir[0] - X0) / K, y: M.H - (LOC[1] + t * dir[1] - Y0) / K };
  }
  function mpx(w) {                         /* how many screen pixels one world unit is, here */
    var a = scr({ x: w.x - 5, y: w.y }), b = scr({ x: w.x + 5, y: w.y });
    return Math.hypot(b[0] - a[0], b[1] - a[1]) / 10;
  }


  var ctx = cv.getContext('2d');
  var img = new Image(), bot = new Image(), ready = 0;
  img.onload = bot.onload = function () { ready++; draw(lastU); };
  img.src = CFG.plate; bot.src = CFG.robot;
  var PERI = '123,147,255', PT = '169,184,255', ORG = '255,138,61', WH = '244,243,239';

  var lastU = cur;

  function size() {
    var r = stage.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    view.w = r.width; view.h = r.height;
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var s = Math.max(r.width / PW, r.height / PH), narrow = r.width < 900;
    if (narrow) s = Math.max(s, r.width / (PW * 0.56));        /* show the play area, not the empty floor */
    if (!narrow) s *= 1.08;                                    /* come in closer: the play area is the subject */
    view.s = s;
    view.ox = (r.width - PW * s) * (narrow ? 1 : 0.5);
    view.oy = (r.height - PH * s) * 0.5;
  }

  function at(arr, u) {
    var f = u * (arr.length - 1), i = Math.max(0, Math.min(arr.length - 2, Math.floor(f))), t = f - i;
    return typeof arr[i] === 'number' ? arr[i] + (arr[i + 1] - arr[i]) * t
      : { x: arr[i].x + (arr[i + 1].x - arr[i].x) * t, y: arr[i].y + (arr[i + 1].y - arr[i].y) * t };
  }
  function trace(pts, from, upto) {
    var f0 = from * (pts.length - 1), f1 = upto * (pts.length - 1), p = scr(at(pts, from));
    ctx.beginPath(); ctx.moveTo(p[0], p[1]);
    for (var i = Math.ceil(f0 + 1e-6); i <= Math.floor(f1); i++) { p = scr(pts[i]); ctx.lineTo(p[0], p[1]); }
    p = scr(at(pts, upto)); ctx.lineTo(p[0], p[1]);
  }
  function light(rgb, a, w, blur, dash) {
    ctx.setLineDash(dash || []); ctx.lineCap = dash ? 'butt' : 'round'; ctx.lineJoin = 'round';
    if (blur) { ctx.shadowColor = 'rgba(' + rgb + ',' + Math.min(1, a) + ')'; ctx.shadowBlur = blur; }
    ctx.strokeStyle = 'rgba(' + rgb + ',' + a + ')'; ctx.lineWidth = w; ctx.stroke();
    ctx.shadowBlur = 0; ctx.setLineDash([]);
  }
  function ring(w, r, rgb, a, lw, blur) {
    ctx.beginPath();
    for (var i = 0; i <= 48; i++) {
      var t = i / 48 * Math.PI * 2, p = scr({ x: w.x + Math.cos(t) * r, y: w.y + Math.sin(t) * r });
      if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]);
    }
    light(rgb, a, lw, blur);
  }
  function post(w, rgb, a) {
    var base = { x: w.x + 22, y: w.y - 12 }, p0 = scr(base), p1 = scr(base, 0.95);
    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.strokeStyle = 'rgba(10,10,12,.95)'; ctx.lineWidth = Math.max(1.5, mpx(w) * 1.4); ctx.stroke();
    ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath(); ctx.arc(p1[0], p1[1], Math.max(2, mpx(w) * 2.2), 0, 7); ctx.fillStyle = 'rgba(' + rgb + ',' + a + ')'; ctx.shadowColor = 'rgba(' + rgb + ',1)'; ctx.shadowBlur = 16; ctx.fill(); ctx.shadowBlur = 0;
    return p1;
  }
  function tag(p, text, rgb, dx, dy) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.font = '500 11px "IBM Plex Mono", ui-monospace, monospace';
    try { ctx.letterSpacing = '1px'; } catch (e) { /* older canvases space normally */ }
    var t = text.toUpperCase(), w = ctx.measureText(t).width + 18, x = Math.max(4, Math.min(view.w - w - 4, p[0] + dx)), y = Math.max(74, Math.min(view.h - 26, p[1] + dy));
    ctx.fillStyle = 'rgba(8,9,11,.66)'; ctx.fillRect(x, y, w, 22);
    ctx.fillStyle = 'rgba(' + rgb + ',1)'; ctx.fillRect(x, y, 1.5, 22);
    ctx.fillText(t, x + 9, y + 15);
  }

  function draw(u) {
    lastU = u;
    if (!view.w) return;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#08090b'; ctx.fillRect(0, 0, view.w, view.h);
    if (img.complete && img.naturalWidth) ctx.drawImage(img, view.ox, view.oy, PW * view.s, PH * view.s);

    var rest = phase === 3, same = sol.safe.same, name = phase === 0 ? 'short' : phase === 1 ? 'free' : 'safe', run = sol[name];
    var entered = sol.free.enters && (phase > 1 || (phase === 1 && u >= sol.free.entry / (N - 1)));
    var rejected = sol.free.enters && phase >= 2, z = world.zone, m = mpx({ x: 260, y: 170 });

    ctx.globalCompositeOperation = 'lighter';
    /* the keep-out zone */
    var q = [scr({ x: z.x, y: z.y }), scr({ x: z.x + z.w, y: z.y }), scr({ x: z.x + z.w, y: z.y + z.h }), scr({ x: z.x, y: z.y + z.h })];
    ctx.save(); ctx.beginPath(); ctx.moveTo(q[0][0], q[0][1]); for (var i = 1; i < 4; i++) ctx.lineTo(q[i][0], q[i][1]); ctx.closePath();
    ctx.fillStyle = 'rgba(' + ORG + ',' + (entered && phase === 1 ? 0.16 : 0.05) + ')'; ctx.fill(); ctx.clip();
    ctx.beginPath();
    for (var c = -z.h; c < z.w; c += 13) { var a = scr({ x: z.x + c, y: z.y + z.h }), b = scr({ x: z.x + c + z.h, y: z.y }); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
    light(ORG, 0.6, Math.max(1, m * 0.9)); ctx.restore();
    ctx.beginPath(); ctx.moveTo(q[0][0], q[0][1]); for (i = 1; i < 4; i++) ctx.lineTo(q[i][0], q[i][1]); ctx.closePath(); light(ORG, 0.95, Math.max(1.5, m * 2), 14);

    /* the three paths */
    var us = phase === 0 ? u : 1, uf = phase < 1 ? 0 : phase === 1 ? u : 1, ua = same || phase < 2 ? 0 : phase === 2 ? u : 1;
    if (us > 0) { trace(sol.short.pts, 0, us); light(WH, phase === 0 ? 0.85 : 0.34, Math.max(1.2, m * 1.5), 0, [m * 9, m * 7]); }
    if (uf > 0) {
      var ent = sol.free.enters ? sol.free.entry / (N - 1) : 2, good = Math.min(uf, ent);
      trace(sol.free.pts, 0, good); light(rejected ? ORG : PERI, rejected ? 0.5 : 1, Math.max(2, m * (rejected ? 2 : 4)), rejected ? 0 : 18, rejected ? [m * 6, m * 6] : null);
      if (!rejected) { trace(sol.free.pts, 0, good); light(PT, 0.9, Math.max(1, m * 1.4)); }
      if (uf > ent) { trace(sol.free.pts, ent, uf); light(ORG, rejected ? 0.5 : 1, Math.max(2, m * (rejected ? 2 : 4)), rejected ? 0 : 16, rejected ? [m * 6, m * 6] : null); }
    }
    if (ua > 0) { trace(sol.safe.pts, 0, ua); light(PERI, 1, Math.max(2.4, m * 4.4), 20); trace(sol.safe.pts, 0, ua); light(PT, 0.95, Math.max(1, m * 1.5)); }
    if (entered) ring(sol.free.pts[sol.free.entry], 9 + (phase === 1 ? 1.5 * Math.sin(Date.now() / 160) : 0), ORG, 1, 2, 12);
    ['short', 'free', 'safe'].forEach(function (k) {
      var p = sol[k], up = k === 'short' ? us : k === 'free' ? uf : ua;
      if (up > 0 && p.sureBy !== null && up >= p.sureBy && !(k === 'free' && rejected)) ring(at(p.pts, p.sureBy), 5, k === 'short' ? WH : PT, 0.9, 1.5, 6);
    });

    /* start and goals */
    var s = world.start, h = 9;
    ctx.beginPath(); [[-h, -h], [h, -h], [h, h], [-h, h]].forEach(function (o, j) { var p = scr({ x: s.x + o[0], y: s.y + o[1] }); if (j) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }); ctx.closePath(); light(WH, 0.8, Math.max(1.2, m * 1.4), 6);
    ring(world.a, 17, PERI, 1, Math.max(2, m * 2.6), 18); ring(world.a, 17, PT, 0.9, Math.max(1, m)); ring(world.a, 5, PT, 0.9, Math.max(1.5, m * 2));
    ring(world.b, 17, WH, 0.55, Math.max(1.5, m * 1.8), 6);
    var ta = post(world.a, PT, 1), tb = post(world.b, WH, 0.7);

    /* the robot */
    ctx.globalCompositeOperation = 'source-over';
    var where = rest ? sol.safe.pts[N - 1] : at(run.pts, u);
    if (bot.complete && bot.naturalWidth) {
      var c0 = scr(where), k = mpx(where) * CFG.spriteUnits; /* sprite pixels per world unit at the reference spot */
      ctx.drawImage(bot, c0[0] - CFG.ax * k, c0[1] - CFG.ay * k, bot.naturalWidth * k, bot.naturalHeight * k);
    }

    tag(ta, 'Goal A', PT, 12, -8); tag(tb, 'Goal B', WH, 12, -8);
    tag(scr({ x: z.x + z.w, y: z.y + z.h }), 'Keep-out zone', ORG, 10, 8);
    tag(scr(s), 'Start', WH, 16, 14);

    hud(u, state(u)); placeHandles();
  }
  return { live: false, size: size, draw: draw, scr: scr, unscr: unscr, rebuild: function () {} };
  }

  /* ---------------- the clock ---------------- */
  var R = make3D() || make2D();
  function enter(next, now) {
    phase = next; phaseStart = now;
    if (phase === 2 && sol.safe.same) phase = 3;
    if (phase === 3 && runOnce) { runOnce = false; paused = true; label(); }
  }
  function frame(now) {
    raf = 0;
    if (!inView || document.hidden) return;
    var running = !paused && !dragging;
    if (running) {
      if (!phaseStart) phaseStart = now;
      var span = phase === 3 ? HOLD : DUR, u = (now - phaseStart) / span;
      if (u >= 1) { enter(phase === 3 ? 0 : phase + 1, now); u = 0; }
      var e = Math.min(1, Math.max(0, u));
      cur = phase === 3 ? 1 : e * e * (3 - 2 * e) * 0.6 + e * 0.4;
    }
    R.draw(cur);
    if (R.live || running) raf = requestAnimationFrame(frame);
  }
  function wake() { if (!raf && inView && (R.live || (!paused && !dragging))) raf = requestAnimationFrame(frame); }
  function restart() { phase = 0; phaseStart = 0; cur = 0; wake(); }
  function label() { $('toggle').textContent = paused ? 'Play' : 'Pause'; }
  function replan() { sol = M.solve(world); N = sol.short.pts.length; R.rebuild(); phase = 3; cur = 1; if (!R.live) R.draw(1); }

  /* ---------------- dragging: the handles sit over the scene ---------------- */
  var HND = { start: $('h-start'), a: $('h-a'), b: $('h-b'), zone: $('h-zone') };
  /* the readout and its controls stay out of the way until someone touches the scene */
  function reveal() { var r = document.getElementById('read'), h = document.getElementById('hint'); if (r) r.classList.add('on'); if (h) h.classList.add('off'); }
  ['start', 'a', 'b', 'zone'].forEach(function (k) { if (HND[k]) { HND[k].addEventListener('pointerdown', reveal); HND[k].addEventListener('keydown', reveal); } });
  function placeHandles() {
    ['start', 'a', 'b'].forEach(function (k) { var p = R.scr(world[k]); HND[k].style.left = p[0] + 'px'; HND[k].style.top = p[1] + 'px'; });
    var z = world.zone, q = [R.scr({ x: z.x, y: z.y }), R.scr({ x: z.x + z.w, y: z.y }), R.scr({ x: z.x + z.w, y: z.y + z.h }), R.scr({ x: z.x, y: z.y + z.h })];
    var xs = q.map(function (p) { return p[0]; }), ys = q.map(function (p) { return p[1]; });
    var x0 = Math.min.apply(0, xs) + 8, y0 = Math.min.apply(0, ys) + 4, x1 = Math.max.apply(0, xs) - 8, y1 = Math.max.apply(0, ys) - 4;
    HND.zone.style.left = x0 + 'px'; HND.zone.style.top = y0 + 'px'; HND.zone.style.width = (x1 - x0) + 'px'; HND.zone.style.height = (y1 - y0) + 'px';
  }
  function attempt(change) {
    var trial = JSON.parse(JSON.stringify(world)); change(trial);
    if (!M.valid(trial)) return false;
    world = trial; replan(); return true;
  }
  function local(ev) { var r = stage.getBoundingClientRect(); return R.unscr(ev.clientX - r.left, ev.clientY - r.top); }
  Object.keys(HND).forEach(function (key) {
    var node = HND[key];
    node.addEventListener('pointerdown', function (ev) {
      ev.preventDefault();
      var p = local(ev), t = key === 'zone' ? world.zone : world[key];
      dragging = { key: key, dx: p.x - t.x, dy: p.y - t.y };
      try { node.setPointerCapture(ev.pointerId); } catch (e) { /* the pointer is already gone */ }
      touched = true; phase = 3; cur = 1; if (!R.live) R.draw(1);
    });
    node.addEventListener('pointermove', function (ev) {
      if (!dragging || dragging.key !== key) return;
      var p = local(ev), x = Math.round(p.x - dragging.dx), y = Math.round(p.y - dragging.dy);
      var move = function (mx, my) { return attempt(function (w) { var t = key === 'zone' ? w.zone : w[key]; if (mx) t.x = x; if (my) t.y = y; }); };
      if (!move(true, true)) { if (!move(true, false)) move(false, true); }
    });
    var drop = function () { if (!dragging) return; dragging = null; if (!still && !paused) restart(); else if (!R.live) R.draw(1); };
    node.addEventListener('pointerup', drop); node.addEventListener('pointercancel', drop);
    node.addEventListener('keydown', function (ev) {
      var step = { ArrowLeft: [-8, 0], ArrowRight: [8, 0], ArrowUp: [0, -8], ArrowDown: [0, 8] }[ev.key];
      if (!step) return;
      ev.preventDefault(); touched = true;
      attempt(function (w) { var t = key === 'zone' ? w.zone : w[key]; t.x += step[0]; t.y += step[1]; });
    });
  });
  $('toggle').addEventListener('click', function () {
    paused = !paused; if (!paused && still) runOnce = true; label();
    if (!paused) restart(); else { phase = 3; cur = 1; if (!R.live) R.draw(1); }
  });
  $('shuffle').addEventListener('click', function () {
    var next = M.dream(Math.random) || M.dream(Math.random) || M.dream(Math.random);
    if (!next) return;
    world = next; touched = true; replan(); if (!still && !paused) restart();
  });
  if ('IntersectionObserver' in window) new IntersectionObserver(function (e) { inView = e[0].isIntersecting; if (inView) wake(); }, { threshold: 0.05 }).observe(stage);
  document.addEventListener('visibilitychange', wake);
  function resized() { R.size(); R.draw(cur); }
  window.addEventListener('resize', resized);
  if (window.ResizeObserver) new ResizeObserver(resized).observe(stage);
  label(); R.size(); R.draw(cur); wake();

  /* ---------------- copy the address ---------------- */
  $('copy').addEventListener('click', function () {
    var b = this, done = function () { b.textContent = 'Copied'; setTimeout(function () { b.textContent = 'Copy'; }, 1600); };
    var pick = function () { var r = document.createRange(); r.selectNodeContents($('mail')); var s = getSelection(); s.removeAllRanges(); s.addRange(r); b.textContent = 'Selected'; };
    try { navigator.clipboard.writeText('hello@munawarkazmi.com').then(done, pick); } catch (e) { pick(); }
  });

  /* ---------------- the route of light ---------------- */
  var svg = $('route'), dim = svg.querySelector('.dim'), lit = svg.querySelector('.lit'), glow = svg.querySelector('.glow'), head = svg.querySelector('.head'), end = svg.querySelector('.end');
  var total = 0, goalY = 0;
  function Y(el) { var r = el.getBoundingClientRect(); return { t: r.top + scrollY, b: r.bottom + scrollY, m: (r.top + r.bottom) / 2 + scrollY, l: r.left, r: r.right, w: r.width }; }
  function layout() {
    if (innerWidth <= 900) return;
    var hero = Y(document.querySelector('.hero')), cols = [].map.call(document.querySelectorAll('.results .inner > div'), Y), top = Y(document.querySelector('.work .top'));
    var pr = [].map.call(document.querySelectorAll('.proj'), function (p) { var y = Y(p), im = Y(p.querySelector('.img')), left = p.classList.contains('r'); var tx = Y(p.querySelector('.txt')); return { t: y.t, b: y.b, m: y.m, x: left ? tx.l - 56 : tx.r + 56 }; });
    var doors = Y(document.querySelector('.doors')), con = Y(document.querySelector('.contact h2'));
    var W = document.documentElement.clientWidth, Ht = document.documentElement.scrollHeight, cx = W / 2;
    svg.setAttribute('height', Ht); svg.setAttribute('viewBox', '0 0 ' + W + ' ' + Ht);
    var gx = (cols[1].r + cols[2].l) / 2 - 6, sx = W * 0.56, sy = hero.b - 90; goalY = con.t - 96;
    var d = 'M' + sx + ' ' + sy + ' C ' + sx + ' ' + (cols[0].t - 10) + ', ' + gx + ' ' + (cols[0].t - 60) + ', ' + gx + ' ' + (cols[0].t + 70) + ' L ' + gx + ' ' + (cols[0].b - 20);
    d += ' C ' + gx + ' ' + top.m + ', ' + pr[0].x + ' ' + (top.b - 60) + ', ' + pr[0].x + ' ' + pr[0].m;
    for (var i = 1; i < pr.length; i++) d += ' C ' + pr[i - 1].x + ' ' + (pr[i - 1].b + 30) + ', ' + pr[i].x + ' ' + (pr[i].t - 30) + ', ' + pr[i].x + ' ' + pr[i].m;
    d += ' C ' + pr[2].x + ' ' + (pr[2].b + 150) + ', ' + cx + ' ' + (doors.t - 60) + ', ' + cx + ' ' + (doors.t + 150) + ' L ' + cx + ' ' + (goalY - 40);
    [dim, lit, glow].forEach(function (p) { p.setAttribute('d', d); });
    total = lit.getTotalLength();
    lit.style.strokeDasharray = glow.style.strokeDasharray = total + ' ' + total;
    end.innerHTML = '<circle cx="' + cx + '" cy="' + goalY + '" r="40" stroke="#7b93ff" stroke-opacity=".28" stroke-width="1.5"/><circle class="gl" cx="' + cx + '" cy="' + goalY + '" r="40" stroke="#7b93ff" stroke-width="10" filter="url(#rg)" opacity="0"/><circle class="gc" cx="' + cx + '" cy="' + goalY + '" r="40" stroke="#a9b8ff" stroke-width="2.2" opacity="0"/><circle cx="' + cx + '" cy="' + goalY + '" r="6" fill="#a9b8ff"/>';
    follow();
  }
  function follow() {
    if (!total) return;
    var target = still ? 1e9 : scrollY + innerHeight * 0.62, lo = 0, hi = total;
    for (var i = 0; i < 22; i++) { var mid = (lo + hi) / 2; if (lit.getPointAtLength(mid).y < target) lo = mid; else hi = mid; }
    var off = total - lo; lit.style.strokeDashoffset = glow.style.strokeDashoffset = off;
    var p = lit.getPointAtLength(lo), arrived = lo > total - 2;
    head.setAttribute('cx', p.x); head.setAttribute('cy', p.y); head.setAttribute('opacity', arrived || lo < 4 ? 0 : 1);
    var g = end.querySelectorAll('.gl,.gc'); for (i = 0; i < g.length; i++) g[i].style.opacity = arrived ? (i ? 1 : 0.8) : 0, g[i].style.transition = 'opacity .6s';
  }
  var imgs = [].slice.call(document.querySelectorAll('.proj .img img'));
  function drift() {
    if (still || innerWidth <= 900) return;
    imgs.forEach(function (im) { var r = im.getBoundingClientRect(), c = (r.top + r.height / 2 - innerHeight / 2) / innerHeight, t = im._tilt || [0, 0]; im.style.transform = 'perspective(1100px) translateY(' + (c * -34).toFixed(1) + 'px) rotateY(' + (t[0] * 5).toFixed(2) + 'deg) rotateX(' + (-t[1] * 4).toFixed(2) + 'deg) scale(1.05)'; var c2 = im.parentNode.querySelector('canvas'); if (c2) c2.style.transform = im.style.transform; });
  }
  /* the project scenes lean a little towards the cursor */
  [].forEach.call(document.querySelectorAll('.proj'), function (p) {
    var im = p.querySelector('.img img');
    p.addEventListener('pointermove', function (ev) { if (still || ev.pointerType === 'touch') return; var r = p.getBoundingClientRect(); im._tilt = [(ev.clientX - r.left) / r.width * 2 - 1, (ev.clientY - r.top) / r.height * 2 - 1]; drift(); });
    p.addEventListener('pointerleave', function () { im._tilt = [0, 0]; drift(); });
  });
  var queued = false;
  addEventListener('scroll', function () { if (queued) return; queued = true; requestAnimationFrame(function () { queued = false; follow(); drift(); }); }, { passive: true });
  addEventListener('resize', layout); addEventListener('load', layout);
  if (window.ResizeObserver) new ResizeObserver(layout).observe(document.body);
  layout(); drift();

  /* things settle into place as they come into view; they are readable before that */
  if (!still && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.remove('pre'); io.unobserve(e.target); } }); }, { rootMargin: '0px 0px -12% 0px' });
    [].forEach.call(document.querySelectorAll('.rv'), function (el) { if (el.getBoundingClientRect().top > innerHeight * 0.9) { el.classList.add('pre'); io.observe(el); } });
  }
})();

/* The project scenes in Selected work and the cursor tilt: the same code the inner pages use. */
/* Inner pages: a small real-time scene in each page header, and cursor tilt on pictures. */
(function () {
  'use strict';
  var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;


  /* ---- the top bar: it stays put, gains a backing once the page moves, and marks where you are ---- */
  (function () {
    var bar = document.querySelector('.pnav') || document.querySelector('nav'); if (!bar) return;
    var links = [].slice.call(bar.querySelectorAll('.links a:not(.keep)')), here = location.pathname.split('/').pop() || 'index.html';
    function mark(a) { links.forEach(function (l) { var on = l === a; l.classList.toggle('on', on); if (on) l.setAttribute('aria-current', l.getAttribute('href').charAt(0) === '#' ? 'location' : 'page'); else l.removeAttribute('aria-current'); }); }
    var fixed = null;                                   /* a page that is itself a destination keeps its own link lit */
    links.forEach(function (l) { var h = (l.getAttribute('href') || '').split('#')[0].split('/').pop(); if (h && h === here) fixed = l; });
    if (!fixed && /\/projects\//.test(location.pathname)) links.forEach(function (l) { if (/work\.html$/.test(l.getAttribute('href'))) fixed = l; });
    var spies = fixed ? [] : links.map(function (l) { var h = l.getAttribute('href') || ''; return h.charAt(0) === '#' && h.length > 1 ? { a: l, el: document.getElementById(h.slice(1)) } : null; }).filter(function (x) { return x && x.el; });
    function tick() {
      bar.classList.toggle('stuck', window.scrollY > 12);
      if (fixed) { mark(fixed); return; }
      var cur = null, mid = window.innerHeight * 0.45;
      spies.forEach(function (sp) { var r = sp.el.getBoundingClientRect(); if (r.top < mid && r.bottom > mid * 0.4) cur = sp.a; });
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4 && spies.length) cur = spies[spies.length - 1].a;
      mark(cur);
    }
    window.addEventListener('scroll', tick, { passive: true }); window.addEventListener('resize', tick); tick();
  })();

  /* ---- pictures and figures lean towards the cursor ---- */
  if (!still && window.matchMedia && window.matchMedia('(hover:hover)').matches) {
    [].forEach.call(document.querySelectorAll('[data-tilt]'), function (el) {
      var k = parseFloat(el.getAttribute('data-tilt')) || 7;
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
        el.style.transform = 'perspective(900px) rotateY(' + (x * k).toFixed(2) + 'deg) rotateX(' + (-y * k).toFixed(2) + 'deg) translateZ(8px)';
      });
      el.addEventListener('pointerleave', function () { el.style.transform = ''; });
    });
  }




  var T = window.THREE; if (!T) return;
  [].forEach.call(document.querySelectorAll('canvas[data-scene]'), function (cv) {   /* one scene per canvas */
  var inset = cv.hasAttribute('data-inset');
  var q = /[?&]t=([\d.]+)/.exec(location.search), FIX = q ? parseFloat(q[1]) : -1;
  var kind = cv.getAttribute('data-scene'), box = cv.parentNode, renderer;
  try { renderer = new T.WebGLRenderer({ canvas: cv, antialias: true, alpha: false }); } catch (e) { return; }
  if (!renderer.getContext()) return;
  box.classList.add('live');
  renderer.setClearColor(0x08090b, 1); renderer.outputEncoding = T.sRGBEncoding;
  var scene = new T.Scene(); scene.fog = new T.Fog(0x08090b, 7, 19);
  var cam = new T.PerspectiveCamera(34, 1, 0.1, 60);
  var PERI = 0x7b93ff, PT = 0xcfd8ff, ORG = 0xff8a3d, WH = 0xf4f3ef;

  function tex(w, h, paint, rep) { var c = document.createElement('canvas'); c.width = w; c.height = h; paint(c.getContext('2d'), w, h); var t = new T.CanvasTexture(c); if (rep) t.wrapS = t.wrapT = T.RepeatWrapping; t.encoding = T.sRGBEncoding; return t; }
  var tHalo = tex(4, 128, function (g, w, h) { var gr = g.createLinearGradient(0, 0, 0, h); for (var i = 0; i <= 16; i++) { var x = i / 16 * 2 - 1; gr.addColorStop(i / 16, 'rgba(255,255,255,' + Math.exp(-x * x * 7).toFixed(3) + ')'); } g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  var tBlob = tex(128, 128, function (g, w) { var gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, w); });
  var tRing = tex(256, 256, function (g, w) { var gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.42, 'rgba(255,255,255,.05)'); gr.addColorStop(0.62, 'rgba(255,255,255,.75)'); gr.addColorStop(0.8, 'rgba(255,255,255,.08)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, w); });
  var tFloor = tex(256, 256, function (g, w) { var d = g.createImageData(w, w); for (var i = 0; i < w * w; i++) { var v = 205 + Math.random() * 50; d.data[i * 4] = d.data[i * 4 + 1] = d.data[i * 4 + 2] = v; d.data[i * 4 + 3] = 255; } g.putImageData(d, 0, 0); }, true);
  tFloor.repeat.set(26, 26);

  var floor = new T.Mesh(new T.PlaneGeometry(70, 70), new T.MeshStandardMaterial({ color: 0x22242c, roughness: 0.78, metalness: 0.05, map: tFloor }));
  floor.rotation.x = -Math.PI / 2; scene.add(floor);
  scene.add(new T.HemisphereLight(0xc6ccdf, 0x050506, 0.5));
  var key = new T.SpotLight(0xfff4e6, 2.5, 26, 0.6, 1, 1.2); key.position.set(0.5, 7.5, 1); scene.add(key); scene.add(key.target);
  var rim = new T.DirectionalLight(0x8fa3ff, 0.55); rim.position.set(-4, 3, -6); scene.add(rim);

  function decal(map, color, opacity, additive) { return new T.MeshBasicMaterial({ map: map || null, color: color, transparent: true, opacity: opacity, depthWrite: false, blending: additive === false ? T.NormalBlending : T.AdditiveBlending, side: T.DoubleSide, fog: false }); }
  function flat(size, mat, y, x, z) { var m = new T.Mesh(new T.PlaneGeometry(size, size), mat); m.rotation.x = -Math.PI / 2; m.position.set(x || 0, y, z || 0); scene.add(m); return m; }
  function smooth(pts, n) { return new T.CatmullRomCurve3(pts.map(function (p) { return new T.Vector3(p[0], 0, p[1]); }), false, 'centripetal').getSpacedPoints(n || 160).map(function (v) { return [v.x, v.z]; }); }
  function straight(pts, n) { var out = [], i, j, tot = 0, L = []; for (i = 0; i < pts.length - 1; i++) { L.push(Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])); tot += L[i]; } for (i = 0; i < pts.length - 1; i++) { var k = Math.max(2, Math.round((n || 160) * L[i] / tot)); for (j = 0; j < k; j++) out.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * j / k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * j / k]); } out.push(pts[pts.length - 1]); return out; }
  function ribbon(p, width, y, dash) {
    var n = p.length, pos = [], uv = [], h = width / 2, L = [], R = [], i;
    for (i = 0; i < n; i++) { var a = p[Math.max(0, i - 1)], b = p[Math.min(n - 1, i + 1)], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l; L.push([p[i][0] + nx * h, p[i][1] + nz * h]); R.push([p[i][0] - nx * h, p[i][1] - nz * h]); }
    for (i = 0; i < n - 1; i++) { var on = !dash || (i % dash[1]) < dash[0], q = on ? [L[i], R[i], L[i + 1], R[i], R[i + 1], L[i + 1]] : [L[i], L[i], L[i], L[i], L[i], L[i]], vs = [0, 1, 0, 1, 1, 0]; for (var j = 0; j < 6; j++) { pos.push(q[j][0], y, q[j][1]); uv.push(i / (n - 1), vs[j]); } }
    var g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); return g;
  }
  function Line(pts, color, o) {
    o = o || {}; this.pts = pts; this.n = pts.length - 1;
    this.core = new T.Mesh(ribbon(pts, o.w || 0.03, o.y || 0.012, o.dash), decal(null, o.core || color, o.op === undefined ? 1 : o.op)); this.core.frustumCulled = false; scene.add(this.core);
    if (o.halo !== 0) { this.halo = new T.Mesh(ribbon(pts, o.hw || 0.34, (o.y || 0.012) - 0.003), decal(tHalo, color, o.halo || 0.5)); this.halo.frustumCulled = false; scene.add(this.halo); }
    this.show(o.full ? 1 : 0);
  }
  Line.prototype.show = function (u) { var b = Math.round(Math.max(0, Math.min(1, u)) * this.n); this.core.visible = b > 0; this.core.geometry.setDrawRange(0, b * 6); if (this.halo) { this.halo.visible = b > 0; this.halo.geometry.setDrawRange(0, b * 6); } };
  Line.prototype.at = function (u) { var f = Math.max(0, Math.min(1, u)) * this.n, i = Math.min(this.n - 1, Math.floor(f)), t = f - i, a = this.pts[i], b = this.pts[i + 1]; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, Math.atan2(b[1] - a[1], b[0] - a[0])]; };
  function goal(x, z, color, bright) {
    var g = new T.Group();
    var ring = new T.Mesh(new T.TorusGeometry(0.2, bright ? 0.011 : 0.008, 10, 72), new T.MeshBasicMaterial({ color: bright ? PT : WH, transparent: true, opacity: bright ? 1 : 0.6, fog: false })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.012; g.add(ring);
    var gl = new T.Mesh(new T.PlaneGeometry(1.25, 1.25), decal(tRing, color, bright ? 0.95 : 0.22)); gl.rotation.x = -Math.PI / 2; gl.position.y = 0.006; g.add(gl);
    var post = new T.Mesh(new T.CylinderGeometry(0.008, 0.008, 0.95, 10), new T.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.5 })); post.position.set(0.25, 0.475, -0.14); g.add(post);
    var tip = new T.Mesh(new T.SphereGeometry(0.024, 16, 12), new T.MeshBasicMaterial({ color: bright ? PT : WH, fog: false })); tip.position.set(0.25, 0.97, -0.14); g.add(tip);
    g.position.set(x, 0, z); scene.add(g); g.glow = gl; return g;
  }
  var wallMat = new T.MeshStandardMaterial({ color: 0xc9ccd6, roughness: 0.6, metalness: 0.02 }), crateMat = new T.MeshStandardMaterial({ color: 0x8a6a4c, roughness: 0.8 });
  function wall(x1, z1, x2, z2, h, mat) { var len = Math.hypot(x2 - x1, z2 - z1), m = new T.Mesh(new T.BoxGeometry(len + 0.07, h || 0.42, 0.07), mat || wallMat); m.position.set((x1 + x2) / 2, (h || 0.42) / 2, (z1 + z2) / 2); m.rotation.y = -Math.atan2(z2 - z1, x2 - x1); scene.add(m); return m; }
  function crate(x, z, s) { var m = new T.Mesh(new T.BoxGeometry(s, s * 0.8, s), crateMat); m.position.set(x, s * 0.4, z); m.rotation.y = 0.3; scene.add(m); }

  /* the robot, the same model as on the home page */
  var bot = new T.Group(), dark = new T.MeshStandardMaterial({ color: 0x15161a, roughness: 0.45, metalness: 0.35 }), shell = new T.MeshStandardMaterial({ color: 0xd9dbe2, roughness: 0.32, metalness: 0.15 });
  function part(geo, mat, y) { var m = new T.Mesh(geo, mat); m.position.y = y; bot.add(m); return m; }
  part(new T.CylinderGeometry(0.19, 0.2, 0.06, 56), dark, 0.04);
  part(new T.CylinderGeometry(0.196, 0.196, 0.014, 56), new T.MeshBasicMaterial({ color: WH, fog: false }), 0.077);
  part(new T.CylinderGeometry(0.178, 0.19, 0.075, 56), shell, 0.122);
  part(new T.CylinderGeometry(0.15, 0.178, 0.016, 56), shell, 0.167);
  part(new T.CylinderGeometry(0.062, 0.066, 0.05, 32), dark, 0.2);
  part(new T.CylinderGeometry(0.064, 0.064, 0.008, 32), new T.MeshBasicMaterial({ color: PERI, fog: false }), 0.205);
  var eye = part(new T.BoxGeometry(0.02, 0.022, 0.13), new T.MeshBasicMaterial({ color: PT, fog: false }), 0.125); eye.position.x = 0.181;
  var nose = new T.Mesh(new T.PlaneGeometry(0.5, 0.34), decal(tBlob, PERI, 0.55)); nose.rotation.x = -Math.PI / 2; nose.position.set(0.36, 0.007, 0); bot.add(nose);
  scene.add(bot);
  var shadow = flat(0.95, decal(tBlob, 0x000000, 0.8, false), 0.0025), under = flat(0.9, decal(tBlob, WH, 0.16), 0.005);
  function place(p) { bot.position.set(p[0], 0, p[1]); bot.rotation.y = -p[2]; shadow.position.x = under.position.x = p[0]; shadow.position.z = under.position.z = p[1]; }


  /* ---- other robots: original stylised models, built from primitives like the wheeled base ---- */
  function mk(geo, mat, x, y, z, parent) { var m = new T.Mesh(geo, mat); m.position.set(x || 0, y || 0, z || 0); (parent || scene).add(m); return m; }
  var glowP = new T.MeshBasicMaterial({ color: PT, fog: false }), glowO = new T.MeshBasicMaterial({ color: ORG, fog: false });
  function humanoid() {                  /* a small desktop humanoid, about knee height */
    var g = new T.Group(), k = 1;
    [-0.09, 0.09].forEach(function (z) {
      mk(new T.BoxGeometry(0.17, 0.045, 0.1), dark, 0.025, 0.022, z, g);
      mk(new T.CylinderGeometry(0.034, 0.038, 0.2, 16), shell, 0, 0.145, z, g);
      mk(new T.SphereGeometry(0.043, 16, 12), dark, 0, 0.255, z, g);
      mk(new T.CylinderGeometry(0.04, 0.036, 0.19, 16), shell, 0, 0.36, z, g);
    });
    mk(new T.BoxGeometry(0.15, 0.09, 0.26), dark, 0, 0.49, 0, g);
    mk(new T.BoxGeometry(0.19, 0.27, 0.3), shell, 0, 0.665, 0, g);
    mk(new T.BoxGeometry(0.012, 0.1, 0.14), glowP, 0.097, 0.7, 0, g);
    mk(new T.CylinderGeometry(0.035, 0.035, 0.05, 16), dark, 0, 0.82, 0, g);
    var head = new T.Group(); head.position.y = 0.93; g.add(head);
    mk(new T.BoxGeometry(0.19, 0.17, 0.23), shell, 0, 0, 0, head);
    mk(new T.BoxGeometry(0.02, 0.085, 0.19), dark, 0.09, 0.005, 0, head);
    [-0.05, 0.05].forEach(function (z) { mk(new T.SphereGeometry(0.018, 12, 10), glowP, 0.101, 0.008, z, head); });
    g.arms = [-1, 1].map(function (sd) {
      var sh = new T.Group(); sh.position.set(0, 0.76, sd * 0.185); g.add(sh);
      mk(new T.SphereGeometry(0.046, 16, 12), dark, 0, 0, 0, sh);
      mk(new T.CylinderGeometry(0.03, 0.028, 0.17, 14), shell, 0, -0.1, 0, sh);
      var el = new T.Group(); el.position.y = -0.2; sh.add(el);
      mk(new T.SphereGeometry(0.034, 14, 10), dark, 0, 0, 0, el);
      mk(new T.CylinderGeometry(0.027, 0.024, 0.16, 14), shell, 0, -0.095, 0, el);
      mk(new T.SphereGeometry(0.034, 14, 10), dark, 0, -0.19, 0, el);
      return { sh: sh, el: el };
    });
    g.head = head;
    g.pose = function (now, gesture) {   /* idle sway; with gesture, the right arm points and the head follows */
      var a = Math.sin(now / 900) * 0.06, r = g.arms[1], l = g.arms[0];
      l.sh.rotation.z = 0.08 + a; l.el.rotation.z = -0.15;
      r.sh.rotation.z = -0.08 - gesture * 1.75 + a * (1 - gesture); r.sh.rotation.x = gesture * 0.25; r.el.rotation.z = -0.15 - gesture * 0.2 * Math.sin(now / 260);
      head.rotation.y = gesture * -0.35 + Math.sin(now / 1700) * 0.12;
    };
    return g;
  }
  function quadruped() {                 /* a four-legged walker */
    var g = new T.Group(), body = new T.Group(); body.position.y = 0.36; g.add(body);
    mk(new T.BoxGeometry(0.62, 0.11, 0.2), shell, 0, 0.02, 0, body);
    mk(new T.BoxGeometry(0.5, 0.05, 0.16), dark, 0, -0.05, 0, body);
    mk(new T.BoxGeometry(0.13, 0.11, 0.16), dark, 0.36, 0.02, 0, body);
    mk(new T.BoxGeometry(0.012, 0.03, 0.12), glowP, 0.428, 0.035, 0, body);
    mk(new T.BoxGeometry(0.2, 0.012, 0.012), glowP, 0, 0.078, 0, body);
    g.legs = [[0.24, 0.13], [0.24, -0.13], [-0.24, 0.13], [-0.24, -0.13]].map(function (q, i) {
      var hip = new T.Group(); hip.position.set(q[0], -0.02, q[1]); body.add(hip);
      mk(new T.SphereGeometry(0.05, 16, 12), dark, 0, 0, 0, hip);
      mk(new T.BoxGeometry(0.055, 0.2, 0.045), shell, 0, -0.1, 0, hip);
      var knee = new T.Group(); knee.position.y = -0.2; hip.add(knee);
      mk(new T.SphereGeometry(0.032, 14, 10), dark, 0, 0, 0, knee);
      mk(new T.CylinderGeometry(0.02, 0.016, 0.19, 12), dark, 0, -0.095, 0, knee);
      mk(new T.SphereGeometry(0.028, 14, 10), dark, 0, -0.19, 0, knee);
      return { hip: hip, knee: knee, ph: (i === 0 || i === 3) ? 0 : Math.PI };
    });
    g.pose = function (now) {            /* a trot: diagonal pairs move together */
      var w = now / 190;
      g.legs.forEach(function (L) { var sw = Math.sin(w + L.ph), lift = Math.max(0, Math.cos(w + L.ph)); L.hip.rotation.z = 0.55 + sw * 0.32; L.knee.rotation.z = -1.1 - lift * 0.5; });
      body.position.y = 0.345 + 0.008 * Math.sin(w * 2); body.rotation.x = 0.02 * Math.sin(w);
    };
    return g;
  }
  function camnode() {                   /* a camera board on a stand, with its radio antenna */
    var g = new T.Group(), board = new T.Group(); board.position.y = 0.5; board.rotation.z = -0.12; g.add(board);
    mk(new T.CylinderGeometry(0.16, 0.19, 0.03, 32), dark, 0, 0.015, 0, g);
    mk(new T.CylinderGeometry(0.014, 0.014, 0.36, 10), dark, -0.04, 0.2, 0, g);
    mk(new T.BoxGeometry(0.03, 0.42, 0.3), new T.MeshStandardMaterial({ color: 0x1b2a44, roughness: 0.5, metalness: 0.2 }), 0, 0, 0, board);
    mk(new T.BoxGeometry(0.03, 0.13, 0.13), dark, 0.03, 0.09, 0, board);
    var lens = mk(new T.CylinderGeometry(0.045, 0.05, 0.06, 24), dark, 0.07, 0.09, 0, board); lens.rotation.z = Math.PI / 2;
    var glass = mk(new T.CylinderGeometry(0.03, 0.03, 0.005, 24), glowP, 0.102, 0.09, 0, board); glass.rotation.z = Math.PI / 2;
    mk(new T.BoxGeometry(0.02, 0.11, 0.16), shell, 0.025, -0.1, 0, board);
    mk(new T.BoxGeometry(0.012, 0.03, 0.03), new T.MeshStandardMaterial({ color: 0xb9a36a, roughness: 0.4, metalness: 0.6 }), 0.02, -0.18, 0.11, board);
    g.led = mk(new T.SphereGeometry(0.014, 10, 8), glowO, 0.02, 0.18, -0.11, board);
    mk(new T.CylinderGeometry(0.006, 0.006, 0.34, 8), dark, -0.02, 0.36, 0.12, board);
    mk(new T.SphereGeometry(0.012, 8, 8), dark, -0.02, 0.53, 0.12, board);
    var cone = new T.Mesh(new T.ConeGeometry(0.75, 1.5, 32, 1, true), decal(null, PERI, 0.07)); cone.rotation.z = Math.PI / 2; cone.position.set(0.85, 0.09, 0); board.add(cone);
    g.pose = function (now) { var on = Math.sin(now / 1500) > 0.55; g.led.visible = on; cone.material.opacity = on ? 0.13 : 0.05; glass.material.color.setHex(on ? 0xffffff : PT); };
    return g;
  }
  function wheeled() {                   /* a copy of the wheeled base, for the turntable */
    var g = bot.clone(true); g.visible = true; g.pose = function () {}; return g;
  }

  /* ---- the scenes. Each sets step(t), with t running 0..1 over its loop ---- */
  var step, LOOP = 11000, eyeAt = [0.2, 4.9, 6.2], lookAt = [0, 0, 0], lookY = 0, continuous = false, pose = null, zoom = 1;
  function seg(t, a, b) { var u = Math.max(0, Math.min(1, (t - a) / (b - a))); return u * u * (3 - 2 * u); }
  function noBot() { bot.visible = shadow.visible = under.visible = false; }
  function startDot(x, z) { flat(0.5, decal(tBlob, WH, 0.25), 0.004, x, z); }
  function stopRing(x, z) { var r = new T.Mesh(new T.TorusGeometry(0.13, 0.012, 8, 40), new T.MeshBasicMaterial({ color: ORG, fog: false })); r.rotation.x = Math.PI / 2; r.position.set(x, 0.014, z); scene.add(r); var g = flat(0.9, decal(tRing, ORG, 0.8), 0.006, x, z); return function (k) { r.visible = g.visible = k > 0; r.scale.setScalar(0.6 + 0.4 * k); g.material.opacity = 0.8 * k; }; }
  function rooms() { wall(-3, -1.9, 3, -1.9); wall(-3, 1.9, 3, 1.9); wall(-3, -1.9, -3, 1.9); wall(3, -1.9, 3, 1.9); wall(-0.9, -1.9, -0.9, 0.5); wall(0.9, 1.9, 0.9, -0.4); wall(0.9, -1.9, 0.9, -1.25); crate(-1.9, -1.2, 0.3); crate(2.3, 1.2, 0.34); crate(0.1, 1.35, 0.26); }
  function glowBox(w, h, d, color) { return new T.Mesh(new T.BoxGeometry(w, h, d), new T.MeshBasicMaterial({ color: color, fog: false })); }
  var S = {};

  S.work = function (verifyOnly) {       /* a proposal is refused at a wall; a verified route goes round */
    rooms();
    var bad = new Line(straight([[-2.2, 0.9], [-0.95, -0.3]], 40), ORG, { dash: [3, 6], core: 0xffb27a, halo: 0.45, w: 0.034 });
    var ghost = new Line(straight([[-0.85, -0.4], [2.2, -1.1]], 60), ORG, { dash: [2, 6], core: 0xffb27a, halo: 0, op: 0.28, w: 0.022 });
    var way = [[-2.2, 0.9], [-1.5, 1.25], [-0.5, 1.2], [0.05, 0.4], [0.3, -0.7], [0.9, -0.83], [1.6, -0.9], [2.2, -1.1]];
    var good = new Line(verifyOnly ? straight(way, 200) : smooth(way), PERI, { core: PT });
    if (verifyOnly) way.forEach(function (p) { var d = new T.Mesh(new T.SphereGeometry(0.035, 12, 10), new T.MeshBasicMaterial({ color: PT, fog: false })); d.position.set(p[0], 0.03, p[1]); scene.add(d); });
    var stop = stopRing(-0.98, -0.27), g1 = goal(2.2, -1.1, PERI, true); startDot(-2.2, 0.9);
    step = function (t) {
      bad.show(seg(t, 0.04, 0.2)); ghost.show(seg(t, 0.2, 0.3)); stop(seg(t, 0.2, 0.26));
      var u = seg(t, 0.32, 0.86); good.show(u); place(good.at(u)); g1.glow.material.opacity = 0.5 + 0.45 * seg(t, 0.82, 0.9);
    };
  };
  S.verify = function () { S.work(true); };
  S.planfail = function () {             /* the plan walks into a locked door, and the checker names the step */
    rooms();
    var door = glowBox(0.06, 0.4, 0.85, ORG); door.position.set(0.9, 0.2, -0.825); scene.add(door);
    var plan = new Line(smooth([[-2.2, -0.9], [-1.6, 0.4], [-0.9, 1.2], [-0.2, 0.9], [0.3, -0.3], [0.62, -0.8]]), PERI, { core: PT });
    var ghost = new Line(straight([[0.7, -0.82], [2.2, -1.1]], 50), ORG, { dash: [2, 6], core: 0xffb27a, halo: 0, op: 0.4, w: 0.022 });
    var stop = stopRing(0.62, -0.8); goal(2.2, -1.1, WH, false); startDot(-2.2, -0.9);
    step = function (t) { var u = seg(t, 0.06, 0.6); plan.show(u); place(plan.at(u)); var k = seg(t, 0.6, 0.68); stop(k); ghost.show(seg(t, 0.64, 0.8)); door.material.color.setHex(k > 0.5 ? 0xffb27a : ORG); };
  };
  S.replan = function () {               /* a block lands on the route; the plan is repaired from where the robot is */
    wall(-1.4, -1.6, -1.4, -0.3); wall(1.2, 0.5, 1.2, 1.7); crate(-2.1, 1.2, 0.3);
    var p1 = smooth([[-2.7, 0.3], [-1.2, 0.35], [0.3, 0.0], [1.4, -0.3], [2.6, -0.6]], 200), plan = new Line(p1, WH, { core: WH, op: 0.3, halo: 0, w: 0.016, y: 0.009 }), lit = new Line(p1, PERI, { core: PT });
    var from = lit.at(0.42), fix = new Line(smooth([[from[0], from[1]], [0.1, -0.55], [0.75, -1.2], [1.6, -1.05], [2.6, -0.6]], 140), PERI, { core: PT });
    var blk = new T.Mesh(new T.BoxGeometry(0.55, 0.5, 0.9), new T.MeshStandardMaterial({ color: 0x9a9da8, roughness: 0.6 })); blk.position.set(0.85, 3, -0.15); scene.add(blk);
    var stop = stopRing(0.85, -0.15), g1 = goal(2.6, -0.6, PERI, true); startDot(-2.7, 0.3);
    step = function (t) {
      plan.show(seg(t, 0.02, 0.12)); var u = seg(t, 0.1, 0.4) * 0.42; lit.show(u);
      var f = seg(t, 0.3, 0.4); blk.position.y = 0.25 + (1 - f * f) * 3.2; blk.visible = t > 0.28; stop(seg(t, 0.39, 0.44) * (1 - seg(t, 0.6, 0.7)));
      var v = seg(t, 0.46, 0.88); fix.show(v); place(v > 0 ? fix.at(v) : lit.at(u)); g1.glow.material.opacity = 0.5 + 0.45 * seg(t, 0.84, 0.9);
    };
  };
  S.research = function () {             /* many candidate paths to one goal; one of them tells a watcher early */
    wall(-0.2, -0.75, -0.2, 0.75, 0.5); eyeAt = [0.2, 4.5, 6.3];
    var S0 = [-2.6, 0.2], A = [2.4, -1.15], B = [2.4, 1.35], fans = [];
    [-1.75, -1.45, -1.2, 1.35, 1.75].forEach(function (c) { fans.push(new Line(smooth([S0, [-1.3, c * 0.55], [-0.2, c], [1.2, c * 0.8 + A[1] * 0.2], A]), WH, { core: WH, op: 0.34, halo: 0, w: 0.014, y: 0.009 })); });
    var best = new Line(smooth([S0, [-1.5, -0.85], [-0.2, -1.55], [1.3, -1.5], A]), PERI, { core: PT });
    var gA = goal(A[0], A[1], PERI, true); goal(B[0], B[1], WH, false); startDot(S0[0], S0[1]);
    step = function (t) { fans.forEach(function (f, i) { f.show(seg(t, 0.03 + i * 0.03, 0.24 + i * 0.03)); }); var u = seg(t, 0.3, 0.86); best.show(u); place(best.at(u)); gA.glow.material.opacity = 0.35 + 0.6 * seg(t, 0.36, 0.6); };
  };
  S.legible = function () {              /* the direct path keeps a watcher guessing; the curved one commits early */
    eyeAt = [0.2, 4.5, 6.3];
    var S0 = [-2.6, 0.1], A = [2.3, -1.0], B = [2.3, 1.2];
    var direct = new Line(straight([S0, A], 120), WH, { core: WH, op: 0.4, halo: 0, w: 0.016, y: 0.009, dash: [3, 5] });
    var arc = new Line(smooth([S0, [-1.4, -0.75], [0.2, -1.45], [1.5, -1.35], A]), PERI, { core: PT });
    var gA = goal(A[0], A[1], PERI, true), gB = goal(B[0], B[1], WH, false); startDot(S0[0], S0[1]);
    step = function (t) { direct.show(seg(t, 0.03, 0.2)); var u = seg(t, 0.24, 0.86); arc.show(u); place(arc.at(u)); gA.glow.material.opacity = 0.3 + 0.65 * seg(t, 0.3, 0.5); gB.glow.material.opacity = 0.22 * (1 - seg(t, 0.3, 0.5)); };
  };
  S.gates = function () {                /* a call passes two layers and is stopped at the third */
    var xs = [-1.3, 0.1, 1.5], gs = xs.map(function (x) { var g = new T.Group(), m = new T.MeshBasicMaterial({ color: 0x5b5f6b, fog: false }); [[-0.55, 0.4, 0.04, 0.8, 0.04], [0.55, 0.4, 0.04, 0.8, 0.04], [0, 0.8, 0.04, 0.04, 1.14]].forEach(function (b) { var q = new T.Mesh(new T.BoxGeometry(b[2], b[3], b[4]), m); q.position.set(0, b[1], b[0]); g.add(q); }); g.position.x = x; scene.add(g); var pad = flat(1.5, decal(tBlob, PERI, 0), 0.004, x, 0); return { m: m, pad: pad }; });
    var path = new Line(straight([[-2.8, 0], [1.2, 0]], 160), PERI, { core: PT }), ghost = new Line(straight([[1.6, 0], [2.9, 0]], 40), ORG, { dash: [2, 6], core: 0xffb27a, halo: 0, op: 0.4, w: 0.022 });
    var stop = stopRing(1.2, 0); startDot(-2.8, 0); var col = new T.Color();
    step = function (t) {
      var u = seg(t, 0.06, 0.62); path.show(u); var p = path.at(u); place(p);
      gs.forEach(function (g, i) { var k = seg(p[0], xs[i] - 0.5, xs[i] - 0.1), last = i === 2; col.setHex(0x5b5f6b).lerp(new T.Color(last ? ORG : PT), k); g.m.color.copy(col); g.pad.material.color.setHex(last ? ORG : PERI); g.pad.material.opacity = 0.35 * k; });
      stop(seg(t, 0.62, 0.68)); ghost.show(seg(t, 0.66, 0.8));
    };
  };
  S.predicates = function () {           /* a point a hair's width from a line: which side is it on? */
    noBot(); continuous = true; eyeAt = [0.2, 3.6, 5.0];
    var a = [-2.6, 0.9], b = [2.6, -0.9], line = new Line(straight([a, b], 120), WH, { core: WH, halo: 0.3, w: 0.02, full: true });
    [a, b].forEach(function (p) { var d = new T.Mesh(new T.SphereGeometry(0.06, 16, 12), new T.MeshBasicMaterial({ color: WH, fog: false })); d.position.set(p[0], 0.06, p[1]); scene.add(d); });
    var q = new T.Mesh(new T.SphereGeometry(0.07, 20, 14), new T.MeshBasicMaterial({ color: PT, fog: false })); scene.add(q);
    var ring = new T.Mesh(new T.TorusGeometry(0.2, 0.012, 8, 48), new T.MeshBasicMaterial({ color: PT, fog: false })); ring.rotation.x = Math.PI / 2; scene.add(ring); var gl = flat(1.2, decal(tRing, PERI, 0.8), 0.006);
    var nx = 0.9 / Math.hypot(5.2, 1.8) * 2, nz = 5.2 / Math.hypot(5.2, 1.8);
    step = function (t) {
      var along = 0.2 + 0.25 * Math.sin(t * Math.PI * 2), off = 0.5 * Math.cos(t * Math.PI * 4) * Math.exp(-3 * Math.abs(Math.sin(t * Math.PI * 2))) + 0.018 * Math.sin(t * Math.PI * 16);
      var x = a[0] + (b[0] - a[0]) * (0.5 + along * 0.5) + nx * 0.35 * off, z = a[1] + (b[1] - a[1]) * (0.5 + along * 0.5) + nz * off, above = off > 0;
      q.position.set(x, 0.07, z); ring.position.set(x, 0.014, z); gl.position.x = x; gl.position.z = z;
      q.material.color.setHex(above ? PT : 0xffb27a); ring.material.color.setHex(above ? PT : ORG); gl.material.color.setHex(above ? PERI : ORG);
    };
  };
  S.grid = function () {                 /* a 16 by 12 grid of block means; the cells that changed light up */
    noBot(); continuous = true; eyeAt = [0.2, 4.6, 5.6];
    var NX = 16, NZ = 12, c = 0.34, cells = [], heat = [];
    for (var j = 0; j < NZ; j++) for (var i = 0; i < NX; i++) { var m = new T.Mesh(new T.PlaneGeometry(c * 0.9, c * 0.9), decal(null, PERI, 0.05)); m.rotation.x = -Math.PI / 2; m.position.set((i - NX / 2 + 0.5) * c, 0.006, (j - NZ / 2 + 0.5) * c); scene.add(m); cells.push(m); heat.push(0); }
    var body = new T.Mesh(new T.CylinderGeometry(0.16, 0.2, 0.9, 24), new T.MeshStandardMaterial({ color: 0x23252b, roughness: 0.6 })), head = new T.Mesh(new T.SphereGeometry(0.15, 20, 14), new T.MeshStandardMaterial({ color: 0x2b2d34, roughness: 0.6 })); head.position.y = 0.62; body.add(head); scene.add(body);
    var sh = flat(1.1, decal(tBlob, 0x000000, 0.8, false), 0.008);
    step = function (t) {
      var x = -3.2 + 6.4 * seg(t, 0.05, 0.9), z = 0.7 * Math.sin(t * Math.PI * 3); body.position.set(x, 0.45, z); sh.position.x = x; sh.position.z = z;
      for (var k = 0; k < cells.length; k++) { var p = cells[k].position, d = Math.hypot(p.x - x, p.z - z), hit = d < 0.5 ? 1 : 0; heat[k] = Math.max(hit, heat[k] * 0.93); cells[k].material.opacity = 0.05 + 0.8 * heat[k]; cells[k].material.color.setHex(heat[k] > 0.6 ? PT : PERI); }
    };
  };
  S.turn = function (which) {            /* one robot on a plinth, turning slowly */
    noBot(); continuous = true; eyeAt = [0, 1.25, 3.0]; lookY = which === 'quadruped' ? 0.3 : which === 'wheeled' ? 0.12 : 0.5; zoom = which === 'wheeled' ? 0.6 : which === 'quadruped' ? 0.6 : which === 'camnode' ? 0.66 : 0.74;
    key.position.set(0.8, 5.5, 1.6); key.angle = 0.36; key.intensity = 2.6;
    mk(new T.CylinderGeometry(0.62, 0.66, 0.05, 64), new T.MeshStandardMaterial({ color: 0x1a1c22, roughness: 0.5, metalness: 0.3 }), 0, 0.025, 0);
    var rimr = mk(new T.TorusGeometry(0.625, 0.006, 8, 96), glowP, 0, 0.052, 0); rimr.rotation.x = Math.PI / 2;
    flat(2.6, decal(tRing, PERI, 0.35), 0.004);
    var m = { humanoid: humanoid, quadruped: quadruped, camnode: camnode, wheeled: wheeled }[which](); m.position.y = 0.05; if (which === 'wheeled') m.scale.setScalar(1.7); scene.add(m);
    step = function () {}; pose = function (now) { m.rotation.y = now / 4200; m.pose(now, 0.5 + 0.5 * Math.sin(now / 1600)); };
  };
  ['humanoid', 'quadruped', 'camnode', 'wheeled'].forEach(function (w) { S['turn-' + w] = function () { S.turn(w); }; });
  S.hri = function () {                  /* the robot says what it needs, and points; the person across the room understands */
    noBot(); continuous = true; eyeAt = [0.2, 3.3, 5.2]; lookY = 0.4;
    var h = humanoid(); h.position.set(-1.9, 0, 0.2); h.rotation.y = -0.1; h.scale.setScalar(1.35); scene.add(h);
    flat(1.0, decal(tBlob, 0x000000, 0.5, false), 0.003, -1.9, 0.2);
    var per = new T.Group(), pm = new T.MeshStandardMaterial({ color: 0xb9bcc6, roughness: 0.55 });
    var torso = new T.Mesh(new T.CylinderGeometry(0.2, 0.15, 1.25, 24), pm); torso.position.y = 0.625; per.add(torso); var hd = new T.Mesh(new T.SphereGeometry(0.17, 20, 14), pm); hd.position.y = 1.48; per.add(hd); per.position.set(2.0, 0, -0.2); scene.add(per);
    var heard = flat(1.5, decal(tRing, PERI, 0), 0.006, 2.0, -0.2);
    var dock = mk(new T.BoxGeometry(0.3, 0.04, 0.3), dark, -0.6, 0.02, 1.5), dockGlow = flat(1.0, decal(tRing, ORG, 0.5), 0.005, -0.6, 1.5);
    var waves = [0, 1, 2].map(function () { var w = new T.Mesh(new T.TorusGeometry(1, 0.012, 8, 96), new T.MeshBasicMaterial({ color: PT, transparent: true, fog: false })); w.rotation.x = Math.PI / 2; w.position.set(-1.9, 0.02, 0.2); scene.add(w); return w; });
    step = function (t) {
      var speak = seg(t, 0.05, 0.15) * (1 - seg(t, 0.42, 0.5)), point = seg(t, 0.55, 0.65) * (1 - seg(t, 0.9, 0.97));
      waves.forEach(function (w, i) { var u = (t * 6 + i / 3) % 1; w.scale.setScalar(0.25 + u * 3.9); w.material.opacity = speak * 0.9 * (1 - u) * Math.min(1, u * 8); });
      heard.material.opacity = 0.75 * Math.max(speak, point * 0.55); dockGlow.material.opacity = 0.25 + 0.6 * point;
      h.pose(performance.now(), point); h.rotation.y = -0.1 - point * 0.75;
    };
  };
  S.blowup = function () {               /* a smooth profile steepens towards a point in finite time */
    noBot(); continuous = true; eyeAt = [0.2, 3.9, 6.0]; lookAt = [0, 0, 0];
    var N = 61, bars = [], mat = new T.MeshStandardMaterial({ color: 0x8f96ad, roughness: 0.5, emissive: PERI, emissiveIntensity: 0.25 });
    for (var i = 0; i < N; i++) { var m = new T.Mesh(new T.BoxGeometry(0.055, 1, 0.5), mat); m.position.x = (i - (N - 1) / 2) * 0.09; scene.add(m); bars.push(m); }
    var tipGlow = flat(1.6, decal(tBlob, PERI, 0.3), 0.004);
    step = function (t) { var e = 1.2 * Math.pow(1 - seg(t, 0.05, 0.85), 2) + 0.012; for (var i = 0; i < N; i++) { var x = bars[i].position.x, h = Math.min(1.7, 0.16 / (x * x * 0.9 + e) + 0.03); bars[i].scale.y = h; bars[i].position.y = h / 2; } tipGlow.material.opacity = 0.2 + 0.6 * seg(t, 0.4, 0.85); };
  };
  S.about = function (NP) {              /* one route, a marker for each stop along it */
    eyeAt = [0.4, 4.6, 6.4]; NP = NP || 7;
    var route = new Line(smooth([[-2.9, 1.3], [-2.0, 0.2], [-1.1, 0.95], [-0.2, -0.1], [0.7, 0.7], [1.5, -0.4], [2.1, -0.2], [2.7, -1.2]], 220), PERI, { core: PT }), posts = [];
    for (var i = 0; i < NP; i++) {
      var u0 = (i + 0.6) / (NP + 0.6), p = route.at(u0), x = p[0] - Math.sin(p[2]) * 0.42, z = p[1] + Math.cos(p[2]) * 0.42;
      var pm = new T.Mesh(new T.CylinderGeometry(0.01, 0.01, 0.7, 10), new T.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.5 })); pm.position.set(x, 0.35, z); scene.add(pm);
      var tipm = new T.Mesh(new T.SphereGeometry(0.03, 16, 12), new T.MeshBasicMaterial({ color: WH, fog: false })); tipm.position.set(x, 0.72, z); scene.add(tipm);
      posts.push({ u: u0, tip: tipm, pad: flat(0.6, decal(tRing, PERI, 0), 0.005, x, z) });
    }
    var gEnd = goal(2.7, -1.2, PERI, true); startDot(-2.9, 1.3);
    step = function (t) {
      var u = seg(t, 0.05, 0.88); route.show(u); place(route.at(u));
      posts.forEach(function (q) { var on = seg(u, q.u - 0.03, q.u + 0.03); q.pad.material.opacity = 0.6 * on; q.tip.material.color.setHex(on > 0.5 ? PT : 0x8a8d96); q.tip.scale.setScalar(1 + 0.5 * on); });
      gEnd.glow.material.opacity = 0.5 + 0.45 * seg(t, 0.84, 0.9);
    };
  };
  S.guides = function () { S.about(10); };

  /* Real shadows from the key light, and dust drifting through its beam. Returns a per-frame step. */
  function realism(T, renderer, scene, key, floor, centre, quiet) {
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
    key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.0006; key.shadow.radius = 5; key.shadow.camera.near = 2; key.shadow.camera.far = 22;
    scene.traverse(function (o) { if (o.isMesh && o.material && o.material.isMeshStandardMaterial) { o.receiveShadow = true; if (o !== floor) o.castShadow = true; } });
    var N = 150, pos = new Float32Array(N * 3), seed = [], i;
    for (i = 0; i < N; i++) { pos[i * 3] = centre.x + (Math.random() - 0.5) * 7; pos[i * 3 + 1] = 0.1 + Math.random() * 2.6; pos[i * 3 + 2] = centre.z + (Math.random() - 0.5) * 5; seed.push(Math.random() * 6.28, 0.00012 + Math.random() * 0.0003); }
    var g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3));
    var c = document.createElement('canvas'); c.width = c.height = 32; var x = c.getContext('2d'), gr = x.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 32, 32);
    var dust = new T.Points(g, new T.PointsMaterial({ size: 0.03, map: new T.CanvasTexture(c), color: 0xcfd8ff, transparent: true, opacity: 0.5, depthWrite: false, blending: T.AdditiveBlending, sizeAttenuation: true }));
    dust.frustumCulled = false; scene.add(dust);
    var last = 0;
    return function (now) {
      if (quiet) return; var dt = Math.min(60, now - last); last = now;
      for (var i = 0; i < N; i++) { pos[i * 3 + 1] += seed[i * 2 + 1] * dt; pos[i * 3] += Math.sin(now / 2600 + seed[i * 2]) * 0.00006 * dt; if (pos[i * 3 + 1] > 2.8) pos[i * 3 + 1] = 0.1; }
      g.attributes.position.needsUpdate = true;
    };
  }
  (S[kind] || S.about)();
  if (inset) { key.angle = 0.4; key.intensity = 2.3; }                 /* a tighter pool of light, so the scene fades out on its own */
  var fx = realism(T, renderer, scene, key, floor, new T.Vector3(0, 0, 0), still);
  shadow.material.opacity = 0.45;

  /* ---- camera, size, loop ---- */
  var W = 1, H = 1, mx = 0, my = 0, cx = 0, cy = 0, t0 = performance.now(), raf = 0, seen = true, narrow = false;
  function size() {
    var r = box.getBoundingClientRect(); W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height)); narrow = inset || W < 900 || window.innerWidth < 900;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.setSize(W, H, false);
    cam.aspect = W / H; cam.fov = narrow ? 40 : 34; cam.clearViewOffset(); if (!narrow && !inset) cam.setViewOffset(W, H, -0.27 * W, -0.03 * H, W, H); cam.updateProjectionMatrix();
  }
  function frame(now) {
    raf = 0; var raw = ((now - t0) % (continuous ? LOOP : LOOP * 1.9)) / (continuous ? LOOP : LOOP * 1.9), t = FIX >= 0 ? FIX : still ? 0.95 : continuous ? raw : Math.min(0.955, raw * 1.9);   /* a scene plays once, then rests before it replays */
    step(t); fx(now);
    if (!still && FIX < 0) { cv.style.opacity = pose ? '1' : raw > 0.975 ? ((1 - raw) / 0.025).toFixed(3) : raw < 0.02 ? (raw / 0.02).toFixed(3) : '1'; if (pose) pose(now); if (bot.visible) { bot.position.y = 0.003 * Math.sin(now / 170); eye.material.color.setHex(Math.sin(now / 420) > 0.92 ? 0xffffff : PT); } }
    cx += (mx - cx) * 0.05; cy += (my - cy) * 0.05;
    var k = still || FIX >= 0 ? 1 : Math.min(1, (now - t0) / 2200); k = 1 - Math.pow(1 - k, 3);          /* the camera settles in on arrival */
    var sy = inset ? 0 : Math.max(0, Math.min(1, window.scrollY / 700));                                              /* and lifts away as the page scrolls */
    var drift = still ? 0 : Math.sin(now / 5200) * 0.35, d = (inset ? 1.12 : narrow ? 1.25 : 1.36) * zoom * (1 + 0.4 * (1 - k));
    cam.position.set((eyeAt[0] + cx * 1.5 + drift + (1 - k) * 1.6) * d, (eyeAt[1] - cy * 0.7 + (1 - k) * 1.4 + sy * 1.6) * d, (eyeAt[2] - sy * 0.9) * d);
    cam.lookAt(lookAt[0] + cx * 0.25, lookY, lookAt[2] - sy * 0.5);
    renderer.render(scene, cam);
    if (!still && seen) raf = requestAnimationFrame(frame);
  }
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }
  window.addEventListener('resize', function () { size(); kick(); });
  window.addEventListener('scroll', function () { if (still) kick(); }, { passive: true });
  window.addEventListener('pointermove', function (e) { mx = e.clientX / window.innerWidth * 2 - 1; my = e.clientY / window.innerHeight * 2 - 1; if (still) kick(); });
  if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { seen = es[0].isIntersecting; if (seen) kick(); }).observe(cv);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) kick(); });
  size(); kick();
  });
})();
