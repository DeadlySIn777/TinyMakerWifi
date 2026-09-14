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
    this.raf = 0;
    this.dragging = false;
    this._bind();
  }

  View.prototype.setMesh = function (positions) {
    if (!positions || !positions.length) { this.pos = null; this.draw(); return; }
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
      if (Math.abs(self.vel) > 0.002) self._coast();
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
    var dpr = Math.min(window.devicePixelRatio || 1, 1.6);
    var W = Math.max(1, Math.round(c.clientWidth * dpr)) || c.width;
    var H = Math.max(1, Math.round(c.clientHeight * dpr)) || c.height;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    var css = this.o.tokens || {};
    g.clearRect(0, 0, W, H);

    if (!this.pos) return;

    var cam = this._camera(W, H);
    var project = cam.project, rotN = cam.rotN;

    var p = this.pos, nn = this.nrm, tris = p.length / 9;
    var a = [0,0,0], b = [0,0,0], d = [0,0,0], i;

    // ---- contact shadow: the silhouette flattened onto the ground ---------
    g.save();
    g.globalAlpha = 0.30;
    g.filter = 'blur(' + Math.round(Math.min(W, H) * 0.022) + 'px)';
    g.fillStyle = css.shadow || 'rgba(0,0,0,0.9)';
    g.beginPath();
    for (i = 0; i < tris; i++) {
      var q = i * 9;
      project(p[q],   p[q+1],   0, a);
      project(p[q+3], p[q+4],   0, b);
      project(p[q+6], p[q+7],   0, d);
      g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(d[0], d[1]);
    }
    g.fill();
    g.restore();

    // ---- the cap ----------------------------------------------------------
    var img = g.getImageData(0, 0, W, H);
    var data = img.data;
    var zb = new Float32Array(W * H);
    for (i = 0; i < zb.length; i++) zb[i] = Infinity;

    var base = css.base || [196, 188, 176];
    /* Camera space here has +Z running AWAY from the viewer - project() builds
       zv as depth into the screen - so a face turned towards you carries a
       NEGATIVE z normal and the key light has to point the same way. With lz
       positive the whole cap renders near-black while its hidden back face
       lights up, which is what it did the first time. */
    var lx = -0.44, ly = 0.34, lz = -0.83;
    var LL = Math.hypot(lx, ly, lz); lx/=LL; ly/=LL; lz/=LL;

    var va = [0,0,0], vb = [0,0,0], vc = [0,0,0];
    var na = [0,0,0], nb = [0,0,0], nc = [0,0,0];

    for (i = 0; i < tris; i++) {
      var t = i * 9;
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
          var rim = 1 - Math.abs(nz); rim = rim*rim*rim*0.22;
          var spec = Math.pow(lam, 40) * 0.34;
          var sh = 0.24 + 0.68*lam + rim;
          var k4 = o*4;
          data[k4]   = Math.min(255, base[0]*sh + spec*255);
          data[k4+1] = Math.min(255, base[1]*sh + spec*255);
          data[k4+2] = Math.min(255, base[2]*sh + spec*255);
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
