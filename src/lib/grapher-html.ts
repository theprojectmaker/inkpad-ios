// Quill's own graphing calculator, fully offline (one self-contained page shown
// in a web view). Desmos-style: an expression list on the left, the graph on the
// right. Type y=x^2, sin(x), x=3, points like (1,2), a=2 for a slider, f(x)=...
// It also works as a plain calculator: any line without x shows its value.
export const GRAPHER_HTML = String.raw`<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;height:100%;font:15px -apple-system,system-ui,sans-serif;color:#1d1d1f;background:#fff;overflow:hidden}
#app{display:flex;height:100%}
#list{width:min(340px,42%);border-right:1px solid #e3e3e8;display:flex;flex-direction:column;background:#fff}
#rows{flex:1;overflow:auto}
.row{display:flex;align-items:stretch;border-bottom:1px solid #ececf0;min-height:58px}
.dot{width:38px;display:flex;align-items:center;justify-content:center;background:#f7f7f9;border-right:1px solid #ececf0}
.dot i{width:16px;height:16px;border-radius:8px;display:block}
.body{flex:1;display:flex;flex-direction:column;justify-content:center;padding:6px 8px 6px 12px;min-width:0}
.body input{border:0;outline:0;font:500 19px "SF Mono",ui-monospace,Menlo,monospace;width:100%;background:transparent;color:#1d1d1f;padding:6px 0}
.val{font:14px ui-monospace,Menlo,monospace;color:#2563eb}.err{font-size:12.5px;color:#c7372f}
.x{width:34px;border:0;background:none;color:#aaa;font-size:20px}
.slider{display:flex;align-items:center;gap:8px;font:13px ui-monospace,monospace;color:#666}.slider input[type=range]{flex:1;accent-color:#2563eb}
#add{border:0;border-top:1px solid #e3e3e8;background:#fafafa;height:46px;font:600 15px -apple-system,sans-serif;color:#2563eb}
#graph{flex:1;position:relative;touch-action:none}
canvas{width:100%;height:100%;display:block}
#tools{position:absolute;right:12px;top:12px;display:flex;flex-direction:column;gap:8px}
#tools button{width:40px;height:40px;border-radius:10px;border:1px solid #ddd;background:#fff;font-size:20px;color:#333;box-shadow:0 1px 3px #0001}
#keys{display:none;grid-template-columns:repeat(5,1fr);gap:6px;padding:8px;border-top:1px solid #e3e3e8;background:#f3f3f6}
#keys button{height:42px;border:0;border-radius:8px;background:#fff;font:500 16px -apple-system,sans-serif;box-shadow:0 1px 0 #0002}
#list.calc{width:100%;border-right:0}#list.calc #keys{display:grid}
</style></head><body><div id="app">
<div id="list"><div id="rows"></div><div id="keys"></div><button id="add">+ Add expression</button></div>
<div id="graph"><canvas id="c"></canvas><div id="tools"><button id="zi">+</button><button id="zo">−</button><button id="home">⌂</button></div></div>
</div><script>
const COLORS=['#c74440','#2d70b3','#388c46','#6042a6','#fa7e19','#000000'];
let rows=[{id:1,text:'y=x^2'},{id:2,text:''}],nid=3,sliders={};
let view={cx:0,cy:0,scale:40};// pixels per unit
const $=s=>document.querySelector(s);
const FN={sin:Math.sin,cos:Math.cos,tan:Math.tan,asin:Math.asin,acos:Math.acos,atan:Math.atan,arcsin:Math.asin,arccos:Math.acos,arctan:Math.atan,
sinh:Math.sinh,cosh:Math.cosh,tanh:Math.tanh,sqrt:Math.sqrt,abs:Math.abs,ln:Math.log,log:Math.log10,exp:Math.exp,floor:Math.floor,ceil:Math.ceil,round:Math.round,
sec:x=>1/Math.cos(x),csc:x=>1/Math.sin(x),cot:x=>1/Math.tan(x)};
const CONST={pi:Math.PI,e:Math.E,'π':Math.PI};
// --- tiny math parser: + - * / ^, ( ), implicit multiplication (2x, 3(x+1), x sin x), functions
function tokenize(s){s=s.replace(/²/g,'^2').replace(/³/g,'^3');for(let k=0;k<5&&/\|[^|]+\|/.test(s);k++)s=s.replace(/\|([^|]+)\|/g,'abs($1)');s=s.replace(/\*\*/g,'^').replace(/π/g,'pi').replace(/√/g,'sqrt').replace(/·|×/g,'*').replace(/÷/g,'/');
 const t=[];let i=0;while(i<s.length){const c=s[i];if(/\s/.test(c)){i++;continue}
 if(/[0-9.]/.test(c)){let j=i;while(j<s.length&&/[0-9.]/.test(s[j]))j++;const ex=s.slice(j).match(/^e[-+]?[0-9]+/);if(ex)j+=ex[0].length;t.push({k:'n',v:parseFloat(s.slice(i,j))});i=j;continue}
 if(/[a-zA-Z]/.test(c)){let j=i;while(j<s.length&&/[a-zA-Z0-9_]/.test(s[j]))j++;let w=s.slice(i,j);
  // split runs like "xy" or "2ab" into single letters unless it's a known name
  while(w.length){const f=Object.keys(FN).concat(Object.keys(CONST)).sort((a,b)=>b.length-a.length).find(n=>w.startsWith(n));
   if(f){t.push({k:FN[f]?'f':'id',v:f});w=w.slice(f.length)}else{t.push({k:'id',v:w[0]});w=w.slice(1)}}
  i=j;continue}
 if('+-*/^(),'.includes(c)){t.push({k:'o',v:c});i++;continue}throw Error('Unknown symbol '+c)}return t}
function parse(src){const t=tokenize(src);let p=0;const peek=()=>t[p],eat=v=>{if(t[p]&&t[p].v===v){p++;return true}return false};
 function expr(){let a=term();for(;;){if(eat('+')){const b=term(),x=a;a=e=>x(e)+b(e)}else if(eat('-')){const b=term(),x=a;a=e=>x(e)-b(e)}else return a}}
 function term(){let a=unary();for(;;){const q=peek();if(eat('*')){const b=unary(),x=a;a=e=>x(e)*b(e)}else if(eat('/')){const b=unary(),x=a;a=e=>x(e)/b(e)}
  else if(q&&(q.k==='n'||q.k==='id'||q.k==='f'||q.v==='(')){const b=power(),x=a;a=e=>x(e)*b(e)}else return a}}
 function unary(){if(eat('-')){const a=unary();return e=>-a(e)}if(eat('+'))return unary();return power()}
 function power(){const b=atom();if(eat('^')){const x=unary();return e=>Math.pow(b(e),x(e))}return b}
 function atom(){const q=t[p++];if(!q)throw Error('Unfinished');
  if(q.k==='n')return()=>q.v;
  if(q.k==='f'){const f=FN[q.v];let pw=null;if(eat('^'))pw=unary();let a;
   if(eat('(')){a=expr();if(!eat(')'))throw Error('Missing )')}
   else{a=power();for(;;){const n=peek();if(n&&(n.k==='n'||n.k==='id')){const b=power(),x=a;a=e=>x(e)*b(e)}else break}}
   return pw?e=>Math.pow(f(a(e)),pw(e)):e=>f(a(e))}
  if(q.k==='id'){const n=q.v;if(n in CONST)return()=>CONST[n];
   if(peek()&&peek().v==='('&&defs[n]){p++;const a=expr();if(!eat(')'))throw Error('Missing )');return e=>defs[n]({...e,x:a(e)})}
   used.add(n);return e=>{if(n in e)return e[n];if(defs[n])return defs[n](e);throw Error('Undefined '+n)}}
  if(q.v==='('){const a=expr();if(eat(',')){const b=expr();if(!eat(')'))throw Error('Missing )');return Object.assign(e=>NaN,{pt:[a,b]})}if(!eat(')'))throw Error('Missing )');return a}
  throw Error('Unexpected '+q.v)}
 const r=expr();if(p<t.length)throw Error('Unexpected '+t[p].v);return r}
let used=new Set(),defs={};
function analyze(){defs={};const out=[];const vars={};
 // pass 1: definitions (a=3, f(x)=...)
 for(const r of rows){const s=r.text.trim();let m;
  if((m=s.match(/^([a-zA-Z])\s*=\s*(-?[0-9.]+(?:e[-+]?[0-9]+)?)$/))&&!'xy'.includes(m[1])){vars[m[1]]=+m[2];sliders[m[1]]=sliders[m[1]]||{min:-10,max:10};r.slider=m[1]}
  else if((m=s.match(/^([a-zA-Z])\(x\)\s*=\s*(.+)$/))){try{used=new Set();defs[m[1]]=parse(m[2])}catch(e){}}else r.slider=null}
 for(const r of rows){const s=r.text.trim();let item={r,kind:'none'};
  try{if(!s){out.push(item);continue}
   if(r.slider){item.kind='slider';out.push(item);continue}
   let m;used=new Set();
   if((m=s.match(/^([a-zA-Z])\(x\)\s*=\s*(.+)$/))){item.kind='fx';item.f=defs[m[1]];}
   else if((m=s.match(/^y\s*=\s*(.+)$/))){item.kind='fx';item.f=parse(m[1])}
   else if((m=s.match(/^x\s*=\s*(.+)$/))){item.kind='vx';item.f=parse(m[1])}
   else{const f=parse(s);if(f.pt){item.kind='pt';item.f=f}else if(used.has('x')){item.kind='fx';item.f=f}else{item.kind='val';item.f=f}}
   const env={...vars};
   for(const n of used)if(!'xy'.includes(n)&&!(n in env)&&!defs[n])throw Error('Undefined '+n+' — add '+n+'=1');
   item.env=env;
   if(item.kind==='val'){const v=item.f(env);item.value=fmt(v)}
   if(item.kind==='vx'){item.value='x = '+fmt(item.f(env))}
  }catch(e){item.kind='err';item.msg=e.message}
  out.push(item)}
 return out}
const fmt=v=>!isFinite(v)?'undefined':Math.abs(v)>=1e9||(Math.abs(v)<1e-6&&v!==0)?v.toExponential(6):String(+v.toFixed(10));
// --- drawing
const cv=$('#c'),ctx=cv.getContext('2d');let W=0,H=0,dpr=1;
function size(){const b=cv.getBoundingClientRect();dpr=window.devicePixelRatio||1;W=b.width;H=b.height;cv.width=W*dpr;cv.height=H*dpr;draw()}
const sx=x=>W/2+(x-view.cx)*view.scale,sy=y=>H/2-(y-view.cy)*view.scale,ux=px=>(px-W/2)/view.scale+view.cx,uy=py=>-(py-H/2)/view.scale+view.cy;
function niceStep(){const raw=90/view.scale,p=Math.pow(10,Math.floor(Math.log10(raw)));for(const k of[1,2,5,10])if(k*p>=raw)return k*p;return 10*p}
let items=[];
function draw(){ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,W,H);ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);
 const st=niceStep(),minor=st/5;
 ctx.lineWidth=1;
 for(const [s,col] of [[minor,'#f1f1f4'],[st,'#dcdce2']]){ctx.strokeStyle=col;ctx.beginPath();
  for(let x=Math.ceil(ux(0)/s)*s;x<=ux(W);x+=s){const X=Math.round(sx(x))+.5;ctx.moveTo(X,0);ctx.lineTo(X,H)}
  for(let y=Math.ceil(uy(H)/s)*s;y<=uy(0);y+=s){const Y=Math.round(sy(y))+.5;ctx.moveTo(0,Y);ctx.lineTo(W,Y)}ctx.stroke()}
 ctx.strokeStyle='#333';ctx.lineWidth=1.4;ctx.beginPath();ctx.moveTo(sx(0),0);ctx.lineTo(sx(0),H);ctx.moveTo(0,sy(0));ctx.lineTo(W,sy(0));ctx.stroke();
 ctx.fillStyle='#555';ctx.font='12px -apple-system,sans-serif';
 const ax=Math.min(Math.max(sx(0),4),W-30),ay=Math.min(Math.max(sy(0),4),H-16);
 ctx.textAlign='center';ctx.textBaseline='top';for(let x=Math.ceil(ux(0)/st)*st;x<=ux(W);x+=st){if(Math.abs(x)<st/2)continue;ctx.fillText(fmt(+x.toPrecision(10)),sx(x),ay+4)}
 ctx.textAlign='right';ctx.textBaseline='middle';for(let y=Math.ceil(uy(H)/st)*st;y<=uy(0);y+=st){if(Math.abs(y)<st/2)continue;ctx.fillText(fmt(+y.toPrecision(10)),ax-5,sy(y))}
 items.forEach((it,i)=>{const col=COLORS[i%COLORS.length];it.color=col;if(!it.f)return;ctx.strokeStyle=col;ctx.fillStyle=col;ctx.lineWidth=2.6;ctx.lineJoin='round';
  try{if(it.kind==='fx'){ctx.beginPath();let pen=false,prev=null;for(let px=0;px<=W;px+=1){const y=it.f({...it.env,x:ux(px)});const Y=sy(y);
     if(!isFinite(Y)||Math.abs(Y)>H*20||(prev!=null&&Math.abs(Y-prev)>H*2)){pen=false;prev=isFinite(Y)?Y:null;continue}
     if(pen)ctx.lineTo(px,Y);else{ctx.moveTo(px,Y);pen=true}prev=Y}ctx.stroke()}
   else if(it.kind==='vx'){const X=sx(it.f(it.env));ctx.beginPath();ctx.moveTo(X,0);ctx.lineTo(X,H);ctx.stroke()}
   else if(it.kind==='pt'){const[a,b]=it.f.pt;const X=sx(a(it.env)),Y=sy(b(it.env));ctx.beginPath();ctx.arc(X,Y,5,0,7);ctx.fill();ctx.fillStyle='#333';ctx.textAlign='left';ctx.textBaseline='bottom';ctx.fillText('('+fmt(a(it.env))+', '+fmt(b(it.env))+')',X+8,Y-4)}}catch(e){}})}
// --- expression list
function render(keep){items=analyze();const box=$('#rows');
 if(!keep){box.innerHTML='';rows.forEach((r,i)=>{const el=document.createElement('div');el.className='row';el.dataset.id=r.id;
  el.innerHTML='<div class="dot"><i></i></div><div class="body"><input autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"><div class="info"></div></div><button class="x">×</button>';
  const inp=el.querySelector('input');inp.value=r.text;
  inp.oninput=()=>{r.text=inp.value;render(true)};
  inp.onkeydown=e=>{if(e.key==='Enter'){const k=rows.indexOf(r);rows.splice(k+1,0,{id:nid++,text:''});render();setTimeout(()=>box.children[k+1].querySelector('input').focus(),0)}};
  el.querySelector('.x').onclick=()=>{rows=rows.filter(x=>x!==r);if(!rows.length)rows.push({id:nid++,text:''});render()};
  box.appendChild(el)})}
 [...box.children].forEach((el,i)=>{const it=items[i];if(!it)return;const info=el.querySelector('.info');
  el.querySelector('.dot i').style.background=['fx','vx','pt'].includes(it.kind)?COLORS[i%COLORS.length]:'transparent';
  if(it.kind==='val'||it.kind==='vx')info.innerHTML='<div class="val">= '+it.value.replace(/^x = /,'')+'</div>';
  else if(it.kind==='err')info.innerHTML='<div class="err">'+it.msg+'</div>';
  else if(it.kind==='slider'){const n=it.r.slider,s=sliders[n],v=parseFloat(it.r.text.split('=')[1]);
   if(!info.querySelector('input')){info.innerHTML='<div class="slider"><span>'+s.min+'</span><input type="range" step="0.1"><span>'+s.max+'</span></div>';
    const rg=info.querySelector('input');rg.min=s.min;rg.max=s.max;rg.oninput=()=>{it.r.text=n+'='+(+rg.value).toFixed(1);el.querySelector('.body input').value=it.r.text;render(true)}}
   info.querySelector('input').value=v}
  else info.innerHTML=''});
 draw()}
$('#add').onclick=()=>{rows.push({id:nid++,text:''});render();setTimeout(()=>$('#rows').lastChild.querySelector('input').focus(),0)};
// --- pan / pinch zoom / buttons
let ptrs=new Map(),last=null;
cv.addEventListener('pointerdown',e=>{cv.setPointerCapture(e.pointerId);ptrs.set(e.pointerId,{x:e.offsetX,y:e.offsetY})});
cv.addEventListener('pointermove',e=>{if(!ptrs.has(e.pointerId))return;const old=[...ptrs.values()];ptrs.set(e.pointerId,{x:e.offsetX,y:e.offsetY});const now=[...ptrs.values()];
 if(now.length===1){view.cx-=(now[0].x-old[0].x)/view.scale;view.cy+=(now[0].y-old[0].y)/view.scale}
 else if(now.length===2){const d0=Math.hypot(old[0].x-old[1].x,old[0].y-old[1].y),d1=Math.hypot(now[0].x-now[1].x,now[0].y-now[1].y);
  const mx=(now[0].x+now[1].x)/2,my=(now[0].y+now[1].y)/2;zoomAt(mx,my,d1/d0)}draw()});
const up=e=>ptrs.delete(e.pointerId);cv.addEventListener('pointerup',up);cv.addEventListener('pointercancel',up);
cv.addEventListener('wheel',e=>{e.preventDefault();zoomAt(e.offsetX,e.offsetY,Math.exp(-e.deltaY*0.002));draw()},{passive:false});
function zoomAt(px,py,k){const x=ux(px),y=uy(py);view.scale=Math.min(5e5,Math.max(1e-3,view.scale*k));view.cx=x-(px-W/2)/view.scale;view.cy=y+(py-H/2)/view.scale}
$('#zi').onclick=()=>{zoomAt(W/2,H/2,1.5);draw()};$('#zo').onclick=()=>{zoomAt(W/2,H/2,1/1.5);draw()};$('#home').onclick=()=>{view={cx:0,cy:0,scale:40};draw()};
// --- calculator mode (no graph, big keys)
const KEYS=['7','8','9','÷','(','4','5','6','×',')','1','2','3','−','^','0','.','π','+','√','sin','cos','tan','ln','⌫'];
const kb=$('#keys');KEYS.forEach(k=>{const b=document.createElement('button');b.textContent=k;b.onmousedown=e=>e.preventDefault();
 b.onclick=()=>{const inp=document.activeElement&&document.activeElement.tagName==='INPUT'?document.activeElement:$('#rows').lastChild.querySelector('input');
  const ins={'÷':'/','×':'*','−':'-','√':'sqrt(','sin':'sin(','cos':'cos(','tan':'tan(','ln':'ln(','π':'pi'}[k]??k;
  if(k==='⌫')inp.value=inp.value.slice(0,-1);else inp.value+=ins;inp.dispatchEvent(new Event('input'));inp.focus()};kb.appendChild(b)});
window.setMode=m=>{$('#list').classList.toggle('calc',m==='calc');$('#graph').style.display=m==='calc'?'none':'';if(m==='calc'&&rows.every(r=>/x/.test(r.text))){rows=[{id:nid++,text:''}];render()}size()};
window.addEventListener('resize',size);render();size();
</script></body></html>`;
