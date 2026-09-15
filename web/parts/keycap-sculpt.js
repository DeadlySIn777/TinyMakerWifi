/* An artisan cap: a sculpted object standing ON a keycap.
 *
 * WHY THIS EXISTS, AND WHY THE HEIGHT FIELD WAS NOT ENOUGH. keycap-skin.js
 * samples a generated model into a height on the top face, which protects the
 * stem completely and is the right answer for a legend. It is the WRONG answer
 * for an artisan cap, and looking at one printed makes that obvious: a height
 * field can only extrude a 2D shape upward. It has no undercuts, no overhangs,
 * no silhouette. You get an icon pushed up out of the plastic - embossing, not
 * sculpture - and at 2 mm it reads as a stamped plate.
 *
 * An artisan cap is an OBJECT on a cap. So the sculpt stays a real mesh: it is
 * scaled, seated, and emitted ALONGSIDE the cap as a second solid that
 * overlaps it.
 *
 * NO BOOLEAN, AND NO NEED FOR ONE. The slicer here is PrusaSlicer's libslic3r
 * compiled to WebAssembly, and it rasterises overlapping solids as their union
 * - the same thing that happens when you drop two intersecting parts into
 * PrusaSlicer on a desktop. That is what makes this safe without a CSG kernel:
 * a generated mesh with open edges and flipped windings cannot corrupt the cap,
 * because the two are never combined topologically. The cap is still built by
 * the engine, the stem is still exact, and the sculpt is just something sitting
 * on top of it.
 *
 * ⚠️ THE SEATING IS LOAD-BEARING. The sculpt must SINK into the cap far enough
 * that the union is one connected solid at every layer. Seated too shallow on a
 * dished top and the first layers of the sculpt are islands floating over the
 * dish. seatDepth defaults to more than the dish is deep for exactly that
 * reason, and check() refuses a seating that cannot bridge it.
 *
 * ⚠️ AND IT CHANGES HOW THE CAP PRINTS. A cap with a figure on top cannot be
 * printed face down - that buries the sculpt against the plate. It goes on its
 * side, leaning, supports on the skirt. printPose() works out the angle.
 *
 * No DOM, no imports - scripts/dev/test_keycap_sculpt.mjs runs it in node.
 */

(function (root) {
  'use strict';

  // This runs on the UI thread. Refuse an unresolved attachment check rather
  // than freezing the page or labelling an unfinished search as attached.
  var ANALYSIS_LIMITS = { triangles: 300000, shells: 128, work: 4000000 };
  function analysisFailure(reason) {
    var e = new Error('Attachment check is unresolved: ' + reason +
      '. Simplify the mesh or merge its disconnected pieces in a mesh editor, then import it again.');
    e.attachmentAnalysis = true; throw e;
  }
  function spend(ctx, n) {
    if (ctx && (ctx.left -= n == null ? 1 : n) < 0) analysisFailure('the geometry exceeds the analysis work limit');
  }
  function analysisContext(p, capTriangles) {
    if (!p || !p.length || p.length % 9 || !Number.isInteger(capTriangles) ||
        capTriangles < 1 || capTriangles >= p.length / 9)
      analysisFailure('the cap/sculpt triangle ranges are invalid');
    if (p.length / 9 > ANALYSIS_LIMITS.triangles)
      analysisFailure('more than ' + ANALYSIS_LIMITS.triangles.toLocaleString() + ' triangles');
    for (var i = 0; i < p.length; i++) if (!Number.isFinite(p[i]))
      analysisFailure('the mesh contains invalid coordinates');
    return { left: ANALYSIS_LIMITS.work, shells: 0 };
  }
  function unresolved(e, ctx) {
    return { shells: ctx ? ctx.shells : 0, anchored: 0, floating: [],
      unresolved: true, issue: e.message };
  }

  function bounds(p) {
    var mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (var i = 0; i < p.length; i += 3) for (var k = 0; k < 3; k++) {
      if (p[i+k] < mn[k]) mn[k] = p[i+k];
      if (p[i+k] > mx[k]) mx[k] = p[i+k];
    }
    return { mn: mn, mx: mx,
             size: [mx[0]-mn[0], mx[1]-mn[1], mx[2]-mn[2]],
             mid: [(mn[0]+mx[0])/2, (mn[1]+mx[1])/2, (mn[2]+mx[2])/2] };
  }

  /* Seat a sculpt on a cap and hand back one triangle soup containing both.
     The cap keeps the engine's coordinates - z from the top face DOWN to the
     mouth - so the sculpt has to grow in -z, out of the top. */
  function seat(cap, sculptPositions, opts) {
    var o = opts || {};
    if (!cap || !cap.positions) throw new Error('keycap-sculpt: no cap');
    if (!sculptPositions || sculptPositions.length < 9 || sculptPositions.length % 9)
      throw new Error('keycap-sculpt: the sculpt is not a triangle soup');

    var rotation = o.rotationDeg == null ? 0 : o.rotationDeg;
    var percent = o.scalePercent == null ? 100 : o.scalePercent;
    if (typeof rotation !== 'number' || !Number.isFinite(rotation) || rotation < 0 || rotation > 360)
      throw new Error('keycap-sculpt: artwork rotation must be 0–360 degrees');
    if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 50 || percent > 100)
      throw new Error('keycap-sculpt: artwork size must be 50–100 percent');
    if (rotation === 360) rotation = 0;
    // Rotate artwork before measuring its envelope. A wide figure turned on
    // a wide key must fit the new depth; changing only the outgoing vertices
    // after fitting could push it into the neighboring row. Zero is the old
    // path byte for byte. Neither this copy nor sizing touches the cap.
    var sculpt = sculptPositions;
    if (rotation) {
      var radians = rotation * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians);
      if (rotation % 90 === 0) { cos = Math.round(cos); sin = Math.round(sin); }
      sculpt = new Float32Array(sculptPositions.length);
      for (var v = 0; v < sculptPositions.length; v += 3) {
        sculpt[v] = sculptPositions[v] * cos - sculptPositions[v+1] * sin;
        sculpt[v+1] = sculptPositions[v] * sin + sculptPositions[v+1] * cos;
        sculpt[v+2] = sculptPositions[v+2];
      }
    }
    var sb = bounds(sculpt);
    if (sb.size[0] <= 0 || sb.size[1] <= 0 || sb.size[2] <= 0)
      throw new Error('keycap-sculpt: the sculpt is flat in one axis - it has no form to seat');

    var capW = cap.size.x, capD = cap.size.y;
    /* Artisans let a sculpt overhang the cap a little; the hard limit is the
       key pitch, or it fouls its neighbour on the board.

       THE PITCH IS NOT 19.05 FOR EVERY KEY. It is 19.05 PER UNIT, so a 2.25u
       Shift is allowed 42.86 mm and a 1u is allowed 19.05. Assuming the 1u
       number everywhere squeezed a Shift-key sculpt down to 18.65 mm - less
       than half the room it actually has - and for a scene with two figures on
       it that is the difference between two characters and two blobs. Depth is
       always one unit: keys are wider than 1u, never deeper. */
    var sxc = o.x || 0, syc = o.y || 0;          // where the sculpt is centred
    var pitchW = o.pitch || (19.05 * (cap.sizeU || 1));
    var pitchD = o.pitchD || 19.05;
    var spread = o.spread == null ? 1.06 : o.spread;
    var maxW = Math.min(capW * spread, pitchW - 0.4);
    var maxD = Math.min(capD * spread, pitchD - 0.4);
    var maxH = o.heightMm == null ? capW * 0.85 : o.heightMm;

    var k = Math.min(maxW / sb.size[0], maxD / sb.size[1], maxH / sb.size[2]);
    if (o.scale) k = o.scale;
    k *= percent / 100;                  // artwork only; aspect ratio retained

    /* ⚠️ WHERE THE FACE IS, MEASURED - NOT COMPUTED FROM THE PROFILE.

       This used to be max(0.8, dishDepth + 0.5): a guess at how far down the
       face sits, made from the dish depth alone. It ignored the row angle
       entirely, and then my attempt to add the row angle got the constant
       wrong - build() normalises the cap so its HIGHEST point is z = 0, and on
       a tilted row that point is the back corner of the face, putting the face
       at dish(x,y) + (y + topD/2)*|tan|. Adding y*tan without the topD/2 term
       leaves the base parallel to the face and 1.43 mm too shallow on a 13
       degree row.

       Measured overlap between the sculpt's underside and the face, before:
       DSA R3 +0.50, XDA R3 +0.50, SA R1 -1.00, SA R4 -0.18, CHERRY R3 -0.26,
       CHERRY R4 -0.93, OEM R3 -0.25, OEM R4 -0.91. Negative is not a thin
       joint - it is a second solid hanging in the air, sharing no volume with
       the cap, which the slicer prints as a separate object that comes off in
       the vat. Six of the eight combinations this engine ships.

       surfaceUnder() is in this file, ray-casts the cap, and reseat() already
       trusts it for exactly this question. Ask it. */
    var capTris = cap.positions.length / 9;
    var BITE = o.bite == null ? 0.8 : o.bite;      // check() calls under 0.60 an issue
    var footBox = { mn: [sxc - maxW * 0.25, syc - maxD * 0.25, 0],
                    mx: [sxc + maxW * 0.25, syc + maxD * 0.25, 0] };
    var faceZ = surfaceUnder(cap.positions, null, 0, capTris, footBox, o.rays || 5, true);
    var seatDepth = o.seatDepth != null ? o.seatDepth
                  : (faceZ != null ? faceZ + BITE
                                   : Math.max(0.8, (cap.dishDepth || 0.8) + 0.5));

    /* The cap's z runs from its top face DOWN to the mouth, so the sculpt has
       to grow in -z. Negating one axis is a MIRROR, not a rotation: it flips
       the handedness, and with it every triangle's winding and every normal.
       Left alone the sculpt renders pitch black with its faces pointing into
       itself, and a slicer that cares about winding would see it inside out.
       So each triangle's last two corners are swapped back as it is written -
       one mirror, one reversal, handedness restored. */
    /* THE FACE IS NOT LEVEL AND THE BASE PLANE WAS. seat() wrote a single
       constant z for the whole underside while keycap.js topField() tilts the
       top face by the row angle - so on a sculpted row the figure is welded to
       the high side and hangs over air on the low one. CHERRY R4 sweeps 3.71 mm
       across the face against a 1.35 mm seatDepth: a 2.4 mm gap that looked
       perfect on screen and prints as an overhang with nothing under it.

       The old anchorage test could not see it either, because it compared
       against z = 0 - the cap's highest point - which the high side satisfies
       on its own. Tilting the base by the same tangent the cap uses puts the
       whole underside on the face. */
    var out = new Float32Array(sculptPositions.length);
    var t, c, sx = sxc, sy = syc;
    var tanRow = Math.tan((o.rowAngle != null ? o.rowAngle : (cap.angle || 0)) * Math.PI / 180);
    var ORDER = [0, 2, 1];                       // the winding fix
    for (t = 0; t < sculptPositions.length; t += 9) {
      for (c = 0; c < 3; c++) {
        var src = t + ORDER[c] * 3, dst = t + c * 3;
        out[dst]     = (sculpt[src]     - sb.mid[0]) * k + sx;
        out[dst + 1] = (sculpt[src + 1] - sb.mid[1]) * k + sy;
        /* The slope pivots about the point that was SAMPLED, so the measured
           bite is the bite there and the base stays parallel to the face
           everywhere else. Pivoting about y = 0 instead is what made the
           constant wrong in the first place. */
        out[dst + 2] = -((sculpt[src + 2] - sb.mn[2]) * k) + seatDepth
                     + (out[dst + 1] - syc) * tanRow;
      }
    }

    var both = new Float32Array(cap.positions.length + out.length);
    both.set(cap.positions, 0);
    both.set(out, cap.positions.length);

    var fb = bounds(out), cb = bounds(cap.positions), whole = bounds(both);
    return {
      positions: both,
      capTriangles: cap.positions.length / 9,
      sculptTriangles: out.length / 9,
      triangles: both.length / 9,
      scale: +k.toFixed(4),
      rotationDeg: rotation,
      scalePercent: percent,
      seatDepth: +seatDepth.toFixed(2),
      /* MEASURED FROM THE MESH, not from the input times the scale. seat()
         tilts the base by the row angle, which makes the seated sculpt taller
         than sb.size[2]*k by the rise across its depth - and printPose() picks
         its lean from these numbers, so under-reporting the height chose a
         lean whose real footprint ran off the plate. fb is the bounds of what
         was actually written, eight lines up; footprintMm and overhangs below
         have always used it. */
      sculptMm: { x: +fb.size[0].toFixed(2), y: +fb.size[1].toFixed(2),
                  z: +fb.size[2].toFixed(2) },
      /* Total height of the finished piece: the cap plus however far the
         sculpt stands proud of its top face. build() puts the cap's HIGHEST
         point at z = 0 and z increases downward, so anything above the cap is
         negative and the proud part is -fb.mn[2]. The old arithmetic -
         sculpt height minus seat depth - assumed the sculpt sat flat and
         un-tilted, and was wrong by the row rise on every angled row. */
      totalHeightMm: +whole.size[2].toFixed(2),
      footprintMm: { x: +whole.size[0].toFixed(2), y: +whole.size[1].toFixed(2) },
      overhangs: +Math.max(0, cb.mn[0]-fb.mn[0], fb.mx[0]-cb.mx[0],
                            cb.mn[1]-fb.mn[1], fb.mx[1]-cb.mx[1]).toFixed(2),
      pitchMm: { x: +pitchW.toFixed(2), y: +pitchD.toFixed(2) },
      sizeU: cap.sizeU || 1
    };
  }

  /* ---- the diorama problem ----------------------------------------------
     A scene with two figures on it is the thing artisan caps are FOR, and it
     is also where this arrangement can fail silently.

     The cap and the sculpt print as a union because they overlap, and that
     works for any number of pieces - two figures that touch each other, or a
     base, fuse into one solid the same way. What does NOT work is a piece that
     touches nothing: a generator asked for "two Pokemon on a rock" can return
     one of them hovering a fraction of a millimetre off the rock, and it looks
     perfect on screen because the eye cannot see the gap. On the machine it is
     a separate object floating in mid air with no support under it, and it
     either fails or lands somewhere else in the vat.

     So: split the sculpt into connected shells, and work out which of them are
     anchored. A shell is anchored if it reaches down into the cap, or if it
     overlaps something else that is. Bounding boxes only select candidate
     pairs; actual surface contact or containment establishes attachment. */
  /* shells() hands back boxes, which is all the anchorage REPORT needed. To
     move a piece you also need to know WHICH triangles are in it, so the
     union-find lives here and shells() became a thin summary over it. Same
     algorithm and same answers - the old one is not re-implemented, it is
     re-exposed with the membership it was already computing and throwing away. */
  function shellParts(p, ctx) {
    var n = p.length / 9, parent = new Int32Array(n), i;
    spend(ctx, n);
    for (i = 0; i < n; i++) parent[i] = i;
    function find(a) { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; }
    function join(a, b) { a = find(a); b = find(b); if (a !== b) parent[b] = a; }
    var map = Object.create(null);
    // A shared vertex alone is a pin contact, not a solid connection. Connect
    // faces across ordinary two-face edges; a four-face touching edge must not
    // weld two separate solids into one supposedly attached shell.
    for (i = 0; i < n; i++) {
      var keys=[];
      for (var c=0;c<3;c++) { var q=i*9+c*3;
        // Five-micron rounding collapsed distinct vertices in detailed Meshy
        // triangles, creating four-face edges and dozens of false fragments.
        // A one-micron weld retains those features while still joining equal
        // triangle-soup vertices after float32 transforms.
        keys.push(Math.round(p[q]*1000)+','+Math.round(p[q+1]*1000)+','+Math.round(p[q+2]*1000)); }
      for(c=0;c<3;c++) {
        var a=keys[c],b=keys[(c+1)%3];if(a===b)continue;
        var key=a<b?a+'|'+b:b+'|'+a,edge=map[key];
        if(!edge)map[key]={first:i,second:-1,count:1};
        else {edge.second=i;edge.count++;}
      }
    }
    Object.keys(map).forEach(function(key){var e=map[key];if(e.count===2)join(e.first,e.second);});
    var groups = {}, order = [];
    for (i = 0; i < n; i++) {
      var r = find(i), g = groups[r];
      if (!g) { g = groups[r] = { tris: 0, idx: [], mn: [1e9, 1e9, 1e9], mx: [-1e9, -1e9, -1e9] }; order.push(g);
        if (ctx) { ctx.shells = order.length;
          if (order.length > ANALYSIS_LIMITS.shells) analysisFailure('more than ' + ANALYSIS_LIMITS.shells + ' disconnected pieces'); } }
      g.tris++; g.idx.push(i);
      for (var v = 0; v < 9; v += 3) for (var k = 0; k < 3; k++) {
        var val = p[i * 9 + v + k];
        if (val < g.mn[k]) g.mn[k] = val;
        if (val > g.mx[k]) g.mx[k] = val;
      }
    }
    return order;
  }

  function shells(p) {
    return shellParts(p).map(function(g){return {tris:g.tris,mn:g.mn,mx:g.mx};});
  }

  /* Do the two boxes share any ground in plan? At module scope because both
     reseat() and anchorage() ask it - it used to live inside reseat, and
     anchorage's gap measurement could not see it. */
  function planOverlap(a, b, slack) {
    slack = slack || 0;
    return !(a.mn[0] - slack > b.mx[0] || b.mn[0] - slack > a.mx[0] ||
             a.mn[1] - slack > b.mx[1] || b.mn[1] - slack > a.mx[1]);
  }

  function boxesTouch(a, b, slack) {
    for (var k = 0; k < 3; k++)
      if (a.mn[k] - slack > b.mx[k] || b.mn[k] - slack > a.mx[k]) return false;
    return true;
  }


  function capPart(p,count) {
    var idx=[],mn=[Infinity,Infinity,Infinity],mx=[-Infinity,-Infinity,-Infinity];
    for(var t=0;t<count;t++){idx.push(t);for(var v=0;v<3;v++)for(var k=0;k<3;k++){
      var q=p[t*9+v*3+k];mn[k]=Math.min(mn[k],q);mx[k]=Math.max(mx[k],q);}}
    return {idx:idx,mn:mn,mx:mx};
  }
  // Bounding boxes reject distant shells. Attachment requires actual surface
  // contact or containment. A small BVH avoids a quadratic triangle-pair scan.
  function contactTree(p, part, ctx) {
    if (part._contactTree) return part._contactTree;
    spend(ctx, part.idx.length);
    var items = part.idx.map(function (t) {
      var v = [], mn = [Infinity,Infinity,Infinity], mx = [-Infinity,-Infinity,-Infinity];
      for (var i=0;i<3;i++) { var q=[p[t*9+i*3],p[t*9+i*3+1],p[t*9+i*3+2]];
        v.push(q); for(var k=0;k<3;k++){mn[k]=Math.min(mn[k],q[k]);mx[k]=Math.max(mx[k],q[k]);} }
      return {v:v,mn:mn,mx:mx};
    });
    /* Build only branches a contact query actually reaches. Previously every
       level sorted every triangle before the first intersection test: a real
       30k Meshy sculpt plus the fine cap exhausted the entire work allowance
       constructing trees. Spatial partitioning is linear per visited branch;
       exact bounds and the same narrow-phase tests still decide attachment. */
    function tree(lo,hi) {
      spend(ctx, hi-lo);
      var n={mn:[Infinity,Infinity,Infinity],mx:[-Infinity,-Infinity,-Infinity],lo:lo,hi:hi};
      for(var i=lo;i<hi;i++)for(var k=0;k<3;k++){
        n.mn[k]=Math.min(n.mn[k],items[i].mn[k]);n.mx[k]=Math.max(n.mx[k],items[i].mx[k]);}
      if(hi-lo<=8)n.items=items.slice(lo,hi);
      return n;
    }
    function expand(n) {
      if(n.items||n.left)return;
      var axis=0;for(var k=1;k<3;k++)if(n.mx[k]-n.mn[k]>n.mx[axis]-n.mn[axis])axis=k;
      var pivot=n.mn[axis]+n.mx[axis],mid=n.lo;
      for(var i=n.lo;i<n.hi;i++){
        spend(ctx);
        if(items[i].mn[axis]+items[i].mx[axis]<pivot){var swap=items[mid];items[mid++]=items[i];items[i]=swap;}
      }
      // Coincident centres or highly skewed geometry must not make an empty
      // child or a linear-depth tree. Index partitioning remains conservative:
      // children get exact bounds, so it can only cost work, never invent contact.
      var count=n.hi-n.lo;
      if(mid-n.lo<count/10||n.hi-mid<count/10)mid=n.lo+(count>>1);
      n.left=tree(n.lo,mid);n.right=tree(mid,n.hi);
    }
    part._contactTree={root:tree(0,items.length),items:items,expand:expand};return part._contactTree;
  }
  function sub3(a,b){return [a[0]-b[0],a[1]-b[1],a[2]-b[2]];}
  function dot3(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
  function cross3(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
  var CONTACT_EPS = 0.00001;
  function trianglesCross(a,b) {
    if(!boxesTouch(a,b,0.00001))return false;
    var ae=[sub3(a.v[1],a.v[0]),sub3(a.v[2],a.v[1]),sub3(a.v[0],a.v[2])];
    var be=[sub3(b.v[1],b.v[0]),sub3(b.v[2],b.v[1]),sub3(b.v[0],b.v[2])];
    var an=cross3(ae[0],ae[1]),bn=cross3(be[0],be[1]),axes=[an,bn];
    if(dot3(an,an)<1e-20||dot3(bn,bn)<1e-20)return false;
    // A touching tip, edge, or coplanar face is not a volume crossing. Both
    // triangles must actually straddle the other triangle's plane.
    function straddles(v, origin, normal) {
      var d=v.map(function(q){return dot3(sub3(q,origin),normal);});
      var eps=CONTACT_EPS*Math.sqrt(dot3(normal,normal));
      return Math.min.apply(null,d)<-eps && Math.max.apply(null,d)>eps;
    }
    if(!straddles(a.v,b.v[0],bn)||!straddles(b.v,a.v[0],an))return false;
    for(var i=0;i<3;i++){
      axes.push(cross3(an,ae[i]),cross3(bn,be[i])); // coplanar separation
      for(var j=0;j<3;j++)axes.push(cross3(ae[i],be[j]));
    }
    for(var k=0;k<axes.length;k++){
      var axis=axes[k],len=Math.sqrt(dot3(axis,axis));if(len<1e-12)continue;
      var pa=a.v.map(function(v){return dot3(v,axis);}),pb=b.v.map(function(v){return dot3(v,axis);});
      var amin=Math.min.apply(null,pa),amax=Math.max.apply(null,pa);
      var bmin=Math.min.apply(null,pb),bmax=Math.max.apply(null,pb),eps=CONTACT_EPS*len;
      if(amax<bmin-eps||bmax<amin-eps)return false;
      // The two plane-straddle tests alone can still meet at a single segment
      // endpoint. On axes where both triangles have extent, require overlap
      // beyond that endpoint; the flat normal axes were handled above.
      if(amax-amin>eps&&bmax-bmin>eps&&Math.min(amax,bmax)-Math.max(amin,bmin)<=eps)return false;
    }
    return true;
  }
  function pointOnTriangle(point, v) {
    var u=sub3(v[1],v[0]),w=sub3(v[2],v[0]),q=sub3(point,v[0]);
    var n=cross3(u,w),nn=dot3(n,n);
    if(nn<1e-20)return false;
    if(Math.abs(dot3(q,n))>CONTACT_EPS*Math.sqrt(nn))return false;
    var uu=dot3(u,u),uw=dot3(u,w),ww=dot3(w,w),qu=dot3(q,u),qw=dot3(q,w);
    var den=uu*ww-uw*uw;
    if(!(den>0))return false;
    var s=(ww*qu-uw*qw)/den,t=(uu*qw-uw*qu)/den;
    return s>=-1e-7&&t>=-1e-7&&s+t<=1+1e-7;
  }
  function pointInside(point,tree,ctx) {
    // Strict containment is impossible outside (or on) the solid's bounds.
    // This avoids a full winding sum for every cap triangle when a small
    // curved petal only overlaps a tiny part of the cap's bounding box.
    for(var k=0;k<3;k++)if(point[k]<=tree.root.mn[k]+CONTACT_EPS||point[k]>=tree.root.mx[k]-CONTACT_EPS)return false;
    var items=tree.items;
    var angle=0;
    for(var i=0;i<items.length;i++){
      spend(ctx);
      var v=items[i].v,a=sub3(v[0],point),b=sub3(v[1],point),c=sub3(v[2],point);
      if(pointOnTriangle(point,v))return false;
      var al=Math.hypot.apply(null,a),bl=Math.hypot.apply(null,b),cl=Math.hypot.apply(null,c);
      if(Math.min(al,bl,cl)<CONTACT_EPS)return false;
      angle+=2*Math.atan2(dot3(a,cross3(b,c)),al*bl*cl+dot3(a,b)*cl+dot3(b,c)*al+dot3(c,a)*bl);
    }
    return Number.isFinite(angle)&&Math.abs(Math.abs(angle)-Math.PI*4)<0.001;
  }
  function partsContact(ap,a,bp,b,ctx) {
    if(!a.idx.length||!b.idx.length||!boxesTouch(a,b,0.00001))return false;
    var at=contactTree(ap,a,ctx),bt=contactTree(bp,b,ctx);
    function visit(x,y){
      spend(ctx);
      if(!boxesTouch(x,y,0.00001))return false;
      if(x.items&&y.items){
        for(var i=0;i<x.items.length;i++)for(var j=0;j<y.items.length;j++){
          spend(ctx);if(trianglesCross(x.items[i],y.items[j]))return true;
        }
        return false;
      }
      at.expand(x);bt.expand(y);
      return x.items ? visit(x,y.left)||visit(x,y.right) :
        y.items ? visit(x.left,y)||visit(x.right,y) :
        visit(x.left,y.left)||visit(x.left,y.right)||visit(x.right,y.left)||visit(x.right,y.right);
    }
    if(visit(at.root,bt.root)||pointInside(at.items[0].v[0],bt,ctx)||pointInside(bt.items[0].v[0],at,ctx))return true;
    // Aligned and coincident boxes may have no strictly interior vertex and
    // no transverse face crossings. Test face centres, then probes just on
    // either side; only a point strictly INSIDE BOTH solids proves overlap.
    function probes(from,to) {
      for(var i=0;i<from.items.length;i++) {
        spend(ctx);
        var v=from.items[i].v,c=[0,0,0];
        for(var k=0;k<3;k++)c[k]=(v[0][k]+v[1][k]+v[2][k])/3;
        if(pointInside(c,to,ctx))return true;
        var n=cross3(sub3(v[1],v[0]),sub3(v[2],v[0])),len=Math.sqrt(dot3(n,n));
        if(len<1e-10)continue;
        for(var sign=-1;sign<=1;sign+=2) {
          var q=c.map(function(x,k){return x+sign*n[k]/len*CONTACT_EPS*4;});
          // Test the other solid first: nearly all cap-face probes are outside
          // the small sculpt, so they need no winding sum against the cap.
          if(pointInside(q,to,ctx)&&pointInside(q,from,ctx))return true;
        }
      }
      return false;
    }
    return probes(at,bt)||probes(bt,at);
  }

  /* Which pieces of a seated sculpt are actually attached to something. */
  function anchorage(seatedPositions, capTriangles, opts) {
    var ctx;
    try { ctx=analysisContext(seatedPositions,capTriangles);return analyseAnchorage(seatedPositions,capTriangles,opts,ctx); }
    catch(e){if(e.attachmentAnalysis)return unresolved(e,ctx);throw e;}
  }
  function analyseAnchorage(seatedPositions, capTriangles, opts, ctx) {
    var o = opts || {};
    var slack = o.slack == null ? 0.15 : o.slack;   // mm of tolerable gap
    var sc = seatedPositions.slice(capTriangles * 9);
    /* shellParts, not shells: identical grouping, and it also hands back each
       shell's triangle indices - which gapUnder() below needs to ray-cast one
       shell against another. */
    var parts = shellParts(sc,ctx);
    var capSolid = capPart(seatedPositions, capTriangles);
    /* "z >= 0" WAS THE WRONG TEST and it is the reason a landed-but-still-
       floating piece could pass. z = 0 is the cap's highest point, not its
       face; a piece parked between the two satisfies the old test while
       touching nothing. Ray-cast the cap under the shell and compare against
       the surface that is actually there.

       The cheap test is kept as a REJECT only, which is the direction it is
       sound in: the surface is always at z >= 0, so a shell that cannot reach
       0 certainly cannot reach the surface, and that one needs no rays. */
    var rays = Math.min(15,Math.max(1,Math.floor(o.rays||5)));
    var anchored = parts.map(function (g) {
      if (g.mx[2] < 0) return false;
      var s = surfaceUnder(seatedPositions, null, 0, capTriangles, g, rays, true,ctx);
      return s !== null && g.mx[2] >= s - slack && partsContact(sc,g,seatedPositions,capSolid,ctx);
    });
    var changed = true, i, j;
    while (changed) {
      changed = false;
      for (i = 0; i < parts.length; i++) {
        if (anchored[i]) continue;
        for (j = 0; j < parts.length; j++) {
          if (i === j || !anchored[j]) continue;
          spend(ctx);
          if (partsContact(sc, parts[i], sc, parts[j],ctx)) { anchored[i] = true; changed = true; break; }
        }
      }
    }
    /* EVERYTHING ELSE MEANS EVERYTHING ELSE. This measured to the cap alone -
       lo = 0, hi = capTriangles - while anchorage() had just spent its whole
       body reasoning about shell-to-shell support, so a figure hovering
       0.16 mm above a base that is itself on the cap was reported as "floating
       1.36 mm clear of everything else". It is 1.36 mm clear of the CAP, and
       0.16 mm clear of the thing it is actually above, and check() prints the
       wrong one of those two. Take the shallowest of the cap and every other
       shell that overlaps it in plan, and name what it is clear of. */
    function gapUnder(f) {
      var best = null, what = null;
      var cz = surfaceUnder(seatedPositions, null, 0, capTriangles, f, rays, true,ctx);
      if (cz != null) { best = cz - f.mx[2]; what = 'the cap'; }
      for (var q = 0; q < parts.length; q++) {
        if (parts[q] === f || parts[q].tris <= 2) continue;
        if (!planOverlap(f, parts[q], slack)) continue;
        var sz = surfaceUnder(sc, parts[q].idx, 0, 0, f, rays,false,ctx);
        if (sz == null) continue;
        var d = sz - f.mx[2];
        if (d < -0.001) continue;                      // that one is above it
        if (best == null || d < best) { best = d; what = 'the piece under it'; }
      }
      return { mm: best == null ? -f.mx[2] : best, of: what || 'the plate' };
    }
    var floating = [];
    for (i = 0; i < parts.length; i++)
      if (!anchored[i] && parts[i].tris > 2) {
        var gap=gapUnder(parts[i]);
        floating.push({ triangles: parts[i].tris,
                        sizeMm: [ +(parts[i].mx[0]-parts[i].mn[0]).toFixed(2),
                                  +(parts[i].mx[1]-parts[i].mn[1]).toFixed(2),
                                  +(parts[i].mx[2]-parts[i].mn[2]).toFixed(2) ],
                        /* TO THE MATERIAL, not to z = 0. This reported the
                           piece's height above the normalisation plane, and
                           check() prints it as "floating N mm clear of
                           everything else" - a different quantity, and always
                           wrong on a dished or tilted face, which is every
                           face this engine makes. Measure to the surface
                           actually under it. */
                        gapMm: +gap.mm.toFixed(2),
                        gapOf: gap.of });
      }
    return { shells: parts.length, anchored: anchored.filter(Boolean).length,
             floating: floating };
  }

  /* ---- where the surface actually is ------------------------------------

     ⚠️ THE FIRST VERSION OF reseat() LANDED PIECES ON z = 0 AND THAT PLANE IS
     NOT THE CAP. z = 0 is where build() normalises the cap's single HIGHEST
     point; the top face falls away from it by the dish depth and the row
     angle, so the real surface under a centred figure is 0.80 mm down on XDA
     and 2.81 mm down on SA R1. seat() has always known this - it sinks the
     whole sculpt by dishDepth + 0.5 for exactly this reason - and check()
     calls anything shallower than 0.60 mm an outright issue.

     So reseat moved a floating piece from one patch of mid air to another,
     then set anchored = true and reported stillFloating: 0. Because
     anchorage() tested the same wrong plane, check() flipped from ok:false to
     ok:true and the card told the owner the piece "would have printed in mid
     air" - past tense - about a piece that was still in mid air. A detector
     that had been right was talked out of it by its own repair. That is worse
     than the bug it was written for, because the old failure at least said no.

     Bounding boxes cannot fix this and were the second half of the same fault:
     landing on a target shell's box TOP puts a piece over the hole in an arch,
     a ring or a horseshoe onto nothing, and then the box test agrees - because
     reseat moved it until the boxes touched. It manufactured the evidence for
     its own success.

     The only honest answer is to measure. Drop a vertical ray on a grid across
     the piece's plan footprint, take the TOP surface each ray finds (smallest
     z, since z runs down into the cap), and land on the DEEPEST of those tops
     so the whole footprint makes contact rather than one lucky corner. If no
     ray finds anything, there is nothing under that piece and it is not landed
     at all - it stays floating and check() keeps refusing the scene, which is
     the correct outcome for geometry that translation cannot save. */

  function triZAt(p, t, x, y) {
    var ax = p[t],     ay = p[t + 1], az = p[t + 2],
        bx = p[t + 3], by = p[t + 4], bz = p[t + 5],
        cx = p[t + 6], cy = p[t + 7], cz = p[t + 8];
    var d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (d > -1e-12 && d < 1e-12) return null;          // edge-on in plan
    var l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d;
    var l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d;
    var l3 = 1 - l1 - l2;
    if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) return null;
    return l1 * az + l2 * bz + l3 * cz;
  }

  /* The highest material at (x,y) - smallest z, because z runs downward. */
  function rayTop(p, idx, lo, hi, x, y, ctx) {
    spend(ctx,idx ? idx.length : hi-lo);
    var top = null, k, t, z;
    if (idx) {
      for (k = 0; k < idx.length; k++) {
        z = triZAt(p, idx[k] * 9, x, y);
        if (z !== null && (top === null || z < top)) top = z;
      }
    } else {
      for (t = lo * 9; t < hi * 9; t += 9) {
        z = triZAt(p, t, x, y);
        if (z !== null && (top === null || z < top)) top = z;
      }
    }
    return top;
  }

  /* The surface under a footprint. Two rules, and WHICH ONE depends on what is
     being asked about - see centreFirst.

     The obvious rule - "take the DEEPEST top across the footprint, so the whole
     base makes contact" - is wrong the moment a piece overhangs the cap, which
     artisan caps do on purpose. The corner rays then land on the SKIRT, several
     millimetres down the side, and that becomes the target: the sculpt's own
     base gets reported as floating and dragged down through the cap. The test
     suite caught it immediately, with three floaters in a scene that has one.

     The centre ray is the honest one. Surface variation across a 6 mm footprint
     on a dished top is a few tenths of a millimetre - less than the bite - so
     landing on the middle and biting in 0.6 to 1.0 mm makes contact across the
     whole base anyway, without letting one corner off the edge decide.

     When the centre misses there is a hole under the piece: an arch, a ring, a
     horseshoe. Then the grid answers, and it answers with the SHALLOWEST hit,
     which cannot bury the piece. If nothing is hit at all, nothing is there -
     return null and let the caller refuse to land it.

     ALL OF THAT REASONING IS ABOUT THE CAP, and it does not carry to a shell
     the generator produced - hence centreFirst, passed true by the four cap
     callers and by nobody else. */
  function surfaceUnder(p, idx, lo, hi, box, n, centreFirst, ctx) {
    n = n || 5;
    /* THE CENTRE RAY IS ONLY SOUND FOR THE CAP, and it used to be taken for
       everything. Its justification is that a keycap's top face varies by a
       few tenths of a millimetre across a footprint, so the middle stands for
       the whole. A GENERATED SHELL makes no such promise: ask the centre of a
       bowl and it answers with the FLOOR of the bowl, so a figure standing on
       the rim was dropped inside it - a repair that destroys the scene while
       reporting success. Arbitrary geometry therefore gets the grid and the
       SHALLOWEST hit below, which cannot bury anything. The cap keeps the
       cheap path, because there the claim is actually true. */
    if (centreFirst) {
      var cx = (box.mn[0] + box.mx[0]) / 2, cy = (box.mn[1] + box.mx[1]) / 2;
      var c = rayTop(p, idx, lo, hi, cx, cy,ctx);
      if (c !== null) return c;
    }
    var best = null, a, b, x, y, z;
    var w = box.mx[0] - box.mn[0], d = box.mx[1] - box.mn[1];
    for (a = 0; a < n; a++) for (b = 0; b < n; b++) {
      x = box.mn[0] + w * (a + 0.5) / n;
      y = box.mn[1] + d * (b + 0.5) / n;
      z = rayTop(p, idx, lo, hi, x, y,ctx);
      if (z !== null && (best === null || z < best)) best = z;
    }
    return best;
  }

  /* ---- and then DO something about it -----------------------------------

     anchorage() was written to catch the diorama failure and it did: it found
     the hovering figure every time. It was also the end of the road. check()
     put the words into a report nobody rendered, the mesh went to the plate
     unchanged, and a piece that was floating on screen was still floating on
     the machine. A detector with no hands is not a safety net.

     So: drop it. A floating shell is a figure the generator forgot to stand on
     anything, and the fix a person would make is to lower it until it lands.
     The cap's z runs from the top face DOWN, so "lower" is +z, and the thing a
     piece lands on is whichever anchored shell sits below it - the smallest
     positive distance from this shell's bottom to that shell's top, counting
     only pieces that overlap it in plan. Nothing below it in plan means it
     lands on the cap.

     TOUCHING IS NOT ENOUGH. Two solids that meet on a plane share no volume,
     and the slicer unions by rasterising volume - they would print as two
     objects that happen to kiss. So it goes in by a bite: a fifth of the
     piece's own height, between 0.2 and 0.6 mm, deep enough to fuse and
     shallow enough not to swallow a figure's feet.

     Nothing moves sideways and nothing is scaled: two characters the generator
     placed beside each other stay beside each other, and the only thing that
     changes is how far down one of them sits. Every move is reported in
     millimetres, because a mesh that silently rearranged itself is worse than
     one that failed loudly. */
  function reseat(seated, opts) {
    if (!seated || !seated.positions || seated.capTriangles == null)
      throw new Error('keycap-sculpt: reseat needs a seated result');
    var ctx;
    try { ctx=analysisContext(seated&&seated.positions,seated&&seated.capTriangles);
      return analyseReseat(seated,opts,ctx); }
    catch(e){if(!e.attachmentAnalysis)throw e;
      var result=Object.assign({},seated);result.moved=[];result.stillFloating=null;
      result.unresolved=true;result.issue=e.message;return result;}
  }
  function analyseReseat(seated, opts, ctx) {
    var o = opts || {};
    if (!seated || !seated.positions || seated.capTriangles == null)
      throw new Error('keycap-sculpt: reseat needs a seated result');
    var capTris = seated.capTriangles;
    var out = new Float32Array(seated.positions);      // a copy; the caller keeps theirs
    var sc = out.subarray(capTris * 9);
    var parts = shellParts(sc,ctx);
    var capSolid = capPart(out,capTris);
    var slack = o.slack == null ? 0.15 : o.slack;
    var maxDrop = o.maxDropMm == null ? 24 : o.maxDropMm;
    var rays = Math.min(15,Math.max(1,Math.floor(o.rays||5)));

    var anchored = parts.map(function (g) { return reaches(g); });
    var moved = [], guard = 0, i, j;
    /* How tall the whole sculpt stands, used to tell a nudge from a relocation. */
    var sb = bounds(sc), span = sb.size[2];

    /* Anchored means "it reaches the material of the cap", measured, not
       "its box crosses z = 0". */
    function reaches(g) {
      var s = surfaceUnder(out, null, 0, capTris, g, rays, true,ctx);
      return s !== null && g.mx[2] >= s - slack && partsContact(sc,g,out,capSolid,ctx);
    }
    function settle(g, dz) {
      for (var q = 0; q < g.idx.length; q++) {
        var base = g.idx[q] * 9;
        for (var v = 2; v < 9; v += 3) sc[base + v] += dz;
      }
      g.mn[2] += dz; g.mx[2] += dz; delete g._contactTree;
    }

    /* Seeded from the cap and then spread through verified contact, the way
       anchorage() reports it: a figure standing on the base never touches the
       cap, and dropping it would shove it through the rock it stands on. */
    var spread = true;
    while (spread) {
      spread = false;
      for (i = 0; i < parts.length; i++) {
        if (anchored[i]) continue;
        for (j = 0; j < parts.length; j++) {
          if (i === j || !anchored[j]) continue;
          spend(ctx);
          if (partsContact(sc, parts[i], sc, parts[j],ctx)) { anchored[i] = true; spread = true; break; }
        }
      }
    }

    /* BOTTOM-UP, OR THE ANSWER DEPENDS ON TRIANGLE ORDER. Only anchored shells
       are landing targets, so a floater sitting on another floater is dropped
       straight past it if it happens to be considered first - and which one is
       considered first came out of shellParts(), which is soup order. The same
       scene could resolve two ways depending on how the generator happened to
       emit its triangles. Lowest first (largest z, since z runs down into the
       cap) means the thing underneath always lands before the thing on top of
       it, and the loop below then finds a real target waiting. */
    var order = [];
    for (i = 0; i < parts.length; i++) order.push(i);
    order.sort(function (a, b) { return parts[b].mx[2] - parts[a].mx[2]; });

    while (guard++ < parts.length + 2) {
      var did = false;
      for (var oi = 0; oi < order.length; oi++) {
        i = order[oi];
        if (anchored[i] || parts[i].tris <= 2) continue;
        var f = parts[i], best = null, onto = null;

        /* A shell is only a landing target where it has MATERIAL under the
           footprint. An arch supports nothing over its opening, and its
           bounding box says otherwise. */
        for (j = 0; j < parts.length; j++) {
          if (i === j || !anchored[j]) continue;
          if (!planOverlap(f, parts[j], slack)) continue;
          var sz = surfaceUnder(sc, parts[j].idx, 0, 0, f, rays,false,ctx);
          if (sz === null) continue;
          var d = sz - f.mx[2];
          if (d >= -slack && (best === null || d < best)) { best = d < 0 ? 0 : d; onto = 'the piece under it'; }
        }
        if (best === null) {
          var cz = surfaceUnder(out, null, 0, capTris, f, rays, true,ctx);
          if (cz !== null) { best = cz - f.mx[2]; if (best < 0) best = 0; onto = 'the cap'; }
        }
        /* Nothing under it at all. Translation cannot save this piece, so it
           is left exactly where it is and stays unanchored - check() goes on
           refusing the scene, which is the honest outcome. */
        if (best === null) continue;

        /* The bite can never be shallower than the 0.60 mm check() itself
           calls too shallow, or reseat would be landing pieces to a standard
           its own validator rejects. */
        var h = f.mx[2] - f.mn[2];
        var bite = Math.min(1.0, Math.max(0.6, h * 0.2));
        var dz = best + bite;
        /* A REPAIR IS A NUDGE. Anything more is relocating the artwork.
           A figure the generator perched on top of an arch has nothing under it
           but the cap, twelve millimetres down - and dropping it there does
           produce a printable object, just not the one anybody designed. It
           would land inside the arch's opening, sitting on the floor, and the
           only sign would be a number in a note. So a drop that is large for
           the piece being moved is refused, the piece is left where the
           generator put it, and check() goes on saying the scene is wrong -
           which it is, and which is the generator's to fix.

           ⚠️ "LARGE" IS MEASURED AGAINST THE PIECE, NOT THE FIGURE. This used
           to be 0.6 * span, and span is the z-extent of the WHOLE sculpt - so
           one tall object anywhere in it raised the ceiling for every other
           piece. A 2 mm bolt beside a 30 mm tower was allowed an 18 mm
           "nudge", which is not a repair, it is relocating the artwork:
           exactly what this paragraph says must not happen, permitted by the
           test written to forbid it. Against the piece, that bolt now gets
           3 mm.

           1.5 * h, not 0.6 * h, because a drop has to survive a CASCADE: when
           the thing underneath lands first, everything stacked on it must
           follow the whole way down, and that distance is bounded by the
           stack, not by the follower's own height. 1.5 leaves room for one
           full-height fall plus the bite; the 1.5 mm floor keeps an honest
           small correction legal on a piece so short that a fraction of its
           height is less than the bite itself. */
        if (dz > maxDrop || dz > Math.max(1.5, h * 1.5)) continue;
        settle(f, dz);
        anchored[i] = true; did = true;
        for (j = 0; j < parts.length; j++)
          if (!anchored[j] && partsContact(sc, parts[j], sc, f,ctx)) anchored[j] = true;
        moved.push({ triangles: f.tris, dropMm: +dz.toFixed(2), onto: onto,
                     sizeMm: [+(f.mx[0] - f.mn[0]).toFixed(2),
                              +(f.mx[1] - f.mn[1]).toFixed(2),
                              +(f.mx[2] - f.mn[2]).toFixed(2)] });
      }
      if (!did) break;
    }

    /* stillFloating is re-derived from the MOVED geometry rather than read off
       the flags reseat set on itself. The old version asked its own bookkeeping
       whether it had succeeded, which is how it came to report 0 floaters in a
       scene that still had one. */
    var left = analyseAnchorage(out, capTris, { slack: slack, rays: rays },ctx).floating.length;

    var fb = bounds(sc), cb = bounds(out.subarray(0, capTris * 9)), whole = bounds(out);
    var fixed = {};
    for (var k in seated)
      if (Object.prototype.hasOwnProperty.call(seated, k)) fixed[k] = seated[k];
    fixed.positions = out;
    fixed.sculptMm = { x: +fb.size[0].toFixed(2), y: +fb.size[1].toFixed(2),
                       z: +fb.size[2].toFixed(2) };
    // A tilted sculpt's Z span includes its row slope. Subtracting that span
    // from the old total invents a shorter cap after landing a floating piece.
    // Measure the emitted union, including off-center placement, instead.
    fixed.footprintMm = { x: +whole.size[0].toFixed(2), y: +whole.size[1].toFixed(2) };
    fixed.totalHeightMm = +whole.size[2].toFixed(2);
    fixed.overhangs = +Math.max(0, cb.mn[0]-fb.mn[0], fb.mx[0]-cb.mx[0],
                               cb.mn[1]-fb.mn[1], fb.mx[1]-cb.mx[1]).toFixed(2);
    fixed.moved = moved;
    fixed.stillFloating = left;
    return fixed;
  }

  /* Does the finished piece work - on a board, and in the machine? */
  function check(seated, opts) {
    var o = opts || {}, issues = [], notes = [];
    /* Same correction as seat(): the pitch is per unit, so a 2.25u key has
       42.86 mm to play with and only its DEPTH is limited to one unit. */
    var pitchW = o.pitch || (seated.pitchMm ? seated.pitchMm.x : 19.05);
    var pitchD = o.pitchD || (seated.pitchMm ? seated.pitchMm.y : 19.05);
    var bed = o.bed || { x: 40.8, y: 30.6, zSupported: 52 };

    var actual = seated.positions ? bounds(seated.positions) : null;
    if (seated.footprintMm.x > pitchW || seated.footprintMm.y > pitchD)
      issues.push('it is ' + seated.footprintMm.x.toFixed(1) + ' × ' +
        seated.footprintMm.y.toFixed(1) + ' mm across the widest point, over the ' +
        pitchW.toFixed(2) + ' × ' + pitchD.toFixed(2) +
        ' mm this key is allowed - it will foul the key next to it');
    else if (actual && (actual.mn[0] < -pitchW/2 - 1e-5 || actual.mx[0] > pitchW/2 + 1e-5 ||
                        actual.mn[1] < -pitchD/2 - 1e-5 || actual.mx[1] > pitchD/2 + 1e-5))
      issues.push('the artwork is offset beyond this key\'s ' + pitchW.toFixed(2) + ' × ' +
        pitchD.toFixed(2) + ' mm space; center it or reduce its size to clear neighboring keys');
    else if (seated.overhangs > 0.05)
      notes.push('the sculpt reaches up to ' + seated.overhangs.toFixed(1) +
        ' mm beyond the cap, which is still inside the key pitch');

    if (seated.sculptMm.z < 1.5)
      notes.push('a ' + seated.sculptMm.z.toFixed(1) +
        ' mm sculpt is barely more than a relief - raise the height to get a silhouette');
    if (seated.seatDepth < 0.6)
      issues.push('seated only ' + seated.seatDepth.toFixed(2) +
        ' mm into the cap; it needs to sink past the dish or its first layers hang over a hollow');

    if (seated.totalHeightMm > bed.zSupported)
      issues.push('the finished piece stands ' + seated.totalHeightMm.toFixed(1) +
        ' mm and the volume allows ' + bed.zSupported);

    notes.push('the cap and the sculpt are two overlapping solids; the slicer ' +
      'rasterises them as a union, so the stem is never touched by the sculpt');

    /* The diorama check. Only runs when the caller hands over the seated mesh,
       because it needs the real geometry rather than the summary. */
    var anchors = null;
    if (seated.positions && seated.capTriangles != null) {
      anchors = anchorage(seated.positions, seated.capTriangles, o);
      if (anchors.unresolved) issues.push(anchors.issue);
      else if (anchors.shells > 1)
        notes.push('the sculpt is ' + anchors.shells + ' separate pieces; ' +
          anchors.anchored + ' of them are attached to the cap or to each other, ' +
          'and overlapping pieces fuse in the slicer');
      anchors.floating.forEach(function (f) {
        issues.push('a piece ' + f.sizeMm.join(' × ') + ' mm is floating ' +
          f.gapMm.toFixed(2) + ' mm clear of ' + (f.gapOf || 'everything else') + '. On screen it looks ' +
          'attached; on the plate it is a separate object in mid air with nothing ' +
          'under it. Seat it deeper, or have the generator put the figures on a base.');
      });
    }
    return { ok: !issues.length, issues: issues, notes: notes, anchorage: anchors };
  }

  /* How it has to go on the plate.

     Face down buries the sculpt against the plate. Mouth down makes the cap's
     roof an island over its own cavity. So it goes on its SIDE - far enough
     over that every layer grows out of the one below, with the supports landing
     on the skirt and the leading edge rather than on the sculpt. */
  function printPose(seated, cap, opts) {
    var o = opts || {};
    /* THE SAME USABLE AREA AS THE PACKER, or the two disagree and the owner
       finds out at the slicer. This held its own copy of the bed - the bare
       40.8 x 30.6 - so it picked the shallowest lean whose footprint fit THAT,
       and layout(), which reserves the raft's border and the support feet,
       then refused the very cap printPose had just approved. Ask keycap.js for
       the number; fall back to the bare bed only when it is not loaded, which
       in this product it always is. */
    var bed = o.bed || (function () {
      var u = root.keycap && root.keycap.usableBed && root.keycap.usableBed();
      return u ? { x: u.x, y: u.y, zSupported: 52 } : { x: 40.8, y: 30.6, zSupported: 52 };
    })();
    var L = Math.max(seated.footprintMm.x, cap.size.x);
    var D = seated.footprintMm.y;
    var h = seated.totalHeightMm;

    /* ⚠️ MEASURE THE POSE, DO NOT ROTATE A BOX. Everything below used to be
       trigonometry on L, D and h - the bounding box of the seated cap - and
       the height of a rotated BOX is not the height of the thing inside it.
       keycap.js:426 fixed this exact mistake for the plain cap ("the layer
       count and the clock derived from it were short by up to five per cent...
       measure the pose that will actually be printed instead of assuming the
       two are the same") and printPose never got the same treatment: it was
       over-reporting the layer count by 7 to 11 per cent on every sculpt cap,
       and the owner's print-time estimate with it.

       So when the real orienter is available - it is, in the browser and in
       node, both of which load keycap.js beside this file - the candidate lean
       is applied to the actual mesh and the actual bounds are read back. The
       box arithmetic stays as the fallback for a caller that has no orienter,
       and is now clearly labelled as an approximation rather than the answer. */
    var K = root.keycap;
    var posed = (K && K.orientAsPrinted && seated.positions) ? function (t) {
      var q = K.orientAsPrinted(seated.positions, cap.angle, t, { mouthDown: true });
      var b = bounds(q);
      return { fx: b.size[0], fy: b.size[1], fz: b.size[2] };
    } : null;

    /* MIN_LEAN is the point of the exercise: below it the sculpt is still
       pointing at the plate and the supports would land on the artwork. */
    var MIN_LEAN = o.minTilt == null ? 40 : o.minTilt;
    var MAX_LEAN = 88;

    /* Search rather than assume. This was pinned at 55 degrees, and 55 is fine
       for a 1u - but a 2.25u Shift with a scene on it is 41.8 mm long, and at
       55 degrees it lands 43.5 mm across a 40.8 mm bed and simply does not fit.
       Leaning FURTHER shrinks the footprint, so the answer was never "it does
       not fit", it was "not at that angle". Take the shallowest lean that
       clears, because every extra degree is more overhang and more support. */
    function at(t) {
      if (posed) { var m = posed(t); return { deg: t, foot: m.fx, depth: m.fy, height: m.fz }; }
      var r = t * Math.PI / 180;
      return { deg: t, foot: L * Math.cos(r) + h * Math.sin(r), depth: D,
               height: L * Math.sin(r) + h * Math.cos(r) };
    }
    var pick = null;
    for (var t = MIN_LEAN; t <= MAX_LEAN; t += 0.5) {
      var c0 = at(t);
      /* EITHER WAY ROUND. A lean grows the part along ONE axis, and this
         asked only whether that axis was the bed's x - so a 1u cap with a
         28 mm figure on it, which needs 32.5 mm in the direction it leans,
         was refused against the 22.4 mm of usable depth while 32.6 mm of
         usable width sat unused beside it. layout() already turns a part
         90 degrees when that is what makes it land; printPose only had to
         stop ruling it out first. */
      var landsFlat   = c0.foot <= bed.x - 0.5 && c0.depth <= bed.y;
      var landsTurned = c0.depth <= bed.x - 0.5 && c0.foot <= bed.y;
      if ((landsFlat || landsTurned) && c0.height <= bed.zSupported) {
        pick = c0;
        pick.turned = !landsFlat;
        break;
      }
    }
    if (o.tilt != null) pick = at(o.tilt);
    if (!pick) {
      return { ok: false, tilt: null, supports: true,
        foot: { x: null, y: D }, height: null, forcedBy: 'sculpt',
        why: 'a ' + L.toFixed(1) + ' × ' + D.toFixed(1) + ' × ' + h.toFixed(1) +
             ' mm piece does not clear the ' + bed.x + ' × ' + bed.y + ' × ' +
             bed.zSupported + ' mm volume at any lean between ' + MIN_LEAN + ' and ' +
             MAX_LEAN + ' degrees. Make the sculpt shorter, or the key narrower.' };
    }
    return {
      /* mouthDown is the half of this that the exporter has to honour. The
         lean alone cannot save a cap that is lying on its artwork: the figure
         grows out of the top face, and orientForPrint lays that face on the
         plate. Turned over, the open skirt rim takes the plate and the supports
         and the figure points at the ceiling. */
      ok: true, tilt: +pick.deg.toFixed(1), supports: true, mouthDown: true,
      foot: { x: +pick.foot.toFixed(2), y: +(pick.depth == null ? D : pick.depth).toFixed(2) },
      height: +pick.height.toFixed(2),
      forcedBy: 'sculpt',
      why: 'a cap with a figure on it cannot print face down - that buries the ' +
           'sculpt against the plate - so it goes on its side at ' +
           pick.deg.toFixed(1) + '° with the supports on the skirt.'
    };
  }

  root.keycapSculpt = { seat: seat, check: check, printPose: printPose, bounds: bounds,
                        reseat: reseat, shellParts: shellParts, surfaceUnder: surfaceUnder,
                        shells: shells, anchorage: anchorage };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.keycapSculpt;
})(typeof window !== 'undefined' ? window : globalThis);
