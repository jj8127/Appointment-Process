#!/usr/bin/env node
// Offline diagnostics only. Uses a fully fictional deterministic topology; never queries a service.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText, filename,
);
const previous = require('../../lib/referral-graph-native.ts');
const readable = require('../../lib/referral-graph-readable.ts');
const { fictionalStressDownline } = require('../../lib/__tests__/fixtures/referral-graph-fixtures.ts');
const { nodes, edges } = fictionalStressDownline();
const width = 360, height = 520;
const start = performance.now();
const positions = readable.buildReadableReferralGraphLayout(nodes, edges);
const layoutMs = performance.now() - start;
const oldPositions = previous.buildReferralGraphLayout(nodes, edges);
const fit = readable.getReadableReferralGraphViewport({ positions, width, height });
const oldFit = previous.getReferralGraphFitViewport({ nodes, positions: oldPositions, width, height });
const visuals = [];
function sample(kind, scale) {
  const points = kind === 'before' ? oldPositions : positions;
  const visualScale = kind === 'before' ? Math.min(1.4, Math.max(0.25, scale)) : readable.getReferralGraphVisualScale(scale);
  const labels = kind === 'before'
    ? new Map(nodes.map((node) => [node.id, { width: 120, height: 14, offsetX: -60,
      offsetY: previous.getReferralGraphNodeScreenRadius(node.totalDescendantCount) * visualScale + 6 }]))
    : readable.buildReferralGraphLabels({ nodes, positions: points, scale });
  const viewport = kind === 'before' ? oldFit : fit;
  const circles = nodes.map((node, index) => ({ id: node.id, index,
    ...readable.projectReferralGraphPoint(points.get(node.id), scale, viewport.panX * scale / viewport.scale, viewport.panY * scale / viewport.scale, width, height),
    r: previous.getReferralGraphNodeScreenRadius(node.totalDescendantCount) * visualScale,
  }));
  const byId = new Map(circles.map((circle) => [circle.id, circle]));
  const boxes = Array.from(labels, ([id, label]) => ({ id, x: byId.get(id).x + label.offsetX,
    y: byId.get(id).y + label.offsetY, width: label.width, height: label.height }));
  let nodePairs = 0, labelPairs = 0, labelNodePairs = 0, minCenterDp = Infinity;
  for (let i = 0; i < circles.length; i++) for (let j = i + 1; j < circles.length; j++) {
    const a = circles[i], b = circles[j], distance = Math.hypot(a.x - b.x, a.y - b.y);
    minCenterDp = Math.min(minCenterDp, distance);
    if (distance < a.r + b.r - 1e-6) nodePairs++;
  }
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i];
    for (let j = i + 1; j < boxes.length; j++) {
      const b = boxes[j];
      if (a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y) labelPairs++;
    }
    for (const circle of circles) {
      const dx = Math.max(a.x - circle.x, 0, circle.x - a.x - a.width);
      const dy = Math.max(a.y - circle.y, 0, circle.y - a.y - a.height);
      if (dx * dx + dy * dy < circle.r * circle.r - 1e-6) labelNodePairs++;
    }
  }
  const inViewport = (a) => a.x >= 0 && a.x <= width && a.y >= 0 && a.y <= height;
  visuals.push({ kind, scale, circles, boxes, visibleLabels: boxes.filter(inViewport).length });
  return { kind, scale: Number(scale.toFixed(6)), nodePairs, labelBoxPairs: labelPairs, labelNodePairs,
    placedLabels: labels.size, minCenterDp: Number(minCenterDp.toFixed(3)) };
}
function crossings(points) {
  const turn = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  let count = 0;
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    const e = edges[i], f = edges[j];
    if ([e.source, e.target].some((id) => id === f.source || id === f.target)) continue;
    const a = points.get(e.source), b = points.get(e.target), c = points.get(f.source), d = points.get(f.target);
    if (turn(a, b, c) * turn(a, b, d) < -1e-7 && turn(c, d, a) * turn(c, d, b) < -1e-7) count++;
  }
  return count;
}
const report = { source: 'entirely fictional deterministic 295-node stress tree', nodes: nodes.length, edges: edges.length,
  viewport: { width, height }, layoutMs: Number(layoutMs.toFixed(2)),
  edgeCrossings: { before: crossings(oldPositions), after: crossings(positions) },
  metrics: [sample('before', oldFit.scale), sample('after', fit.scale),
    sample('before', 0.31), sample('after', 0.31), sample('before', 1), sample('after', 1), sample('after', 6)],
};
console.log(JSON.stringify(report, null, 2));
const htmlIndex = process.argv.indexOf('--html');
if (htmlIndex >= 0) {
  if (!process.argv[htmlIndex + 1]) throw new Error('Expected HTML output path');
  const destination = path.resolve(process.argv[htmlIndex + 1]);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const payload = JSON.stringify({ report, visuals, edges }).replace(/</g, '\\u003c');
  const html = '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>추천 관계 배치 비교</title><style>' +
    '*{box-sizing:border-box}body{margin:0;background:#f8fafc;color:#334155;font:15px system-ui,sans-serif}main{max-width:1040px;margin:auto;padding:32px 24px}h1{font-size:26px;margin:8px 0 12px;color:#17212e}p{line-height:1.6;margin:8px 0;color:#64748b}.eyebrow{font-size:12px;letter-spacing:.12em;color:#c65a1b;font-weight:800}.controls{display:flex;gap:8px;flex-wrap:wrap;margin:24px 0 16px}button{border:1px solid #d6dce4;border-radius:20px;background:white;color:#334155;padding:10px 18px;font:inherit;cursor:pointer}button[aria-pressed=true]{background:#fff0e5;border-color:#df7028;color:#ac4712;font-weight:700}button:focus-visible{outline:3px solid #2563eb;outline-offset:3px}.cards{display:grid;grid-template-columns:1fr 1fr;gap:20px}.card{background:white;border:1px solid #e2e8f0;border-radius:20px;overflow:hidden}.head{padding:18px 20px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center}.head strong{font-size:17px}.badge{font-size:12px;border-radius:20px;background:#f1f5f9;padding:6px 10px}svg{display:block;width:100%;background:#f8fafc;touch-action:none;cursor:grab;max-height:570px}.foot{padding:15px 20px;font-size:13px;border-top:1px solid #e2e8f0}.note{font-size:12px;margin-top:18px}@media(max-width:650px){main{padding:20px 12px}.cards{grid-template-columns:1fr}h1{font-size:23px}}</style>' +
    '<main><span class="eyebrow">REFERRAL GRAPH · LAYOUT CHECK</span><h1>같은 조직, 달라진 간격</h1>' +
    '<p>가상 노드 295개 · 연결 294개 · 최대 깊이 8. 독립적으로 생성한 가상 관계 구조의 배치 비교입니다.<br>드래그로 이동할 수 있습니다. 이름은 해당 배율에서 겹치지 않는 것부터 표시합니다.</p>' +
    '<div class="controls"><button data-mode="fit" aria-pressed="true">전체 보기</button><button data-mode="31" aria-pressed="false">31% 배율</button><button data-mode="100" aria-pressed="false">100% 배율</button></div>' +
    '<div class="cards"><section class="card"><div class="head"><strong>기존 배치</strong><span class="badge" id="before-zoom"></span></div><svg id="before" viewBox="0 0 360 520" aria-label="기존 그래프"></svg><div class="foot" id="before-metric"></div></section>' +
    '<section class="card"><div class="head"><strong>개선 배치</strong><span class="badge" id="after-zoom"></span></div><svg id="after" viewBox="0 0 360 520" aria-label="개선 그래프"></svg><div class="foot" id="after-metric"></div></section></div>' +
    '<p class="note">실제 앱의 배치·이름 선택 함수를 실행한 SVG 미리보기입니다. 인물 이름과 등록 상태는 포함하지 않으며, 네이티브 기기 검증을 대신하지 않습니다. 관계선 교차는 개선 배치에서 ' + report.edgeCrossings.after + '곳 남아 있습니다.</p></main>' +
    '<script>const data=' + payload + ';' +
    'const ns="http://www.w3.org/2000/svg";let mode="fit";function el(tag,attrs){const x=document.createElementNS(ns,tag);Object.entries(attrs).forEach(([k,v])=>x.setAttribute(k,v));return x}' +
    'function draw(){for(const kind of ["before","after"]){const index=mode==="fit"?(kind==="before"?0:1):mode==="31"?(kind==="before"?2:3):(kind==="before"?4:5);const sample=data.visuals[index],m=data.report.metrics[index],svg=document.getElementById(kind);svg.replaceChildren();const g=el("g",{});svg.append(g);const byId=new Map(sample.circles.map(n=>[n.id,n]));for(const edge of data.edges){const a=byId.get(edge.source),b=byId.get(edge.target);g.append(el("line",{x1:a.x,y1:a.y,x2:b.x,y2:b.y,stroke:"#cbd5e1","stroke-width":1.4}))}for(const n of sample.circles){g.append(el("circle",{cx:n.x,cy:n.y,r:n.r,fill:n.index===0?"#facc15":"#ea580c",stroke:"white","stroke-width":Math.min(1,n.r/4)}))}for(const b of sample.boxes){const n=byId.get(b.id),t=el("text",{x:b.x+b.width/2,y:b.y+11,"text-anchor":"middle","font-size":11,"font-weight":700,fill:"#334155"});t.textContent=n.index===0?"기준":String(n.index).padStart(3,"0");g.append(t)}document.getElementById(kind+"-zoom").textContent=(sample.scale*100).toFixed(1)+"%";document.getElementById(kind+"-metric").textContent="원 겹침 "+m.nodePairs+"쌍 · 이름 영역 겹침 "+m.labelBoxPairs+"쌍";let ox=0,oy=0,start;svg.onpointerdown=e=>{svg.setPointerCapture(e.pointerId);start={x:e.clientX,y:e.clientY,ox,oy}};svg.onpointermove=e=>{if(!start)return;const ratio=360/svg.getBoundingClientRect().width;ox=start.ox+(e.clientX-start.x)*ratio;oy=start.oy+(e.clientY-start.y)*ratio;g.setAttribute("transform","translate("+ox+" "+oy+")")};svg.onpointerup=()=>start=null;svg.onpointercancel=()=>start=null}}document.querySelectorAll("button").forEach(b=>b.onclick=()=>{mode=b.dataset.mode;document.querySelectorAll("button").forEach(x=>x.setAttribute("aria-pressed",String(x===b)));draw()});draw();</script></html>';
  fs.writeFileSync(destination, html, 'utf8');
}
