/**
 * Shared site chrome: the "Pages" dropdown in each page's header and the common
 * footer. Pages are static files, so this module injects one menu and one
 * footer rather than duplicating the markup in 27 HTML files.
 *
 * All links are relative to pages/, where every page lives. The dropdown is
 * appended to the page's existing header so full-screen studio pages keep their
 * layout; pages without a header get a floating menu instead.
 */

const SUB_GROUPS = [
    { title: 'Structure + shell', links: [['plan-studio.html', 'Plan studio'], ['site-plan.html', 'Site plan'], ['Editor.html', 'Floorplan'], ['wall-designer.html', 'Walls'], ['framing-designer.html', 'Framing'], ['foundation-designer.html', 'Foundation'], ['roof-designer.html', 'Roof'], ['stair-designer.html', 'Stairs'], ['stair-l-designer.html', 'L stair'], ['stair-u-designer.html', 'U stair'], ['stair-spiral-designer.html', 'Spiral stair'], ['stair-steep-designer.html', 'Steep stair']] },
    { title: 'Services', links: [['plumbing-designer.html', 'Plumbing'], ['electrical-designer.html', 'Electrical'], ['lighting-designer.html', 'Lighting'], ['kitchen-designer.html', 'Kitchen']] },
    { title: 'Outdoor + cost', links: [['deck-designer.html', 'Deck'], ['landscape-designer.html', 'Landscape'], ['price-book.html', 'Prices'], ['bid-builder.html', 'Bid'], ['project-schedule.html', 'Schedule'], ['permits-inspections.html', 'Permits']] }
];

const GROUPS = [
    {
        title: 'Studio',
        links: [
            ['Editor.html', '3D studio editor'],
            ['kitchen-designer.html', 'Kitchen suite'],
            ['demo.html', 'Guided demo'],
            ['app.html', 'Full app (legacy)'],
            ['webgpu-demo.html', 'WebGPU demo']
        ]
    },
    {
        title: 'Design suites',
        links: [
            ['lighting-designer.html', 'Lighting'],
            ['electrical-designer.html', 'Electrical'],
            ['plumbing-designer.html', 'Plumbing'],
            ['framing-designer.html', 'Framing'],
            ['deck-designer.html', 'Deck'],
            ['landscape-designer.html', 'Landscape'],
            ['roof-designer.html', 'Roof'],
            ['wall-designer.html', 'Walls & finishes'],
            ['stair-designer.html', 'Stairs'],
            ['stair-l-designer.html', 'L stair'],
            ['stair-u-designer.html', 'U stair'],
            ['stair-spiral-designer.html', 'Spiral stair'],
            ['stair-steep-designer.html', 'Steep stair']
        ]
    },
    {
        title: 'Tools',
        links: [
            ['calc.html', 'Calculators'],
            ['toolbox.html', '3D toolbox'],
            ['foundation-designer.html', 'Foundation'],
            ['project-schedule.html', 'Schedule'],
            ['permits-inspections.html', 'Permits'],
            ['price-book.html', 'Price book'],
            ['bid-builder.html', 'Bid builder'],
            ['project-dashboard.html', 'Project dashboard']
        ]
    },
    {
        title: 'Site',
        links: [
            ['index.html', 'Home'],
            ['features.html', 'Features'],
            ['pricing.html', 'Pricing'],
            ['gallery.html', 'Gallery'],
            ['about.html', 'About'],
            ['contact.html', 'Contact']
        ]
    },
    {
        title: 'Reference',
        links: [
            ['stair-gallery.html', 'Stair models'],
            ['stair-parts.html', 'Stair parts'],
            ['stair-glossary.html', 'Stair glossary']
        ]
    }
];

/* Global dark theme (all pages dark by default, toggle persisted). Pages that
 * already manage `html.dark` themselves (Editor, calc, index, …) are left
 * alone; light-only suites get shared/dark-mode.css mapped over them. */
const THEME_KEY = 'fp-theme';
let nativeDarkPage = false;

function siteTheme() {
    try {
        return localStorage.getItem(THEME_KEY) || 'dark';
    } catch {
        return 'dark';
    }
}

function applySiteTheme(theme) {
    const dark = theme !== 'light';
    document.documentElement.classList.toggle('dark', dark);
    try {
        localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
    } catch { /* private mode: theme just doesn't persist */ }
    const btn = document.querySelector('[data-site-theme]');
    if (btn) {
        btn.textContent = dark ? '☀️' : '🌙';
        btn.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
        btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
    }
}

function initSiteTheme() {
    nativeDarkPage = document.documentElement.classList.contains('dark');
    applySiteTheme(siteTheme());
    if (nativeDarkPage) return;
    if (!document.querySelector('link[data-site-dark]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.dataset.siteDark = 'true';
        link.href = /\/pages\//.test(window.location.pathname)
            ? '../shared/dark-mode.css'
            : 'shared/dark-mode.css';
        document.head.appendChild(link);
    }
}

function toggleSiteTheme() {
    applySiteTheme(siteTheme() === 'dark' ? 'light' : 'dark');
}

const STYLE = `
.site-menu-wrap { position: relative; display: inline-flex; align-items: center; margin-left: 0.5rem; }
.site-menu-wrap > summary { list-style: none; cursor: pointer; user-select: none; }
.site-menu-wrap > summary::-webkit-details-marker { display: none; }
.site-menu-toggle {
    display: inline-flex; align-items: center; gap: 0.25rem; padding: 0.3rem 0.6rem;
    border: 1px solid rgba(100, 116, 139, 0.35); border-radius: 0.375rem;
    font: 600 11px/1.2 system-ui, -apple-system, 'Segoe UI', sans-serif;
    color: #334155; background: #fff; white-space: nowrap;
}
.site-menu-toggle:hover { background: #f1f5f9; }
.site-menu-toggle .site-caret { font-size: 9px; opacity: 0.7; }
.site-menu-panel {
    position: absolute; right: 0; top: calc(100% + 6px); z-index: 200;
    width: min(92vw, 520px); max-height: 70vh; overflow-y: auto;
    display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.9rem 1.2rem;
    padding: 0.9rem 1rem; background: #fff; border: 1px solid #e2e8f0;
    border-radius: 0.6rem; box-shadow: 0 18px 40px rgba(15, 23, 42, 0.18);
    font: 12px/1.35 system-ui, -apple-system, 'Segoe UI', sans-serif; color: #0f172a;
    text-align: left;
}
.site-menu-group h4 {
    margin: 0 0 0.35rem; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase;
    color: #64748b; font-weight: 700;
}
.site-menu-group a {
    display: block; padding: 0.18rem 0.3rem; margin: 0 -0.3rem; border-radius: 0.25rem;
    color: #1e293b; text-decoration: none; white-space: nowrap; overflow: hidden;
    text-overflow: ellipsis;
}
.site-menu-group a:hover { background: #f1f5f9; color: #0f172a; }
.site-menu-group a[aria-current='page'] { color: #0284c7; font-weight: 700; }
.site-float {
    position: fixed; top: 0.6rem; right: 0.75rem; z-index: 210;
}
.site-footer {
    margin-top: 2.5rem; padding: 1.6rem 1.5rem 1.2rem; border-top: 1px solid #e2e8f0;
    background: #f8fafc; color: #475569;
    font: 12px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif;
}
.site-footer-inner { max-width: 1080px; margin: 0 auto; }
.site-footer-grid {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 1rem 1.5rem; margin-bottom: 1.1rem;
}
.site-footer h4 { margin: 0 0 0.35rem; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: #64748b; }
.site-footer a { display: block; color: #334155; text-decoration: none; padding: 0.1rem 0; }
.site-footer a:hover { color: #0284c7; }
.site-footer-brand { font-weight: 700; color: #0f172a; font-size: 13px; margin-bottom: 0.25rem; }
.site-footer-note { border-top: 1px solid #e2e8f0; padding-top: 0.75rem; color: #94a3b8; }
@media (max-width: 640px) {
    .site-menu-panel { grid-template-columns: minmax(0, 1fr); width: min(92vw, 320px); }
}
`;

function currentPage() {
    return window.location.pathname.split('/').pop() || 'index.html';
}

/*
 * Delegated actions (issue 10.4).
 *
 * A host that serves `Content-Security-Policy: script-src 'self'` refuses
 * inline `onclick="..."`, and a static host has no way to nonce it. Pages
 * therefore declare what a control does as an attribute, and this module runs
 * it from a single listener:
 *
 *   data-go="Editor.html"            navigate to a page
 *   data-clicks="#floorplan-upload"  forward the click to another element
 *   data-click="undo"                window.undo(), with `this` = the element
 *   data-input="setWallHeight"       window.setWallHeight(value, element)
 *   data-change="toggleFraming"      window.toggleFraming(checked, element)
 *
 * `data-args='["3d"]'` passes arguments; for `data-input`/`data-change` the
 * value follows them, so `data-input="setRoofOption" data-args='["pitch"]'`
 * calls `setRoofOption('pitch', value)`. An action name that is not a function
 * is reported through `window.reportClientError` instead of failing silently,
 * so a control that lost its binding lands in the support log rather than just
 * doing nothing.
 *
 * These directives replace the statements that inline attributes used to carry,
 * once `unsafe-inline` is gone:
 *
 *   data-show="#upload-modal"        remove the `hidden` class from a target
 *   data-hide="#upload-modal"        add it
 *   data-disclosure="#abilities-list" data-icon="#abilities-list-icon"
 *                                   toggle `hidden`, flip the chevron icon
 *   data-confirm="Clear project?"    ask before running the action
 *
 * A dotted action name walks from `window` and keeps its owner as `this`, so
 * `data-click="planOcr.runCurrent"` works.
 */

let actionsInstalled = false;

/** The function behind an action name, with the object it belongs to. */
function resolveAction(name) {
    const parts = String(name).split('.');
    let owner = window;
    for (const part of parts.slice(0, -1)) owner = owner?.[part];
    const fn = owner?.[parts[parts.length - 1]];
    return typeof fn === 'function' ? { fn, owner } : null;
}

function callAction(element, name, args = []) {
    const resolved = resolveAction(name);
    if (!resolved) {
        if (typeof window.reportClientError === 'function') {
            window.reportClientError(`No handler for action "${name}"`, { kind: 'action', fatal: false });
        }
        return;
    }
    resolved.fn.apply(resolved.owner === window ? element : resolved.owner, args);
}

function setHidden(selector, hidden) {
    const target = document.querySelector(selector);
    if (!target) return false;
    target.classList.toggle('hidden', hidden);
    return target.classList.contains('hidden');
}

function declaredArgs(element) {
    if (!element.dataset.args) return [];
    try {
        const parsed = JSON.parse(element.dataset.args);
        return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
        return [];
    }
}

function closestAction(target, attribute) {
    return target instanceof Element ? target.closest(`[${attribute}]`) : null;
}

function installActions() {
    if (actionsInstalled) return;
    actionsInstalled = true;

    document.addEventListener('click', (event) => {
        const go = closestAction(event.target, 'data-go');
        if (go) {
            event.preventDefault();
            window.location.assign(go.dataset.go);
            return;
        }
        const forward = closestAction(event.target, 'data-clicks');
        if (forward) {
            event.preventDefault();
            const target = document.querySelector(forward.dataset.clicks);
            if (target) target.click();
            return;
        }
        const show = closestAction(event.target, 'data-show');
        if (show) {
            event.preventDefault();
            setHidden(show.dataset.show, false);
            return;
        }
        const hide = closestAction(event.target, 'data-hide');
        if (hide) {
            event.preventDefault();
            setHidden(hide.dataset.hide, true);
            return;
        }
        const disclosure = closestAction(event.target, 'data-disclosure');
        if (disclosure) {
            event.preventDefault();
            const target = document.querySelector(disclosure.dataset.disclosure);
            if (target) {
                const hidden = setHidden(disclosure.dataset.disclosure, !target.classList.contains('hidden'));
                if (disclosure.dataset.icon) {
                    const icon = document.querySelector(disclosure.dataset.icon);
                    if (icon) icon.textContent = hidden ? 'chevron_right' : 'expand_more';
                }
            }
            return;
        }
        const action = closestAction(event.target, 'data-click');
        if (action) {
            event.preventDefault();
            if (action.dataset.confirm && !window.confirm(action.dataset.confirm)) return;
            callAction(action, action.dataset.click, declaredArgs(action));
        }
    });

    document.addEventListener('input', (event) => {
        const action = closestAction(event.target, 'data-input');
        if (action) {
            callAction(action, action.dataset.input, [...declaredArgs(action), action.value, action]);
        }
    });

    document.addEventListener('change', (event) => {
        const action = closestAction(event.target, 'data-change');
        if (!action) return;
        const checked = action.type === 'checkbox' || action.type === 'radio';
        callAction(action, action.dataset.change,
            [...declaredArgs(action), checked ? action.checked : action.value, action]);
    });
}

installActions();

function buildMenu() {
    const wrap = document.createElement('details');
    wrap.className = 'site-menu-wrap';
    wrap.id = 'site-nav-menu';

    const summary = document.createElement('summary');
    summary.className = 'site-menu-toggle';
    summary.title = 'Every page in the app';
    summary.innerHTML = 'Pages <span class="site-caret">▼</span>';
    wrap.appendChild(summary);

    const themeBtn = document.createElement('button');
    themeBtn.type = 'button';
    themeBtn.dataset.siteTheme = 'true';
    themeBtn.className = 'site-menu-toggle';
    themeBtn.style.marginLeft = '0.25rem';
    themeBtn.textContent = siteTheme() === 'dark' ? '☀️' : '🌙';
    themeBtn.title = 'Toggle dark / light mode';
    themeBtn.setAttribute('aria-pressed', siteTheme() === 'dark' ? 'true' : 'false');
    themeBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleSiteTheme();
    });
    wrap.appendChild(themeBtn);

    const panel = document.createElement('div');
    panel.className = 'site-menu-panel';
    const here = currentPage();
    GROUPS.forEach((group) => {
        const section = document.createElement('div');
        section.className = 'site-menu-group';
        const heading = document.createElement('h4');
        heading.textContent = group.title;
        section.appendChild(heading);
        group.links.forEach(([href, label]) => {
            const link = document.createElement('a');
            link.href = href;
            link.textContent = label;
            if (href === here) link.setAttribute('aria-current', 'page');
            section.appendChild(link);
        });
        panel.appendChild(section);
    });
    wrap.appendChild(panel);

    // Close on an outside click or Escape, like a normal menu.
    document.addEventListener('click', (event) => {
        if (!wrap.open) return;
        if (!wrap.contains(event.target)) wrap.open = false;
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') wrap.open = false;
    });

    return wrap;
}

function buildFooter() {
    const footer = document.createElement('footer');
    footer.className = 'site-footer';
    footer.id = 'site-footer';

    const inner = document.createElement('div');
    inner.className = 'site-footer-inner';

    const brand = document.createElement('div');
    brand.className = 'site-footer-brand';
    brand.textContent = 'Shaker 3D Floorplan';
    inner.appendChild(brand);

    const grid = document.createElement('div');
    grid.className = 'site-footer-grid';
    GROUPS.forEach((group) => {
        const column = document.createElement('div');
        const heading = document.createElement('h4');
        heading.textContent = group.title;
        column.appendChild(heading);
        group.links.slice(0, 6).forEach(([href, label]) => {
            const link = document.createElement('a');
            link.href = href;
            link.textContent = label;
            column.appendChild(link);
        });
        grid.appendChild(column);
    });
    inner.appendChild(grid);

    const note = document.createElement('div');
    note.className = 'site-footer-note';
    note.textContent = `Planning and estimating aid — confirm dimensions, codes and costs before building. © ${new Date().getFullYear()} Shaker 3D Floorplan.`;
    inner.appendChild(note);

    footer.appendChild(inner);
    return footer;
}

function mountProjectChrome() {
    // Construction-flow stepper + shared 3D viewer on every page.
    // Suite pages opt out with <body data-no-flow>. The strip mounts under
    // the header; the 3D button floats bottom-right and opens one overlay
    // built from the MAIN floorplan (Editor autosave) plus suite layers.
    try {
        if (document.body?.dataset?.noFlow !== undefined && document.body.dataset.noFlow !== 'false') return;
        if (document.getElementById('project-workflow-strip')) return;
        const mountStrip = () => {
            import('./project-workflow.js').then(({ renderWorkflowStrip }) => {
                if (document.getElementById('project-workflow-strip')) return;
                const host = document.createElement('div');
                host.id = 'project-workflow-strip';
                const header = document.querySelector('header');
                if (header?.parentElement) header.parentElement.insertBefore(host, header.nextSibling);
                else document.body.prepend(host);
                renderWorkflowStrip(host);
            }).catch(() => {});
        };
        const mountButton = () => {
            if (document.getElementById('project-3d-fab')) return;
            const btn = document.createElement('button');
            btn.id = 'project-3d-fab';
            btn.type = 'button';
            btn.title = 'Open the shared project 3D (main floorplan + suite layers)';
            btn.textContent = '⬢ Project 3D';
            btn.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:400;background:#0f172a;color:#fff;border:1px solid #334155;border-radius:999px;padding:9px 14px;font:700 12px system-ui;cursor:pointer;box-shadow:0 10px 28px rgba(15,23,42,.35)';
            btn.addEventListener('click', () => {
                import('./project-viewer.js').then(({ openProjectViewer }) => openProjectViewer()).catch(() => {
                    window.location.assign('Editor.html');
                });
            });
            document.body.appendChild(btn);
        };
        const mountRelated = () => {
            import('./related-pages.js').then(({ subsFor, relatedFor, PRICING_RELEVANCE }) => {
                import('./project-context.js').then(({ getProjectSnapshot, renderProgressBar, renderRelatedPricing, onProjectChange }) => {
                    if (document.getElementById('project-related-strip')) return;
                    const here = (window.location.pathname.split('/').pop() || 'index.html').split('?')[0];
                    const subs = subsFor(here);
                    const related = relatedFor(here);
                    if (!subs.length && !related.length) return;
                    const host = document.createElement('div');
                    host.id = 'project-related-strip';
                    host.style.cssText = 'background:#f8fafc;border-bottom:1px solid #e2e8f0;padding:6px 12px;display:flex;gap:10px;flex-wrap:wrap;align-items:flex-start';
                    const subHtml = subs.length ? `<div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center"><span style="font:700 9px system-ui;letter-spacing:.08em;color:#64748b">IN THIS PAGE:</span>${subs.map((s) => `<button data-subtab="${s.subtab || ''}" data-sub="${s.id}" title="${s.detail}" style="border:1px solid #cbd5e1;background:#fff;border-radius:99px;padding:2px 9px;font:600 10px system-ui;cursor:pointer">${s.label}</button>`).join('')}</div>` : '';
                    const relHtml = related.length ? `<div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center"><span style="font:700 9px system-ui;letter-spacing:.08em;color:#64748b">WORKS WITH:</span>${related.map((r) => `<a href="${r.page}" title="${r.reason}" style="border:1px solid #e2e8f0;background:#fff;border-radius:8px;padding:2px 8px;font:600 10px system-ui;text-decoration:none;color:#0f172a">${r.page.replace('-designer.html', '').replace('.html', '')} · ${r.reason}</a>`).join('')}</div>` : '';
                    host.innerHTML = `${subHtml}${relHtml}<div id="pr-progress" style="margin-left:auto;min-width:180px;flex:1;max-width:280px"></div><div id="pr-pricing" style="display:flex;gap:6px;flex-wrap:wrap"></div>`;
                    const anchor = document.getElementById('project-workflow-strip');
                    if (anchor?.parentElement) anchor.parentElement.insertBefore(host, anchor.nextSibling);
                    else document.body.prepend(host);
                    host.addEventListener('click', (e) => {
                        const btn = e.target.closest('[data-subtab]');
                        if (!btn || !btn.dataset.subtab) return;
                        const tab = document.querySelector(`.tab[data-tab="${btn.dataset.subtab}"]`);
                        if (tab) tab.click();
                        else document.getElementById(`panel-${btn.dataset.subtab}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    });
                    const paint = () => {
                        const snap = getProjectSnapshot();
                        const p = host.querySelector('#pr-progress');
                        if (p) renderProgressBar(p, snap);
                    };
                    paint();
                    onProjectChange(paint);
                    const keys = PRICING_RELEVANCE[here] || [];
                    if (keys.length) renderRelatedPricing(host.querySelector('#pr-pricing'), keys.slice(0, 3));
                    else host.querySelector('#pr-pricing')?.remove();
                }).catch(() => {});
            }).catch(() => {});
        };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => { mountStrip(); mountButton(); mountRelated(); }, { once: true });
        } else {
            mountStrip();
            mountButton();
            mountRelated();
        }
    } catch { /* chrome must never break a suite page */ }
}

function mount() {
    initSiteTheme();
    if (document.getElementById('site-nav-menu') || document.getElementById('site-footer')) { mountProjectChrome(); return; }

    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    const menu = buildMenu();
    const header = document.querySelector('header');
    if (header) {
        header.appendChild(menu);
    } else {
        menu.classList.add('site-float');
        document.body.appendChild(menu);
    }

    document.body.appendChild(buildFooter());
    mountProjectChrome();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
} else {
    mount();
}
