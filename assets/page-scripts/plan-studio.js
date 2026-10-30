import { getProjectSnapshot, renderProgressBar, renderRelatedPricing, onProjectChange } from '../../shared/project-context.js';
const CARDS = [
    { id: 'site', title: '01 · Site plan', page: 'site-plan.html', key: 'site-plan-draft', action: 'Place the house inside setbacks', detail: 'Lot, coverage, driveway' },
    { id: 'floorplan', title: '02 · Floorplan', page: 'Editor.html', key: 'floorplan3d_autosave', action: 'Draw walls, rooms, openings', detail: 'The source every plan stacks on' },
    { id: 'foundation', title: '03 · Foundation plan', page: 'foundation-designer.html', key: 'foundation-suite-draft', action: 'Size footings from soil + frost', detail: 'Strips, slab, rebar' },
    { id: 'framing', title: '04 · Framing plan', page: 'framing-designer.html', key: 'framing-suite-draft', action: 'Stud walls + headers', detail: 'Cut list + sheathing' },
    { id: 'mep', title: '05 · MEP plans', page: 'electrical-designer.html', key: 'electrical-suite-draft', action: 'Overlay plumbing + electrical', detail: 'Clash check in Layers' },
    { id: 'cost', title: '06 · Price the plans', page: 'bid-builder.html', key: 'bid-builder-state', action: 'Quotes → bid → schedule', detail: 'Every takeoff in one bid' }
];
function started(key) { try { const v = localStorage.getItem(key); return v != null && String(v).length > 2; } catch { return false; } }
function paintCards() {
    document.getElementById('plan-cards').innerHTML = CARDS.map((c) => {
        const on = started(c.key);
        return `<div class="rounded-lg border p-3 ${on ? 'step-done' : 'bg-white'} border-slate-200">
            <div class="flex items-center justify-between gap-2"><b class="text-[12px]">${c.title}</b><span class="text-[9px] font-bold ${on ? 'text-emerald-700' : 'text-slate-400'}">${on ? '● PLAN EXISTS' : '○ NOT STARTED'}</span></div>
            <p class="text-[11px] text-slate-600 mt-0.5">${c.action}</p>
            <p class="text-[10px] text-slate-400">${c.detail}</p>
            <a href="${c.page}" class="mt-2 inline-block rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold hover:bg-slate-50">${on ? 'Open + refine →' : 'Create plan →'}</a>
        </div>`;
    }).join('');
    document.getElementById('logic-list').innerHTML = CARDS.map((c, i) => {
        const next = CARDS[i + 1];
        return `<div class="rounded-lg border border-slate-200 p-2 bg-slate-50/60"><b>${c.title}.</b> ${c.action}.${next ? ` Then <a class="underline" href="${next.page}">${next.title}</a>.` : ' Then build.'}</div>`;
    }).join('');
}
function fitCanvas(id) {
    const c = document.getElementById(id), r = c.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    c.width = Math.max(r.width * dpr, 50); c.height = Math.max(r.height * dpr, 50);
    const x = c.getContext('2d'); x.scale(dpr, dpr);
    return { x, W: r.width, H: r.height };
}
function drawPlan() {
    const { x, W, H } = fitCanvas('v-plan');
    x.fillStyle = '#f8fafc'; x.fillRect(0, 0, W, H);
    let walls = [];
    try { const raw = JSON.parse(localStorage.getItem('floorplan3d_autosave') || 'null'); walls = raw?.walls || raw?.stories?.[0]?.walls || []; } catch {}
    x.fillStyle = '#0f172a'; x.font = 'bold 10px system-ui'; x.fillText(walls.length ? `${walls.length} WALLS · LIVE` : 'NO FLOORPLAN YET · OPEN EDITOR', 10, 18);
    if (!walls.length) { x.fillStyle = '#64748b'; x.font = '11px system-ui'; x.fillText('Draw walls in the Editor — this visual updates automatically.', 10, H / 2); return; }
    const pts = walls.flatMap((w) => [w.start || { x: w.x1 || 0, y: w.z1 || 0 }, w.end || { x: w.x2 || 0, y: w.z2 || 0 }]);
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const bw = Math.max(...xs) - Math.min(...xs) || 1, bh = Math.max(...ys) - Math.min(...ys) || 1;
    const s = Math.min((W - 40) / bw, (H - 60) / bh);
    const ox = 20 - Math.min(...xs) * s, oy = 36 - Math.min(...ys) * s;
    x.strokeStyle = '#0f172a'; x.lineWidth = 4; x.lineCap = 'round';
    walls.forEach((w) => {
        const a = w.start || { x: w.x1 || 0, y: w.z1 || 0 }, b = w.end || { x: w.x2 || 0, y: w.z2 || 0 };
        x.beginPath(); x.moveTo(ox + a.x * s, oy + a.y * s); x.lineTo(ox + b.x * s, oy + b.y * s); x.stroke();
    });
}
function drawOverlay() {
    const { x, W, H } = fitCanvas('v-overlay');
    x.fillStyle = '#0b1220'; x.fillRect(0, 0, W, H);
    x.font = 'bold 10px system-ui';
    x.fillStyle = '#7dd3fc'; x.fillText('SITE', 10, 18);
    x.strokeStyle = '#7dd3fc'; x.strokeRect(10, 26, W - 20, H - 60);
    x.fillStyle = '#86efac'; x.fillText('FOUNDATION', 10, H - 26);
    x.strokeStyle = '#86efac'; x.strokeRect(30, 46, W - 60, H - 100);
    x.fillStyle = '#fcd34d'; x.fillText('MEP', W - 50, 18);
    x.strokeStyle = '#fcd34d'; x.setLineDash([5, 4]);
    x.beginPath(); x.moveTo(30, H - 40); x.lineTo(W - 30, 46); x.stroke(); x.setLineDash([]);
    x.fillStyle = '#94a3b8'; x.font = '9px system-ui';
    x.fillText('One footprint · site + foundation + services stacked', 10, H - 10);
}
function paintAll() { paintCards(); drawPlan(); drawOverlay(); renderProgressBar(document.getElementById('studio-progress'), getProjectSnapshot()); }
document.getElementById('open-3d').addEventListener('click', () => import('../../shared/project-viewer.js').then(({ openProjectViewer }) => openProjectViewer()));
window.addEventListener('resize', () => { drawPlan(); drawOverlay(); });
onProjectChange(() => paintAll());
paintAll();
renderRelatedPricing(document.getElementById('related-pricing'), ['framing', 'plumbing', 'electrical']);
