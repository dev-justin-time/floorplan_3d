/**
 * Shared site chrome: the "Pages" dropdown in each page's header and the common
 * footer. Pages are static files, so this module injects one menu and one
 * footer rather than duplicating the markup in 27 HTML files.
 *
 * All links are relative to pages/, where every page lives. The dropdown is
 * appended to the page's existing header so full-screen studio pages keep their
 * layout; pages without a header get a floating menu instead.
 */

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
            ['stair-designer.html', 'Stairs']
        ]
    },
    {
        title: 'Tools',
        links: [
            ['calc.html', 'Calculators'],
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

function buildMenu() {
    const wrap = document.createElement('details');
    wrap.className = 'site-menu-wrap';
    wrap.id = 'site-nav-menu';

    const summary = document.createElement('summary');
    summary.className = 'site-menu-toggle';
    summary.title = 'Every page in the app';
    summary.innerHTML = 'Pages <span class="site-caret">▼</span>';
    wrap.appendChild(summary);

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

function mount() {
    if (document.getElementById('site-nav-menu') || document.getElementById('site-footer')) return;

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
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
} else {
    mount();
}
