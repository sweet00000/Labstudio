const COLORS=['#8eacd9','#75c6d3','#d5b17c','#a1c29b','#efbf78','#d79ba3','#9a99cd','#6dbfa6','#bbbd86'];
function setup(canvas) {
  const r=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio,2),w=r.width,h=r.height;
  if(!w||!h)return null;
  canvas.width=w*dpr;canvas.height=h*dpr;const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);
  ctx.font='9px ui-monospace, monospace';ctx.fillStyle='#8ba69b';
  return {ctx,w,h};
}
function axes(canvas,extent,xlabel='X · mm',ylabel='Y · mm') {
  const s=setup(canvas);if(!s)return null;
  const {ctx,w,h}=s,scale=Math.min((w-60)/(2*extent),(h-39)/(2*extent));
  const cx=w/2+9,cy=(h-23)/2+2,px=x=>cx+x*scale,py=y=>cy-y*scale;
  ctx.strokeStyle='#2a3d3e';ctx.lineWidth=.6;
  for(let i=-2;i<=2;i++){const v=i*extent/2;ctx.beginPath();ctx.moveTo(px(v),py(-extent));ctx.lineTo(px(v),py(extent));ctx.moveTo(px(-extent),py(v));ctx.lineTo(px(extent),py(v));ctx.stroke();ctx.fillStyle='#789189';ctx.textAlign='center';ctx.fillText(v.toFixed(0),px(v),py(-extent)+13);ctx.textAlign='right';ctx.fillText(v.toFixed(0),px(-extent)-5,py(v)+3);}
  ctx.fillStyle='#879f96';ctx.textAlign='left';ctx.fillText(ylabel,7,10);ctx.textAlign='right';ctx.fillText(xlabel,w-2,h-2);
  return {...s,px,py,scale,extent};
}
export function footprint(canvas,result) {
  const p=result.parameters,extent=Math.max(22,Math.min(65,p.aperture/2+p.width+5)),a=axes(canvas,extent);if(!a)return;
  const {ctx,px,py,scale}=a;
  ctx.save();ctx.beginPath();ctx.rect(px(-extent),py(extent),extent*2*scale,extent*2*scale);ctx.clip();
  ctx.globalAlpha=.65;
  for(const h of result.screenHits){ctx.fillStyle=COLORS[h.field];ctx.beginPath();ctx.arc(px(h.x),py(h.y),.85,0,Math.PI*2);ctx.fill();}
  ctx.globalAlpha=1;ctx.strokeStyle='#ddc8fb';ctx.fillStyle='#bda2df18';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(px(p.eyeX),py(p.eyeY),p.pupil/2*scale,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.restore();
}
export function heatColor(t){t=Math.max(0,Math.min(1,t));return `rgb(${Math.round(27+t*159)},${Math.round(49+t*174)},${Math.round(49+t*116)})`;}
export function eyebox(canvas,result) {
  const map=result.eyebox,a=axes(canvas,map.extent);if(!a)return;
  const {ctx,px,py,scale}=a,step=2*map.extent/(map.size-1),side=step*scale;
  for(const c of map.cells){ctx.fillStyle=heatColor(map.max?c.power/map.max:0);ctx.fillRect(px(c.x)-side/2,py(c.y)-side/2,side-.7,side-.7);if(c.coverage===1){ctx.strokeStyle='#cde4cd55';ctx.lineWidth=.6;ctx.strokeRect(px(c.x)-side/2,py(c.y)-side/2,side-.7,side-.7);}}
  const p=result.parameters;ctx.strokeStyle='#f4e2ff';ctx.lineWidth=1.6;ctx.beginPath();ctx.arc(px(p.eyeX),py(p.eyeY),4,0,Math.PI*2);ctx.moveTo(px(p.eyeX)-7,py(p.eyeY));ctx.lineTo(px(p.eyeX)+7,py(p.eyeY));ctx.moveTo(px(p.eyeX),py(p.eyeY)-7);ctx.lineTo(px(p.eyeX),py(p.eyeY)+7);ctx.stroke();
  canvas._mapPoint=e=>{const r=canvas.getBoundingClientRect();return {x:(e.clientX-r.left-px(0))/scale,y:-(e.clientY-r.top-py(0))/scale};};
}
export function sweepPlot(canvas,sweep) {
  const s=setup(canvas);if(!s)return;const {ctx,w,h}=s;
  if(!sweep){ctx.strokeStyle='#2a3d3e';for(let i=0;i<14;i++){ctx.beginPath();ctx.moveTo(42+i*(w-60)/13,12);ctx.lineTo(42+i*(w-60)/13,h-30);ctx.moveTo(42,12+i*(h-42)/13);ctx.lineTo(w-18,12+i*(h-42)/13);ctx.stroke();}return;}
  const scores=sweep.cells.filter(c=>c.feasible).map(c=>c.score),lo=Math.min(...scores),hi=Math.max(...scores),nx=sweep.radii.length,ny=sweep.distances.length;
  const left=47,top=14,cw=(w-left-12)/nx,ch=(h-45)/ny;
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){const cell=sweep.cells[j*nx+i],x=left+i*cw,y=top+(ny-1-j)*ch;ctx.fillStyle=cell.feasible?heatColor(1-(cell.score-lo)/(hi-lo||1)):'#322a2f';ctx.fillRect(x,y,cw-.7,ch-.7);if(cell===sweep.best){ctx.strokeStyle='#f4e9be';ctx.lineWidth=2;ctx.strokeRect(x+1,y+1,cw-2,ch-2);}}
  ctx.textAlign='center';ctx.fillStyle='#8ba69b';for(const i of [0,Math.floor(nx/2),nx-1])ctx.fillText(sweep.radii[i].toFixed(0),left+(i+.5)*cw,h-16);
  ctx.textAlign='right';for(const j of [0,Math.floor(ny/2),ny-1])ctx.fillText(sweep.distances[j].toFixed(1),left-6,top+(ny-j-.5)*ch+3);
  ctx.fillText('R · mm',w-3,h-2);ctx.textAlign='left';ctx.fillText('L · mm',2,10);
  canvas._sweepCell=e=>{const r=canvas.getBoundingClientRect(),i=Math.floor((e.clientX-r.left-left)/cw),j=ny-1-Math.floor((e.clientY-r.top-top)/ch);return i>=0&&i<nx&&j>=0&&j<ny?sweep.cells[j*nx+i]:null;};
}
