/* Persist the exact checked print mesh separately from the raw artwork.
 * Ready means the caller supplied geometry that passed its assembly checks;
 * it never means physically print-tested. The checksum detects stale edits,
 * not hostile changes. IndexedDB/structuredClone preserve Float32Array.
 */
(function(root){
  'use strict';
  var MAX_TRIANGLES=300000,MAX_RECIPE=4096,EPSILON_MM=0.01;
  function fail(message){throw new Error('Saved keycap: '+message);}
  function recipeOf(value){
    if(typeof value!=='string'||value.length>MAX_RECIPE||!/^TMK1-[A-Za-z0-9_-]+$/.test(value))
      fail('the assembly recipe is missing or invalid.');
    return value;
  }
  function fitOf(value){
    if(!value||typeof value.slotMm!=='number'||!Number.isFinite(value.slotMm)||value.slotMm<1.15||value.slotMm>1.45)
      fail('the recorded socket width must be 1.15–1.45 mm.');
    return {slotMm:value.slotMm};
  }
  function issuesOf(value){
    if(value==null)return [];
    if(!Array.isArray(value)||value.length>64)fail('the issue list is invalid.');
    return value.map(function(s){
      if(typeof s!=='string'||!s.trim()||s.length>1000)fail('an issue must be bounded plain text.');
      return s;
    });
  }
  function isFloat32(value){return ArrayBuffer.isView(value)&&Object.prototype.toString.call(value)==='[object Float32Array]';}
  function copyPositions(value){
    if(!isFloat32(value)&&!Array.isArray(value))fail('print coordinates must be a Float32Array or number array.');
    if(value.length<9||value.length%9||value.length>MAX_TRIANGLES*9)fail('the print mesh must contain 1–300,000 complete triangles.');
    for(var i=0;i<value.length;i++)if(typeof value[i]!=='number'||!Number.isFinite(value[i]))fail('the print mesh contains invalid coordinates.');
    return new Float32Array(value);
  }
  function limits(){
    var k=root.keycap,b=k&&typeof k.usableBed==='function'?k.usableBed():null;
    var z=k&&k.BED?Math.min(k.BED.zSupported,k.BED.zFlat):NaN;
    if(!b||!Number.isFinite(b.x)||!Number.isFinite(b.y)||!Number.isFinite(z)||b.x<=0||b.y<=0||z<=0)
      fail('current printer volume limits are unavailable.');
    // A snapshot has no support-plan flag. Reserve the supported Z limit.
    return {x:b.x,y:b.y,z:z};
  }
  function geometry(value,checkHealth){
    if(!isFloat32(value)||value.length<9||value.length%9||value.length>MAX_TRIANGLES*9)
      fail('the saved print mesh is not a complete bounded Float32Array.');
    var mn=[Infinity,Infinity,Infinity],mx=[-Infinity,-Infinity,-Infinity],hasArea=false;
    for(var i=0;i<value.length;i+=3)for(var a=0;a<3;a++){
      var n=value[i+a];if(!Number.isFinite(n))fail('the saved print mesh contains invalid coordinates.');
      mn[a]=Math.min(mn[a],n);mx[a]=Math.max(mx[a],n);
    }
    var size=mx.map(function(v,a){return v-mn[a];});
    if(size.some(function(v){return !Number.isFinite(v)||v<=0;}))fail('the print mesh has no three-dimensional volume.');
    var bed=limits(),e=EPSILON_MM;
    if(mn[0]<-bed.x/2-e||mx[0]>bed.x/2+e||mn[1]<-bed.y/2-e||mx[1]>bed.y/2+e||mn[2]<-e||mx[2]>bed.z+e)
      fail('the saved coordinates exceed the current usable print volume.');
    for(var t=0;t<value.length&&!hasArea;t+=9){
      var ux=value[t+3]-value[t],uy=value[t+4]-value[t+1],uz=value[t+5]-value[t+2];
      var vx=value[t+6]-value[t],vy=value[t+7]-value[t+1],vz=value[t+8]-value[t+2];
      hasArea=(uy*vz-uz*vy)!==0||(uz*vx-ux*vz)!==0||(ux*vy-uy*vx)!==0;
    }
    if(!hasArea)fail('the print mesh has no usable triangle area.');
    if(checkHealth&&typeof root.meshHealth==='function'){
      var health=root.meshHealth(value);
      if(!health||health.fatal||health.severity==='bad')
        fail(health&&(health.fatal||health.advice||health.summary)||'the saved print mesh failed its health check.');
    }
    return {sizeMm:size,triangles:value.length/9};
  }
  function signature(product){
    // Fixed field order, exact float32 bit patterns, and double 32-bit hashes.
    var h1=2166136261>>>0,h2=5381;
    function byte(b){h1=Math.imul(h1^b,16777619)>>>0;h2=(Math.imul(h2,33)^b)>>>0;}
    var text=JSON.stringify([product.version,product.kind,product.state,product.issues,product.checkedAt,
      product.fit.slotMm,product.sizeMm,product.triangles,product.recipe]);
    for(var i=0;i<text.length;i++){var c=text.charCodeAt(i);byte(c&255);byte(c>>>8);}
    if(product.positions){
      var bits=new DataView(new ArrayBuffer(4));
      for(var q=0;q<product.positions.length;q++){
        bits.setFloat32(0,product.positions[q],true);
        byte(bits.getUint8(0));byte(bits.getUint8(1));byte(bits.getUint8(2));byte(bits.getUint8(3));
      }
    }
    function hex(n){return ('00000000'+n.toString(16)).slice(-8);}
    return 'kp1-'+hex(h1)+hex(h2);
  }
  function capture(input){
    var o=input||{},issues=issuesOf(o.issues),positions=null,info={sizeMm:[0,0,0],triangles:0};
    if(o.positions!=null){
      if(issues.length)fail('blocked snapshots must not contain exportable print coordinates.');
      positions=copyPositions(o.positions);info=geometry(positions,false);
    }else if(!issues.length)issues=['No checked print geometry is available.'];
    var at=o.checkedAt==null?Date.now():o.checkedAt;
    if(!Number.isSafeInteger(at)||at<0)fail('the check timestamp is invalid.');
    var out={version:1,kind:'keycap',state:positions?'ready':'needs-attention',issues:issues,
      checkedAt:at,fit:fitOf(o.fit),positions:positions,sizeMm:info.sizeMm,triangles:info.triangles,
      recipe:recipeOf(o.recipe),signature:''};
    out.signature=signature(out);return out;
  }
  function checked(product,checkHealth){
    var p=product;
    if(!p||p.version!==1||p.kind!=='keycap'||(p.state!=='ready'&&p.state!=='needs-attention'))fail('the product snapshot format is unsupported.');
    recipeOf(p.recipe);fitOf(p.fit);var issues=issuesOf(p.issues);
    if(!Array.isArray(p.issues)||!Number.isSafeInteger(p.checkedAt)||p.checkedAt<0)fail('the snapshot metadata is invalid.');
    if(!Array.isArray(p.sizeMm)||p.sizeMm.length!==3||p.sizeMm.some(function(v){return typeof v!=='number'||!Number.isFinite(v)||v<0;})||!Number.isSafeInteger(p.triangles)||p.triangles<0)
      fail('the saved size or triangle count is invalid.');
    if(p.state==='ready'){
      if(issues.length)fail('a ready snapshot cannot contain unresolved issues.');
      var info=geometry(p.positions,checkHealth);
      if(p.triangles!==info.triangles||p.sizeMm.some(function(v,a){return v!==info.sizeMm[a];}))fail('the mesh and its saved measurements disagree.');
    }else if(p.positions!==null||p.triangles!==0||p.sizeMm.some(function(v){return v!==0;})||!issues.length)
      fail('the blocked snapshot is inconsistent.');
    if(typeof p.signature!=='string'||p.signature!==signature(p))fail('the snapshot changed after it was checked. Rebuild and save the keycap again.');
    return p;
  }
  function validate(product){checked(product,true);return true;}
  function metadata(product){
    var p=checked(product,false);
    return {version:p.version,kind:p.kind,state:p.state,issues:p.issues.slice(),checkedAt:p.checkedAt,
      fit:{slotMm:p.fit.slotMm},sizeMm:p.sizeMm.slice(),triangles:p.triangles,recipe:p.recipe,signature:p.signature};
  }
  function toSTL(product){
    var p=checked(product,true);
    if(p.state!=='ready')fail('this keycap needs attention: '+p.issues.join(' '));
    if(typeof Blob==='undefined')fail('binary STL downloads are unavailable in this environment.');
    var buffer=new ArrayBuffer(84+p.triangles*50),view=new DataView(buffer),offset=84;
    view.setUint32(80,p.triangles,true);
    for(var t=0;t<p.triangles;t++){
      offset+=12;
      for(var k=0;k<9;k++){view.setFloat32(offset,p.positions[t*9+k],true);offset+=4;}
      offset+=2;
    }
    return new Blob([buffer],{type:'model/stl'});
  }
  root.keycapProduct={capture:capture,validate:validate,toSTL:toSTL,metadata:metadata,
    limits:{maxTriangles:MAX_TRIANGLES,maxRecipeChars:MAX_RECIPE,fitMinMm:1.15,fitMaxMm:1.45}};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.keycapProduct;
})(typeof window!=='undefined'?window:globalThis);
