/* A real 3D view of the actual cap, on a 2D canvas.
 *
 * WHY NOT WEBGL. There is a WebGL viewer in this page already, but it is welded
 * to the slicer card's DOM - its toolbar ids, its clip plane, its support pass -
 * and it only exists once the slicer engine has loaded. The keycap card wants a
 * preview before any of that, so this is its own thing: a z-buffered software
 * rasteriser, about two hundred lines, no context to share and nothing to load.
 * A cap is around 3000 triangles, which is nothing.
 *
 * WHY NOT THE FLAT HEIGHTFIELD. The previous preview drew the relief top-down
 * with a light on it. That tells you what the legend looks like and nothing
 * about the cap - not the profile, not the row angle, not the skirt. A keycap
 * is an object and you have to see it as one to judge it.
 *
 * SHADING. Vertex normals are averaged only across edges that are actually
 * smooth - a crease threshold keeps the skirt-to-top edge sharp while the dish
 * stays round. Without that a dished top facets visibly at this grid density,
 * and with naive smoothing the cap looks melted.
 *
 * No DOM beyond the canvas it is handed. scripts/dev/test_keycap_view3d.mjs
 * runs the maths in node against a headless stub.
 */

(function (root) {
  'use strict';

  var CREASE = Math.cos(40 * Math.PI / 180);   // smooth below 40 deg, sharp above
  var colorReference = root.keycapColor ||
    (typeof module !== 'undefined' && module.exports ? require('./keycap-color.js') : null);

  function linearColor(hex) {
    return [1, 3, 5].map(function (offset) {
      var c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
  }
  function colorByte(linear) {
    if (linear <= 0) return 0;
    if (linear >= 1) return 255;
    return 255 * (linear <= 0.0031308 ? linear * 12.92
                  : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055);
  }

  function weldNormals(pos) {
    var n = pos.length / 9, i, k;
    var faceN = new Float32Array(n * 3);
    // face normals
    for (i = 0; i < n; i++) {
      var p = i * 9;
      var ux = pos[p+3]-pos[p], uy = pos[p+4]-pos[p+1], uz = pos[p+5]-pos[p+2];
      var vx = pos[p+6]-pos[p], vy = pos[p+7]-pos[p+1], vz = pos[p+8]-pos[p+2];
      var nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;
      var L = Math.hypot(nx, ny, nz) || 1;
      faceN[i*3] = nx/L; faceN[i*3+1] = ny/L; faceN[i*3+2] = nz/L;
    }
    // gather faces per welded position
    var map = Object.create(null), key;
    for (i = 0; i < n; i++) for (k = 0; k < 3; k++) {
      var q = i*9 + k*3;
      key = (Math.round(pos[q]*1000)) + ',' + (Math.round(pos[q+1]*1000)) + ',' + (Math.round(pos[q+2]*1000));
      (map[key] || (map[key] = [])).push(i);
    }
    // per-corner normal, averaging only across smooth edges
    var out = new Float32Array(n * 9);
    for (i = 0; i < n; i++) {
      var fx = faceN[i*3], fy = faceN[i*3+1], fz = faceN[i*3+2];
      for (k = 0; k < 3; k++) {
        var c = i*9 + k*3;
        key = (Math.round(pos[c]*1000)) + ',' + (Math.round(pos[c+1]*1000)) + ',' + (Math.round(pos[c+2]*1000));
        var list = map[key], ax = 0, ay = 0, az = 0;
        for (var j = 0; j < list.length; j++) {
          var g = list[j]*3, gx = faceN[g], gy = faceN[g+1], gz = faceN[g+2];
          if (gx*fx + gy*fy + gz*fz >= CREASE) { ax += gx; ay += gy; az += gz; }
        }
        var L2 = Math.hypot(ax, ay, az) || 1;
        out[c] = ax/L2; out[c+1] = ay/L2; out[c+2] = az/L2;
      }
    }
    return out;
  }

  function View(canvas, opts) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.o = opts || {};
    this.az = this.o.az == null ? -0.62 : this.o.az;
    this.el = this.o.el == null ? 0.48 : this.o.el;
    this.spin = this.o.spin !== false;
    this.vel = 0;
    this.pos = null;
    this.nrm = null;
    this.artStart = null;
    this.artColors = null;
    this.artTexture = null;
    this._textureFaces = null;
    this.appearance = { mode: 'solid', base: '#ed9db3', art: '#a8d6f0', useSourceColors: true };
    this._appearanceBase = linearColor(this.appearance.base);
    this._appearanceArt = linearColor(this.appearance.art);
    this.raf = 0;
    this.dragging = false;
    if (this.o.interactive !== false) this._bind();
  }

  /* Appearance is a view setting only. Source colors are LINEAR RGB, three
     floats per corner, aligned with the seated art. They are not inferred from
     height, normals or anatomy, and never become part of an exported STL. */
  View.prototype.setAppearance = function (appearance, opts) {
    var a = appearance || {};
    if (a.mode === 'color' || a.mode === 'solid') this.appearance.mode = a.mode;
    if (typeof a.base === 'string' && /^#[0-9a-f]{6}$/i.test(a.base)) {
      this.appearance.base = a.base.toLowerCase();
      this._appearanceBase = linearColor(this.appearance.base);
    }
    if (typeof a.art === 'string' && /^#[0-9a-f]{6}$/i.test(a.art)) {
      this.appearance.art = a.art.toLowerCase();
      this._appearanceArt = linearColor(this.appearance.art);
    }
    if (typeof a.useSourceColors === 'boolean') this.appearance.useSourceColors = a.useSourceColors;
    if (!opts || opts.draw !== false) this.draw();
    return this;
  };

  /* artStart is an exact FLOAT offset into positions, not a triangle number.
     Missing/invalid metadata means a single base material. Reset it for every
     mesh so a plain cap cannot inherit the previous model's material regions. */
  View.prototype.setMesh = function (positions, materials) {
    this.artStart = null;
    this.artColors = null;
    this.artTexture = null;
    this._textureFaces = null;
    if (!positions || !positions.length) { this.pos = null; this.nrm = null; this.draw(); return this; }
    var start = materials && materials.artStart;
    if (typeof start === 'number' && Number.isFinite(start) && start >= 0 &&
        start <= positions.length && start % 9 === 0) {
      this.artStart = start;
      var colors = materials.artColors, valid = colors && colors.length === positions.length - start;
      if (valid) for (var ci = 0; ci < colors.length; ci++) {
        if (typeof colors[ci] !== 'number' || !Number.isFinite(colors[ci]) || colors[ci] < 0 || colors[ci] > 1) {
          valid = false; break;
        }
      }
      if (valid) this.artColors = colors;
      var texture = materials.artTexture;
      if (colorReference && colorReference.validTextureReference(texture,positions.length-start)) {
        this.artTexture = texture;
        this._textureFaces = new Int8Array((positions.length-start)/9);
        this._textureFaces.fill(-1);
        for (var ti = 0; ti < texture.textures.length; ti++) {
          var region = texture.textures[ti];
          this._textureFaces.fill(ti,region.start/9,(region.start+region.count*3)/9);
        }
      }
    }
    var p = positions, i, k;
    var mn = [Infinity,Infinity,Infinity], mx = [-Infinity,-Infinity,-Infinity];
    for (i = 0; i < p.length; i += 3) for (k = 0; k < 3; k++) {
      if (p[i+k] < mn[k]) mn[k] = p[i+k];
      if (p[i+k] > mx[k]) mx[k] = p[i+k];
    }
    /* The engine builds a cap with +Z running FROM the top face TO the mouth,
       because that is the order the printer lays it down. A viewer wants it the
       other way up.

       Getting there needs a ROTATION, never a mirror: negating Z alone flips
       the winding and every face culls. So it turns 180 degrees about X -
       (x,y,z) -> (x, -y, -z), determinant +1.

       That the board's back (+Y in the engine) lands on display -Y is not a
       side effect to fix, it is the point. The camera sits on the +Y side, so
       display +Y is the NEAR side; sending the board's back to -Y therefore
       puts its FRONT towards the viewer, and a sculpted row leans the way it
       would on a desk. Rotating about X and Z instead keeps +Y as the back and
       shows you the cap from behind.

       Then sit it on the ground plane, so the contact shadow lands where the
       cap actually touches. */
    var cx = (mn[0]+mx[0])/2, cy = (mn[1]+mx[1])/2;
    var span = Math.max(mx[0]-mn[0], mx[1]-mn[1], mx[2]-mn[2]) || 1;
    var s = 1 / span;
    var q = new Float32Array(p.length);
    for (i = 0; i < p.length; i += 3) {
      q[i]   =  (p[i]   - cx) * s;
      q[i+1] = -(p[i+1] - cy) * s;
      q[i+2] =  (mx[2]  - p[i+2]) * s;
    }
    this.pos = q;
    this.nrm = weldNormals(q);
    this.height = (mx[2]-mn[2]) * s;
    this.draw();
    return this;
  };

  View.prototype._bind = function () {
    var self = this, last = null;
    function down(e) {
      self.dragging = true; self.spin = false;
      last = e.touches ? e.touches[0] : e;
      last = { x: last.clientX, y: last.clientY };
      e.preventDefault();
    }
    function move(e) {
      if (!self.dragging) return;
      var t = e.touches ? e.touches[0] : e;
      var dx = t.clientX - last.x, dy = t.clientY - last.y;
      last = { x: t.clientX, y: t.clientY };
      self.az -= dx * 0.011;
      self.el = Math.max(-0.25, Math.min(1.35, self.el + dy * 0.009));
      self.vel = -dx * 0.011;
      self.draw();
      e.preventDefault();
    }
    function up() {
      if (!self.dragging) return;
      self.dragging = false;
      // settle back to the full-resolution buffer
      if (Math.abs(self.vel) > 0.002) self._coast(); else self.draw();
    }
    this.c.addEventListener('mousedown', down);
    this.c.addEventListener('touchstart', down, { passive: false });
    window.addEventListener('mousemove', move);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('mouseup', up);
    window.addEventListener('touchend', up);
  };

  View.prototype._coast = function () {
    var self = this;
    cancelAnimationFrame(this.raf);
    (function step() {
      self.az += self.vel;
      self.vel *= 0.94;
      self.draw();
      if (Math.abs(self.vel) > 0.0012) self.raf = requestAnimationFrame(step);
      else self.draw();                    // one last pass at full resolution
    })();
  };

  View.prototype.autoSpin = function (on) {
    var self = this;
    cancelAnimationFrame(this.raf);
    this.spin = !!on;
    if (!on) return;
    (function step() {
      if (!self.spin) return;
      self.az += 0.006;
      self.draw();
      self.raf = requestAnimationFrame(step);
    })();
  };

  View.prototype.stop = function () { this.spin = false; cancelAnimationFrame(this.raf); };

  /* The camera, kept separate from the render so it can be tested. Every sign
     in here was wrong at least once and none of them showed up as an error -
     the code ran perfectly and drew the inside of an unlit cap seen from
     underneath. test_keycap_view3d.mjs asserts each one through this. */
  View.prototype._camera = function (W, H) {
    var ca = Math.cos(this.az), sa = Math.sin(this.az);
    /* Negated so a POSITIVE elevation looks DOWN on the cap, which is what
       every caller expects. Unnegated, el rises from underneath and the view
       climbs up into the stem cavity. */
    var ce = Math.cos(this.el), se = -Math.sin(this.el);
    var dist = this.o.dist || 3.1, fov = this.o.fov || 1.5;
    var scale = Math.min(W, H) * fov;
    var ox = W / 2, oy = H / 2 + Math.min(W, H) * 0.06;
    return {
      /* World to screen. Camera space runs +Z AWAY from the viewer, which is
         why the key light also has to carry a negative z. */
      project: function (x, y, z, out) {
        out = out || [0, 0, 0];
        var rx = x*ca - y*sa, ry = x*sa + y*ca;
        var zc = z - 0.32;
        var yv = ry*se + zc*ce;
        var zv = -ry*ce + zc*se + dist;
        if (zv < 0.05) zv = 0.05;
        out[0] = ox + rx / zv * scale;
        out[1] = oy - yv / zv * scale;
        out[2] = zv;
        return out;
      },
      rotN: function (x, y, z, out) {
        out = out || [0, 0, 0];
        var rx = x*ca - y*sa, ry = x*sa + y*ca;
        out[0] = rx; out[1] = ry*se + z*ce; out[2] = -ry*ce + z*se;
        return out;
      }
    };
  };

  /* Project a point in the view's own normalised model space to screen pixels.
     Exposed for tests and for future hit-testing. */
  View.prototype.project = function (x, y, z) {
    var dpr = Math.min((root.devicePixelRatio || 1), 1.6);
    var W = Math.max(1, Math.round(this.c.clientWidth * dpr)) || this.c.width;
    var H = Math.max(1, Math.round(this.c.clientHeight * dpr)) || this.c.height;
    return this._camera(W, H).project(x, y, z, [0, 0, 0]);
  };

  /* The render. Perspective, z-buffered, Gouraud-shaded, with a projected
     contact shadow drawn first so the cap sits on something. */
  View.prototype.draw = function () {
    var g = this.g, c = this.c;
    /* Two caps on the backing store, both of which matter on a phone. The
       device pixel ratio is held to 1.35 and the whole buffer to MAX_PX on its
       long edge: this is a software rasteriser, so cost is pixels, and a 3x
       retina buffer behind a 420 px canvas is 1.6 million of them per frame for
       detail nobody can see on a 13 mm object. Dragging drops it further -
       half resolution while the cap is moving, full the moment it settles. */
    var dpr = Math.min(root.devicePixelRatio || 1, 1.35);
    if (this.dragging || Math.abs(this.vel) > 0.0012) dpr *= 0.62;
    var W = Math.max(1, Math.round((c.clientWidth || c.width) * dpr));
    var H = Math.max(1, Math.round((c.clientHeight || c.height) * dpr));
    var MAX_PX = this.o.maxPx || 560;
    var lng = Math.max(W, H);
    if (lng > MAX_PX) { W = Math.round(W * MAX_PX / lng); H = Math.round(H * MAX_PX / lng); }
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    var css = this.o.tokens || {};
    g.clearRect(0, 0, W, H);

    if (!this.pos) return;

    var cam = this._camera(W, H);
    var project = cam.project, rotN = cam.rotN;

    var p = this.pos, nn = this.nrm, tris = p.length / 9;
    var a = [0,0,0], b = [0,0,0], d = [0,0,0], i;

    /* ---- contact shadow: the silhouette flattened onto the ground ---------

       ⚠️ THIS DREW NOTHING, and "nothing" is not a figure of speech: the net
       filled area was measured at exactly zero. Every triangle of a closed mesh
       is added to one path and filled with the default nonzero winding rule -
       and a closed mesh has as much area winding one way as the other, so the
       front faces and the back faces cancel to the pixel. The cap has been
       floating on a flat sweep this whole time, which is most of why it read as
       a render rather than a photograph: nothing grounds an object like the
       dark line where it meets the surface.

       Keeping only the front-winding triangles makes the path the silhouette
       union instead of a signed sum. And one blur cannot do the job a contact
       shadow does - the tight dark line under the skirt and the soft ambient
       spread are different distances - so it fills twice off one path. */
    var sil = (typeof Path2D === 'function') ? new Path2D() : null;
    var kept = 0;
    for (i = 0; i < tris; i++) {
      var q = i * 9;
      project(p[q],   p[q+1],   0, a);
      project(p[q+3], p[q+4],   0, b);
      project(p[q+6], p[q+7],   0, d);
      /* Screen-space signed area. Back-winding triangles are the underside of
         the same silhouette and subtract exactly what the top adds. */
      if ((b[0]-a[0]) * (d[1]-a[1]) - (b[1]-a[1]) * (d[0]-a[0]) <= 0) continue;
      kept++;
      if (sil) { sil.moveTo(a[0], a[1]); sil.lineTo(b[0], b[1]); sil.lineTo(d[0], d[1]); sil.closePath(); }
      else { g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(d[0], d[1]); }
    }
    if (kept) {
      g.save();
      g.fillStyle = css.shadow || 'rgba(0,0,0,0.55)';
      var m = Math.min(W, H);
      /* wide and faint first, then tight and dark on top of it */
      g.globalAlpha = 0.16;
      g.filter = 'blur(' + Math.max(2, Math.round(m * 0.024)) + 'px)';
      if (sil) g.fill(sil); else g.fill();
      g.globalAlpha = 0.34;
      g.filter = 'blur(' + Math.max(1, Math.round(m * 0.007)) + 'px)';
      if (sil) g.fill(sil); else g.fill();
      g.restore();
    }

    // ---- the cap ----------------------------------------------------------
    var img = g.getImageData(0, 0, W, H);
    var data = img.data;
    /* Reused, not reallocated. At a 560 px buffer this is a 300 KB typed array
       and allocating a fresh one per frame handed the collector a megabyte a
       second during a drag. */
    if (!this._zb || this._zb.length !== W * H) this._zb = new Float32Array(W * H);
    var zb = this._zb;
    zb.fill(Infinity);

    var base = css.base || [196, 188, 176];
    var colored = this.appearance.mode === 'color';
    var sourceColors = colored && this.appearance.useSourceColors ? this.artColors : null;
    var sourceTexture = colored && this.appearance.useSourceColors ? this.artTexture : null;
    var textureRGB = [0,0,0];
    /* Camera space here has +Z running AWAY from the viewer - project() builds
       zv as depth into the screen - so a face turned towards you carries a
       NEGATIVE z normal and the key light has to point the same way. With lz
       positive the whole cap renders near-black while its hidden back face
       lights up, which is what it did the first time. */
    var lx = -0.44, ly = 0.34, lz = -0.83;
    var LL = Math.hypot(lx, ly, lz); lx/=LL; ly/=LL; lz/=LL;

    /* ---- a lighting rig, instead of one lamp -----------------------------
       One lambert term and a flat 0.24 ambient is why the cap read as grey
       plastic: everything facing away from the single light collapses to the
       same dead value, so the whole shadow side is one flat patch with no form
       in it. A photograph of a small object almost never looks like that.

       Three terms, which is the least that reads as a material:

       KEY - the existing lamp, upper left and in front.
       FILL - a dimmer, cooler lamp from the opposite side. It does not
         pretend to be a second light source; it is what a white sweep bounces
         back, and it is the difference between a shadow side that has shape
         and one that is a silhouette.
       HEMISPHERE AMBIENT - ambient is not one number. Light arriving from
         above is the cool sky of the stage; light from below is warm bounce
         off the sweep the cap is standing on. Blending the two by the
         surface's up-facing component is what ties the object to the floor it
         was just given, and it costs one lerp.

       The specular is broadened from pow 40 to pow 18 and tinted towards the
       key rather than pure white, because cured resin is satin, not chrome -
       a tight white pinpoint on a matte object is the other half of the
       plastic look. */
    var fx = 0.52, fy = -0.20, fz = 0.83;
    var FL = Math.hypot(fx, fy, fz); fx/=FL; fy/=FL; fz/=FL;

    var KEY = 0.60, FILL = 0.26, AMB = 0.30;
    /* Tints as per-channel multipliers around 1.0, so the base colour still
       decides what the cap IS and these only say where the light came from. */
    var SKY = css.sky || [0.88, 0.95, 1.10];      // cool, from above
    var GND = css.ground || [1.10, 1.02, 0.90];   // warm bounce, from below
    var FILLT = [0.90, 0.96, 1.08];               // the fill is the cool one

    var va = [0,0,0], vb = [0,0,0], vc = [0,0,0];
    var na = [0,0,0], nb = [0,0,0], nc = [0,0,0];

    for (i = 0; i < tris; i++) {
      var t = i * 9;
      var isArt = this.artStart !== null && t >= this.artStart;
      var paint = isArt ? this._appearanceArt : this._appearanceBase;
      var colorOffset = isArt && sourceColors ? t - this.artStart : -1;
      var textureIndex = isArt && sourceTexture ? this._textureFaces[(t-this.artStart)/9] : -1;
      var textureJob = textureIndex >= 0 ? sourceTexture.textures[textureIndex] : null;
      var textureOffset = textureJob ? (t-this.artStart-textureJob.start)/3*2 : 0;
      project(p[t],   p[t+1], p[t+2], va);
      project(p[t+3], p[t+4], p[t+5], vb);
      project(p[t+6], p[t+7], p[t+8], vc);
      // back-face cull in screen space
      var area = (vb[0]-va[0])*(vc[1]-va[1]) - (vb[1]-va[1])*(vc[0]-va[0]);
      if (false) continue;
      rotN(nn[t],   nn[t+1], nn[t+2], na);
      rotN(nn[t+3], nn[t+4], nn[t+5], nb);
      rotN(nn[t+6], nn[t+7], nn[t+8], nc);

      var minX = Math.max(0, Math.floor(Math.min(va[0], vb[0], vc[0])));
      var maxX = Math.min(W-1, Math.ceil(Math.max(va[0], vb[0], vc[0])));
      var minY = Math.max(0, Math.floor(Math.min(va[1], vb[1], vc[1])));
      var maxY = Math.min(H-1, Math.ceil(Math.max(va[1], vb[1], vc[1])));
      if (maxX < minX || maxY < minY) continue;
      var inv = 1 / area;

      for (var y = minY; y <= maxY; y++) {
        for (var x = minX; x <= maxX; x++) {
          var px = x + 0.5, py = y + 0.5;
          var w0 = ((vb[0]-va[0])*(py-va[1]) - (vb[1]-va[1])*(px-va[0])) * inv;
          if (w0 < 0 || w0 > 1) continue;
          var w1 = ((va[0]-vc[0])*(py-vc[1]) - (va[1]-vc[1])*(px-vc[0])) * inv;
          if (w1 < 0 || w1 > 1) continue;
          var w2 = 1 - w0 - w1;
          if (w2 < 0 || w2 > 1) continue;
          // barycentric: w2 -> a, w1 -> b, w0 -> c
          var z = w2*va[2] + w1*vb[2] + w0*vc[2];
          var o = y*W + x;
          if (z >= zb[o]) continue;
          zb[o] = z;
          var nx = w2*na[0] + w1*nb[0] + w0*nc[0];
          var ny = w2*na[1] + w1*nb[1] + w0*nc[1];
          var nz = w2*na[2] + w1*nb[2] + w0*nc[2];
          var nL = 1 / (Math.hypot(nx, ny, nz) || 1);
          nx *= nL; ny *= nL; nz *= nL;
          var lam = nx*lx + ny*ly + nz*lz; if (lam < 0) lam = 0;
          var fil = nx*fx + ny*fy + nz*fz; if (fil < 0) fil = 0;
          /* Screen y grows downward, so -ny is how much the surface faces up. */
          var hemi = 0.5 - 0.5*ny; if (hemi < 0) hemi = 0; else if (hemi > 1) hemi = 1;
          var rim = 1 - Math.abs(nz); rim = rim*rim*rim*0.20;
          var spec = Math.pow(lam, 18) * 0.26;
          var key = KEY*lam + rim;
          var k4 = o*4;
          if (colored) {
            var cr = paint[0], cg = paint[1], cb = paint[2];
            if (colorOffset >= 0 || textureJob) {
              var cwa = w2/va[2], cwb = w1/vb[2], cwc = w0/vc[2], cw = 1/(cwa+cwb+cwc);
              var rgb = textureJob ? sourceTexture.baseColors : sourceColors;
              var rgbOffset = t-this.artStart;
              cr = (cwa*rgb[rgbOffset] + cwb*rgb[rgbOffset+3] + cwc*rgb[rgbOffset+6])*cw;
              cg = (cwa*rgb[rgbOffset+1] + cwb*rgb[rgbOffset+4] + cwc*rgb[rgbOffset+7])*cw;
              cb = (cwa*rgb[rgbOffset+2] + cwb*rgb[rgbOffset+5] + cwc*rgb[rgbOffset+8])*cw;
              if (textureJob) {
                var uv = textureJob.uvs;
                var u = (cwa*uv[textureOffset] + cwb*uv[textureOffset+2] + cwc*uv[textureOffset+4])*cw;
                var v = (cwa*uv[textureOffset+1] + cwb*uv[textureOffset+3] + cwc*uv[textureOffset+5])*cw;
                colorReference.samplePixel(textureJob,u,v,textureRGB);
                cr *= textureRGB[0]; cg *= textureRGB[1]; cb *= textureRGB[2];
              }
            }
            data[k4] = colorByte(cr*(AMB*(SKY[0]*hemi + GND[0]*(1-hemi)) + key + FILL*fil*FILLT[0]) + spec*252/255);
            data[k4+1] = colorByte(cg*(AMB*(SKY[1]*hemi + GND[1]*(1-hemi)) + key + FILL*fil*FILLT[1]) + spec*250/255);
            data[k4+2] = colorByte(cb*(AMB*(SKY[2]*hemi + GND[2]*(1-hemi)) + key + FILL*fil*FILLT[2]) + spec*246/255);
          } else {
          data[k4]   = Math.min(255, base[0]*(AMB*(SKY[0]*hemi + GND[0]*(1-hemi))
                                              + key + FILL*fil*FILLT[0]) + spec*252);
          data[k4+1] = Math.min(255, base[1]*(AMB*(SKY[1]*hemi + GND[1]*(1-hemi))
                                              + key + FILL*fil*FILLT[1]) + spec*250);
          data[k4+2] = Math.min(255, base[2]*(AMB*(SKY[2]*hemi + GND[2]*(1-hemi))
                                              + key + FILL*fil*FILLT[2]) + spec*246);
          }
          data[k4+3] = 255;
        }
      }
    }
    g.putImageData(img, 0, 0);
  };

  function attach(canvas, opts) { return new View(canvas, opts); }

  root.keycapView3d = { attach: attach, weldNormals: weldNormals, View: View };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.keycapView3d;
})(typeof window !== 'undefined' ? window : globalThis);
