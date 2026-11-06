// Read-only canvas instrumentation. Keep this function self-contained: Puppeteer
// installs it before the film loads, without changing any painted pixels.
export function recordText() {
  const P = CanvasRenderingContext2D.prototype;
  const rec = window.__texts = { on: false, log: [], surfaces: [], serial: 0 };
  const states = new WeakMap();
  const state = (ctx) => {
    if (!states.has(ctx)) states.set(ctx, { clip: null, stack: [], path: null });
    return states.get(ctx);
  };
  const matrix = (ctx) => { const t = ctx.getTransform(); return [t.a, t.b, t.c, t.d, t.e, t.f]; };
  const place = ([a,b,c,d,e,f], [l,t,r,bottom]) => {
    const pts = [[l,t],[r,t],[l,bottom],[r,bottom]].map(([x,y]) => [a*x+c*y+e,b*x+d*y+f]);
    return [Math.min(...pts.map(p=>p[0])),Math.min(...pts.map(p=>p[1])),Math.max(...pts.map(p=>p[0])),Math.max(...pts.map(p=>p[1]))];
  };
  const intersect = (a,b) => a ? [Math.max(a[0],b[0]),Math.max(a[1],b[1]),Math.min(a[2],b[2]),Math.min(a[3],b[3])] : b;
  const multiply = (a,b) => [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
  for (const name of ['save','restore','reset','beginPath','rect','clip']) {
    const draw = P[name];
    P[name] = function (...args) {
      if (rec.on) {
        const s = state(this);
        if (name === 'save') s.stack.push(s.clip);
        if (name === 'restore' && s.stack.length) s.clip = s.stack.pop();
        if (name === 'reset') {
          states.delete(this);
          rec.log = rec.log.filter(e=>e.canvas!==this.canvas);
          rec.surfaces = rec.surfaces.filter(e=>e.canvas!==this.canvas);
        }
        if (name === 'beginPath') s.path = [];
        if (name === 'rect') { const [x,y,w,h] = args; s.path?.push(place(matrix(this),[x,y,x+w,y+h])); }
        if (name === 'clip' && s.path?.length === 1 && !(args[0] instanceof Path2D)) s.clip = intersect(s.clip,s.path[0]);
      }
      return draw.apply(this,args);
    };
  }
  // A curved path cannot be treated as its last rectangular subpath.
  for (const name of ['arc','arcTo','ellipse','roundRect','moveTo','lineTo','bezierCurveTo','quadraticCurveTo']) {
    const draw = P[name];
    P[name] = function (...args) { if (rec.on) state(this).path = null; return draw.apply(this,args); };
  }
  const fill = P.fillRect;
  P.fillRect = function (x,y,w,h) {
    if (rec.on && this.globalAlpha === 1 && this.globalCompositeOperation === 'source-over' &&
        typeof this.fillStyle === 'string' && (/^#[\da-f]{6}$/i.test(this.fillStyle) || /^rgb\(/.test(this.fillStyle))) {
      const T = matrix(this), local = [x,y,x+w,y+h];
      // Only axis-aligned opaque rectangles safely occlude a text box.
      if (Math.abs(T[1])+Math.abs(T[2]) < 1e-8) rec.surfaces.push({ canvas:this.canvas, box:intersect(state(this).clip,place(T,local)), local, transform:T, order:++rec.serial });
    }
    return fill.apply(this,arguments);
  };
  for (const name of ['fillText','strokeText']) {
    const draw = P[name];
    P[name] = function (text,x,y,maxWidth) {
      if (rec.on && String(text).trim()) {
        const m = this.measureText(text), k = maxWidth !== undefined && m.width > maxWidth ? maxWidth/m.width : 1, T = matrix(this);
        const local = [x-m.actualBoundingBoxLeft*k,y-m.actualBoundingBoxAscent,x+m.actualBoundingBoxRight*k,y+m.actualBoundingBoxDescent];
        const size = parseFloat((this.font.match(/([\d.]+)px/)||[])[1]||0)*Math.sqrt(Math.abs(T[0]*T[3]-T[1]*T[2]));
        rec.log.push({ canvas:this.canvas, text:String(text), box:place(T,local), local, transform:T, clip:state(this).clip, font:this.font, size, alpha:this.globalAlpha, middle:this.textBaseline==='middle', order:++rec.serial });
      }
      return draw.apply(this,arguments);
    };
  }
  const copy = P.drawImage;
  P.drawImage = function (src,...args) {
    if (rec.on && src instanceof HTMLCanvasElement && src !== this.canvas) {
      const [sx,sy,sw,sh,dx,dy,dw,dh] = args.length===8 ? args : args.length===4 ? [0,0,src.width,src.height,...args] : [0,0,src.width,src.height,args[0],args[1],src.width,src.height];
      const T = matrix(this), kx = dw/sw, ky = dh/sh;
      const map = ([l,t,r,b]) => [dx+(l-sx)*kx,dy+(t-sy)*ky,dx+(r-sx)*kx,dy+(b-sy)*ky];
      const project = multiply(T,[kx,0,0,ky,dx-sx*kx,dy-sy*ky]);
      // Preserve source draw order, local geometry and the composed transform:
      // drawing a complete helper at (offset,0) is also whole-layer travel.
      const entries=[...rec.log.map(e=>({e,text:true})),...rec.surfaces.map(e=>({e,text:false}))].filter(({e})=>e.canvas===src).sort((a,b)=>a.e.order-b.e.order);
      for (const {e,text} of entries) {
        const clip = place(T,map(intersect(intersect(e.clip,[0,0,src.width,src.height]),[sx,sy,sx+sw,sy+sh])));
        const transformed={...e,canvas:this.canvas,transform:multiply(project,e.transform),clip:intersect(state(this).clip,clip),box:place(T,map(e.box)),order:++rec.serial};
        if (text) rec.log.push({...transformed,size:e.size*Math.sqrt(Math.abs(kx*ky*(T[0]*T[3]-T[1]*T[2]))),alpha:e.alpha*this.globalAlpha});
        else if (this.globalAlpha===1 && this.globalCompositeOperation==='source-over') rec.surfaces.push({...transformed,box:intersect(transformed.box,transformed.clip)});
      }
    }
    return copy.apply(this,[src,...args]);
  };
}

const area = b => Math.max(0,b[2]-b[0])*Math.max(0,b[3]-b[1]);
const intersect = (a,b) => [Math.max(a[0],b[0]),Math.max(a[1],b[1]),Math.min(a[2],b[2]),Math.min(a[3],b[3])];
const same = (a,b,epsilon=.01) => a?.length===b?.length && a.every((v,i)=>Math.abs(v-b[i])<=epsilon);
const inside = (a,b) => a[0]>=b[0]-1 && a[1]>=b[1]-1 && a[2]<=b[2]+1 && a[3]<=b[3]+1;
const identity = t => same(t.slice(0,4),[1,0,0,1]);
const signature = e => JSON.stringify([e.text,e.font,e.local.map(x=>Math.round(x*100)/100)]);
const motionKey = t => t.toFixed(6);
export { motionKey };

function subtract(a,b) {
  const i = intersect(a,b);
  if (!area(i)) return [a];
  return [[a[0],a[1],a[2],i[1]],[a[0],i[3],a[2],a[3]],[a[0],i[1],i[0],i[3]],[i[2],i[1],a[2],i[3]]].filter(b=>area(b)>0);
}
function visible(e,shot) {
  let boxes = [intersect(e.box,e.clip || [0,0,shot.w,shot.h])].map(b=>intersect(b,[0,0,shot.w,shot.h])).filter(b=>area(b)>0);
  for (const s of shot.surfaces || []) if (s.order > e.order) boxes = boxes.flatMap(b=>subtract(b,s.box));
  return boxes;
}

// Travel is measured, never declared by the film or inferred merely from a
// nonzero transform. The same intact, locally fitted group must be present on
// three consecutive frames, translating continuously with peers or a surface.
function travels(e,shot,previous,next,previous2,next2) {
  if (!identity(e.transform) || !inside(e.local,[0,0,shot.w,shot.h])) return false;
  if (Math.abs(e.transform[4])+Math.abs(e.transform[5]) < .01) return false;
  const key=signature(e), limit=Math.min(shot.w,shot.h)*.35;
  const em=parseFloat((e.font.match(/([\d.]+)px/)||[])[1]||0);
  const match = s => {
    const exact=s?.texts.find(x=>signature(x)===key);
    if (exact) return exact;
    // A wrapped row can still be rising as its whole page slides. Match its
    // unchanged glyph geometry, not its baseline, without joining duplicate
    // words from a different row or the outgoing page. This fallback needs
    // independent three-frame surface evidence and intact clips below.
    const candidates=(s?.texts || []).filter(x=>x.text===e.text && x.font===e.font && identity(x.transform) &&
      same([x.local[0],x.local[2],x.local[3]-x.local[1]],[e.local[0],e.local[2],e.local[3]-e.local[1]]) &&
      Math.abs(x.local[1]-e.local[1])<=em*.5 &&
      Math.hypot(x.transform[4]-e.transform[4],x.transform[5]-e.transform[5])<=limit)
      .sort((a,b)=>Math.abs(a.local[1]-e.local[1])-Math.abs(b.local[1]-e.local[1]));
    if (candidates.length>1 && Math.abs(Math.abs(candidates[0].local[1]-e.local[1])-Math.abs(candidates[1].local[1]-e.local[1]))<.01) return;
    return candidates[0];
  };
  // At a semantic arrival or a layer's final frame, use three consecutive
  // frames on the available side. A lone frame can never qualify as travel.
  let trail=[previous,shot,next];
  if (!match(previous)) trail=[shot,next,next2];
  else if (!match(next)) trail=[previous2,previous,shot];
  const entries=trail.map(match);
  if (entries.some(x=>!x||!identity(x.transform))) return false;
  const [before,current,after]=entries;
  const d1 = current.transform.slice(4).map((v,i)=>v-before.transform[i+4]), d2 = after.transform.slice(4).map((v,i)=>v-current.transform[i+4]);
  if (Math.hypot(...d1)+Math.hypot(...d2) < .01 || d1.some((v,i)=>v*d2[i]<-.01) || Math.max(Math.hypot(...d1),Math.hypot(...d2)) > limit) return false;
  const rising=entries.some(x=>signature(x)!==key);
  if (rising) {
    const dy1=current.local[1]-before.local[1],dy2=after.local[1]-current.local[1];
    if (dy1*dy2<-.01 || Math.max(Math.abs(dy1),Math.abs(dy2))>em*.25) return false;
    if (entries.some(x=>!inside(x.local,[0,0,shot.w,shot.h]))) return false;
    const surface=(shot.surfaces || []).some(s=>same(s.transform,e.transform) && inside(e.local,s.local) &&
      trail.every((frame,i)=>(frame.surfaces || []).some(p=>same(p.local,s.local) &&
        same(p.transform,entries[i].transform) && inside(entries[i].local,p.local))));
    if (!surface) return false;
  }
  const peers = shot.texts.filter(x=>same(x.transform,e.transform) && inside(x.local,[0,0,shot.w,shot.h]) &&
    trail.every((s,i)=>s.texts.some(p=>signature(p)===signature(x)&&same(p.transform,entries[i].transform))));
  const surface = (shot.surfaces || []).some(s=>same(s.transform,e.transform) && inside(e.local,s.local));
  if (new Set(peers.map(x=>x.text)).size < 2 && !surface) return false;
  for (const [i,entry] of (rising?entries:[e]).entries()) if (entry.clip && !inside(entry.box,entry.clip)) {
    // A travelling label's own small clip is a defect. The external viewport
    // may clip it; an outgoing native page may also be occluded by its incoming
    // page, but only with captured navigation and an exact measured scope.
    const frame=rising?trail[i]:shot;
    const viewport = same(entry.clip,[0,0,shot.w,shot.h]);
    const native = frame.audit?.native?.at(-1)?.state;
    const scoped = native?.moves?.some(m=>m.time<m.duration-1e-5) && frame.audit.captions?.some(c=>
      c.scope && same(c.scope.offset,entry.transform.slice(4)) && same(entry.clip,[c.scope.clip[0],c.scope.clip[1],c.scope.clip[0]+c.scope.clip[2],c.scope.clip[1]+c.scope.clip[3]]));
    if (!viewport && !scoped) return false;
  }
  return true;
}

export function textProblems(shot,words,previous,next,previous2,next2) {
  const {w,h} = shot, out = [], floor = 28*Math.min(w,h)/1440, round = b=>b.map(Math.round).join(',');
  const ours = s => s.trim().length>1 && words.some(v=>v.includes(s.trim()) || s.includes(v));
  const texts = shot.texts.map(e=>({...e,visible:visible(e,shot)})).filter(e=>e.visible.length);
  for (const e of texts) {
    const edge = !inside(e.box,[0,0,w,h]), clipped = e.clip && !inside(e.box,e.clip);
    if (edge || clipped) {
      const travel = travels(e,shot,previous,next,previous2,next2);
      out.push({kind:travel?'travel':edge?'cut by the edge':'cut by a clip',text:e.text,ours:ours(e.text),detail:`"${e.text}" at [${round(e.box)}] in ${w}×${h}${travel?' (intact translating layer; neighbours agree)':''}`});
    }
    if (e.size && e.size<floor-.01 && ours(e.text)) out.push({kind:'too small',text:e.text,ours:true,detail:`"${e.text}" at ${e.size.toFixed(1)} px (floor ${floor.toFixed(1)})`});
    if (e.middle) out.push({kind:'off-centre',text:e.text,ours:ours(e.text),detail:`"${e.text}" drawn with textBaseline 'middle', which sits it high; centre it with kit.centreText`});
  }
  for (let i=0;i<texts.length;i++) for (let j=i+1;j<texts.length;j++) {
    const a=texts[i],b=texts[j],both=a.visible.reduce((sum,x)=>sum+b.visible.reduce((s,y)=>s+area(intersect(x,y)),0),0);
    const small=Math.min(a.visible.reduce((s,x)=>s+area(x),0),b.visible.reduce((s,x)=>s+area(x),0));
    if (!small || both/small<=.2) continue;
    if (a.text===b.text && both/(area(a.box)+area(b.box)-both)>.8) continue;
    out.push({kind:'overlap',text:`${a.text}|${b.text}`,ours:ours(a.text)||ours(b.text),detail:`"${a.text}" and "${b.text}" (${Math.round(both/small*100)}% of the smaller visible box)`});
  }
  return out;
}

// A one-frame disappearance or excursion must not acquire a travel exemption.
// Test raw draw records so an opaque incoming card hiding text is not a pop.
export function textPops(shot,previous,next,words) {
  if (!previous || !next) return [];
  const out=[];
  for (const e of previous.texts) {
    if (!words.some(w=>w.includes(e.text)||e.text.includes(w)) || !visible(e,previous).length) continue;
    const after=next.texts.find(x=>signature(x)===signature(e));
    if (!after || !visible(after,next).length) continue;
    const now=shot.texts.find(x=>signature(x)===signature(e));
    const excursion = now && same(e.transform.slice(0,4),after.transform.slice(0,4)) &&
      now.transform.some((v,i)=>v<Math.min(e.transform[i],after.transform[i])-1 || v>Math.max(e.transform[i],after.transform[i])+1);
    if (!now || excursion) out.push({kind:'one-frame pop',text:e.text,ours:true,detail:`"${e.text}" disappears or jumps for one frame between matching neighbours`});
  }
  return out;
}
