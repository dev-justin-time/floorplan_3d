import { deckOutline, polygonArea, polygonPerimeter } from './engine.js';

/**
 * 2D framing plan for the deck suite.
 *
 * World units are metres: x runs along the house, y runs away from it, and the
 * origin is the house wall at the left end of the deck. The canvas draws at a
 * fitted scale with zoom and pan so the guard, stair, posts and footing pads
 * can be read the way a framed plan is read on site.
 */

const PADDING = 70;
const clamp = (value, min, max) => Math.min(Math.max(Number(value) || min, min), max);

export function createDeckPlan(config = {}) {
    return normalizeDeckPlan({ config });
}

export function normalizeDeckPlan(raw = {}) {
    const config = { ...(raw.config || {}) };
    const outline = deckOutline(config);
    return { config, outline };
}

export function deckBounds(plan) {
    const outline = plan.outline || deckOutline(plan.config);
    return {
        minX: Math.min(...outline.map((point) => point.x)),
        maxX: Math.max(...outline.map((point) => point.x)),
        minY: Math.min(...outline.map((point) => point.y)),
        maxY: Math.max(...outline.map((point) => point.y))
    };
}

export function fitTransform(width, height, plan, view = {}) {
    const bounds = deckBounds(plan);
    const zoom = clamp(view.zoom ?? 1, 0.4, 5);
    const deckWidth = Math.max(bounds.maxX - bounds.minX, 1);
    const deckDepth = Math.max(bounds.maxY - bounds.minY, 1);
    const scale = Math.min(
        (width - PADDING * 2) / deckWidth,
        (height - PADDING * 2) / deckDepth
    ) * zoom;
    const originX = width / 2 - ((bounds.minX + bounds.maxX) / 2) * scale + (Number(view.panX) || 0);
    const originY = height / 2 - ((bounds.minY + bounds.maxY) / 2) * scale + (Number(view.panY) || 0);

    return {
        scale,
        originX,
        originY,
        toScreen: (x, y) => ({ x: originX + x * scale, y: originY + y * scale }),
        toWorld: (x, y) => ({ x: (x - originX) / scale, y: (y - originY) / scale })
    };
}

/** Hit test for the post and footing schedule. */
export function postAt(plan, design, point, tolerance = 0.25) {
    const { beams, attached } = design?.geometry || {};
    if (!beams?.length) return null;
    const config = plan.config;
    const posts = [];
    beams.forEach((line) => {
        const count = Math.max(2, Math.ceil(line.length / Math.max(config.postSpacingM, 0.4)) + 1);
        for (let index = 0; index < count; index += 1) {
            const x = (line.length * index) / (count - 1);
            posts.push({ x, y: line.y, beam: line.label });
        }
    });
    if (!attached) {
        // The rear beam mirrors the front one.
        const rear = beams.find((line) => line.y < 0.5);
        if (rear) {
            const count = Math.max(2, Math.ceil(rear.length / Math.max(config.postSpacingM, 0.4)) + 1);
            for (let index = 0; index < count; index += 1) {
                posts.push({ x: (rear.length * index) / (count - 1), y: rear.y, beam: rear.label });
            }
        }
    }
    return posts.find((post) => Math.hypot(post.x - point.x, post.y - point.y) <= tolerance) || null;
}

/** World-space band check for the stair run at the front of the deck. */
export function stairAt(plan, point, tolerance = 0.3) {
    const config = plan.config;
    if (!config.stairs) return false;
    const half = config.stairWidthM / 2;
    const startY = config.depth - 0.05;
    return Math.abs(point.x - config.width / 2) <= half + tolerance
        && point.y >= startY - tolerance
        && point.y <= startY + 0.9;
}

function polygonPath(ctx, transform, points) {
    ctx.beginPath();
    points.forEach((point, index) => {
        const screen = transform.toScreen(point.x, point.y);
        if (index === 0) ctx.moveTo(screen.x, screen.y);
        else ctx.lineTo(screen.x, screen.y);
    });
    ctx.closePath();
}

function arrow(ctx, from, to, colour = '#475569') {
    ctx.strokeStyle = colour;
    ctx.fillStyle = colour;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    [[from, angle], [to, angle + Math.PI]].forEach(([point, direction]) => {
        ctx.beginPath();
        ctx.moveTo(point.x, point.y);
        ctx.lineTo(point.x - Math.cos(direction - 0.4) * 6, point.y - Math.sin(direction - 0.4) * 6);
        ctx.lineTo(point.x - Math.cos(direction + 0.4) * 6, point.y - Math.sin(direction + 0.4) * 6);
        ctx.closePath();
        ctx.fill();
    });
}

function dimension(ctx, from, to, text, colour = '#475569') {
    arrow(ctx, from, to, colour);
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    ctx.font = '10px ui-monospace, monospace';
    const width = ctx.measureText(text).width + 8;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(mid.x - width / 2, mid.y - 8, width, 14);
    ctx.fillStyle = colour;
    ctx.textAlign = 'center';
    ctx.fillText(text, mid.x, mid.y + 2);
}

/** A hatched wall band along the house edge. */
function drawHouse(ctx, transform, width, view) {
    const left = transform.toScreen(-0.35, 0);
    const right = transform.toScreen(width + 0.35, 0);
    const bottom = transform.toScreen(0, -0.35);
    ctx.fillStyle = '#cbd5e1';
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(left.x, bottom.y, right.x - left.x, left.y - bottom.y);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1;
    for (let x = left.x; x < right.x; x += 8) {
        ctx.beginPath();
        ctx.moveTo(x, left.y);
        ctx.lineTo(x + 8, bottom.y);
        ctx.stroke();
    }
    if (view !== false) {
        const label = transform.toScreen(width / 2, -0.62);
        ctx.fillStyle = '#475569';
        ctx.font = '10px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText('HOUSE', label.x, label.y);
    }
}

export function drawDeckPlan(ctx, width, height, plan, design, options = {}) {
    const view = options.view || {};
    const show = { joists: true, beam: true, posts: true, footings: true, guard: true, stairs: true, dimensions: true, ...(options.show || {}) };
    const transform = fitTransform(width, height, plan, view);
    const config = plan.config;
    const outline = plan.outline || deckOutline(config);
    const dpr = options.dpr || 1;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    // Background grid at one metre.
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, width, height);
    const bounds = deckBounds(plan);
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    for (let x = Math.floor(bounds.minX); x <= Math.ceil(bounds.maxX) + 1; x += 1) {
        const start = transform.toScreen(x, bounds.minY - 1.5);
        const end = transform.toScreen(x, bounds.maxY + 1.5);
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
    }
    for (let y = Math.floor(bounds.minY); y <= Math.ceil(bounds.maxY) + 1; y += 1) {
        const start = transform.toScreen(bounds.minX - 1.5, y);
        const end = transform.toScreen(bounds.maxX + 1.5, y);
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
    }

    // Deck platform.
    polygonPath(ctx, transform, outline);
    ctx.fillStyle = 'rgba(180, 138, 92, 0.18)';
    ctx.fill();
    ctx.strokeStyle = '#8a5a2b';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Joists.
    if (show.joists) {
        ctx.strokeStyle = 'rgba(120, 83, 44, 0.55)';
        ctx.lineWidth = 1;
        const spacing = (Number(config.joistSpacingIn) || 16) * 0.0254;
        for (let x = spacing; x < config.width - 1e-6; x += spacing) {
            const from = transform.toScreen(x, 0);
            const to = transform.toScreen(x, config.depth);
            ctx.beginPath();
            ctx.moveTo(from.x, from.y);
            ctx.lineTo(to.x, to.y);
            ctx.stroke();
        }
        // Rim joists on the three open edges.
        ctx.strokeStyle = '#6b4423';
        ctx.lineWidth = 2.5;
        polygonPath(ctx, transform, outline);
        ctx.stroke();
    }

    // Beams.
    if (show.beam && design?.geometry?.beams) {
        ctx.strokeStyle = '#b45309';
        ctx.lineWidth = 3.5;
        design.geometry.beams.forEach((line) => {
            const from = transform.toScreen(0, line.y);
            const to = transform.toScreen(line.length === config.width ? config.width : line.length, line.y);
            ctx.beginPath();
            ctx.moveTo(from.x, from.y);
            ctx.lineTo(to.x, to.y);
            ctx.stroke();
        });
    }

    // Posts and footings.
    if (design?.geometry?.beams) {
        design.geometry.beams.forEach((line) => {
            const count = Math.max(2, Math.ceil(line.length / Math.max(config.postSpacingM, 0.4)) + 1);
            for (let index = 0; index < count; index += 1) {
                const x = (line.length * index) / (count - 1);
                const centre = transform.toScreen(x, line.y);
                if (show.footings) {
                    ctx.beginPath();
                    ctx.arc(centre.x, centre.y, (design.footing.diameterIn * 0.0254 / 2) * transform.scale, 0, Math.PI * 2);
                    ctx.fillStyle = 'rgba(148, 163, 184, 0.35)';
                    ctx.fill();
                    ctx.strokeStyle = '#64748b';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                }
                if (show.posts) {
                    const side = (config.postSize === '6x6' ? 5.5 : 3.5) * 0.0254 * transform.scale;
                    ctx.fillStyle = '#7c2d12';
                    ctx.fillRect(centre.x - side / 2, centre.y - side / 2, side, side);
                    ctx.strokeStyle = '#431407';
                    ctx.strokeRect(centre.x - side / 2, centre.y - side / 2, side, side);
                }
            }
        });
    }

    // Guard on the open edges.
    if (show.guard && design?.guard?.lengthM > 0) {
        ctx.strokeStyle = '#0f766e';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 3]);
        const attached = config.ledger === 'house';
        outline.forEach((point, index) => {
            const next = outline[(index + 1) % outline.length];
            const onHouse = attached && Math.abs(point.y) < 1e-6 && Math.abs(next.y) < 1e-6;
            if (onHouse) return;
            const from = transform.toScreen(point.x, point.y);
            const to = transform.toScreen(next.x, next.y);
            ctx.beginPath();
            ctx.moveTo(from.x, from.y);
            ctx.lineTo(to.x, to.y);
            ctx.stroke();
        });
        ctx.setLineDash([]);
        // Guard posts.
        const spacing = design.guard.postSpacingM;
        outline.forEach((point, index) => {
            const next = outline[(index + 1) % outline.length];
            const onHouse = attached && Math.abs(point.y) < 1e-6 && Math.abs(next.y) < 1e-6;
            if (onHouse) return;
            const length = Math.hypot(next.x - point.x, next.y - point.y);
            const count = Math.floor(length / spacing);
            for (let step = 0; step <= count; step += 1) {
                const t = count === 0 ? 0 : step / count;
                const x = point.x + (next.x - point.x) * t;
                const y = point.y + (next.y - point.y) * t;
                const screen = transform.toScreen(x, y);
                ctx.fillStyle = '#0f766e';
                ctx.fillRect(screen.x - 2, screen.y - 2, 4, 4);
            }
        });
    }

    // Stair run.
    if (show.stairs && config.stairs && design?.stair?.risers) {
        const widthM = config.stairWidthM;
        const half = widthM / 2;
        const cx = config.width / 2;
        const treads = design.stair.treads;
        const runM = design.stair.runM;
        const treadDepth = runM / Math.max(treads, 1);
        const startY = config.depth;
        ctx.fillStyle = 'rgba(148, 163, 184, 0.18)';
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1.2;
        for (let index = 0; index < treads; index += 1) {
            const y1 = startY + index * treadDepth;
            const y2 = y1 + treadDepth;
            const topLeft = transform.toScreen(cx - half, y1);
            const bottomRight = transform.toScreen(cx + half, y2);
            ctx.fillRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
            ctx.strokeRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
        }
        const label = transform.toScreen(cx, startY + runM + 0.35);
        ctx.fillStyle = '#334155';
        ctx.font = '10px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${design.stair.risers} RISERS · ${Math.round(design.stair.riserMm)} MM`, label.x, label.y);
    }

    drawHouse(ctx, transform, config.width);

    // Dimensions.
    if (show.dimensions) {
        const widthLine = transform.toScreen(config.width, config.depth + 0.9);
        const widthStart = transform.toScreen(0, config.depth + 0.9);
        dimension(ctx, widthStart, widthLine, `${(config.width * 1000).toFixed(0)} mm`);
        const depthStart = transform.toScreen(-0.9, 0);
        const depthEnd = transform.toScreen(-0.9, config.depth);
        dimension(ctx, depthStart, depthEnd, `${(config.depth * 1000).toFixed(0)} mm`);
    }

    // Scale bar and legend.
    const barMetres = transform.scale > 90 ? 1 : 2;
    const barFrom = { x: 24, y: height - 26 };
    const barTo = { x: 24 + barMetres * transform.scale, y: height - 26 };
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(barFrom.x, barFrom.y);
    ctx.lineTo(barTo.x, barTo.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(barFrom.x, barFrom.y - 4);
    ctx.lineTo(barFrom.x, barFrom.y + 4);
    ctx.moveTo(barTo.x, barTo.y - 4);
    ctx.lineTo(barTo.x, barTo.y + 4);
    ctx.stroke();
    ctx.fillStyle = '#334155';
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${barMetres} m`, barTo.x + 6, barFrom.y + 3);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#475569';
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillText(`${polygonArea(outline).toFixed(1)} m² DECK`, width - 20, 26);
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillStyle = '#64748b';
    ctx.fillText(`PERIMETER ${polygonPerimeter(outline).toFixed(1)} m`, width - 20, 42);

    ctx.restore();
}
