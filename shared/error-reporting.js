/**
 * Client error reporting.
 *
 * Loaded as a classic script in the head of every page, before any module, so
 * it sees boot failures as well as later ones. It captures uncaught errors,
 * unhandled promise rejections and failed resource loads, keeps the last 25 in
 * sessionStorage for support ("paste window.errorLog()"), and shows a small
 * notice for the first failure so a user is not left looking at a dead control.
 *
 * Point it at a collector by adding a meta tag to a page:
 *
 *   <meta name="error-endpoint" content="https://errors.example.com/collect">
 *
 * With no endpoint the report stays on the device (console + sessionStorage),
 * which is the useful default for a static deploy.
 */
(function installErrorReporting() {
    if (window.__errorReporting) return;

    const KEY = 'floorplan3d_error_log';
    const LIMIT = 25;
    const endpoint = document.querySelector('meta[name="error-endpoint"]')?.content || '';

    const read = () => {
        try {
            const parsed = JSON.parse(sessionStorage.getItem(KEY) || '[]');
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    };

    const write = (entry) => {
        try {
            sessionStorage.setItem(KEY, JSON.stringify([...read(), entry].slice(-LIMIT)));
        } catch {
            /* storage full or blocked: the console line still exists */
        }
    };

    const beacon = (entry) => {
        if (!endpoint) return;
        try {
            navigator.sendBeacon(endpoint, new Blob([JSON.stringify(entry)], { type: 'application/json' }));
        } catch {
            /* reporting must never throw */
        }
    };

    function notice(text) {
        const show = () => {
            if (document.getElementById('client-error-notice')) return;
            const box = document.createElement('div');
            box.id = 'client-error-notice';
            box.setAttribute('role', 'alert');
            // Inline styles: the notice has to work when a stylesheet failed.
            box.style.cssText = [
                'position:fixed', 'left:16px', 'bottom:16px', 'z-index:2147483647',
                'max-width:360px', 'display:flex', 'gap:12px', 'align-items:flex-start',
                'padding:12px 14px', 'border-radius:10px', 'background:#111827',
                'color:#f9fafb', 'font:13px/1.45 system-ui, sans-serif',
                'box-shadow:0 8px 24px rgba(0,0,0,.35)'
            ].join(';');
            box.innerHTML = `<div><strong style="display:block;margin-bottom:2px">Something went wrong</strong>${text}</div>`;
            const close = document.createElement('button');
            close.type = 'button';
            close.textContent = '\u00d7';
            close.setAttribute('aria-label', 'Dismiss');
            close.style.cssText = 'background:none;border:0;color:#9ca3af;font-size:16px;line-height:1;cursor:pointer;padding:0 2px';
            close.addEventListener('click', () => box.remove());
            box.appendChild(close);
            document.body.appendChild(box);
            // Do not let a banner outlive the moment it is useful.
            setTimeout(() => box.remove(), 20000);
        };
        if (document.body) show();
        else document.addEventListener('DOMContentLoaded', show, { once: true });
    }

    /** Record one failure. Returns the stored entry. */
    function capture(message, { source = location.pathname, stack = '', kind = 'error', fatal = true } = {}) {
        const entry = {
            kind,
            message: String(message || 'Unknown error'),
            source,
            stack: String(stack || ''),
            page: location.pathname,
            at: new Date().toISOString()
        };
        console.error('[error-report]', entry.message, entry);
        write(entry);
        beacon(entry);
        if (fatal) notice('The details were logged; you can continue, but reload if a control stops responding.');
        return entry;
    }

    window.reportClientError = (error, extra = {}) => capture(
        error && error.message ? error.message : error,
        { source: extra.source, stack: error && error.stack, kind: extra.kind || 'reported', fatal: extra.fatal !== false }
    );
    window.errorLog = read;
    window.errorEndpoint = endpoint || null;

    window.addEventListener('error', (event) => {
        // A failed <img>/<script> bubbles as an error event with a target and no
        // error object; report it as a resource problem without a banner.
        if (event.target && event.target !== window && event.target.tagName) {
            const target = event.target;
            capture(`${target.tagName} failed to load: ${target.src || target.href || target.currentSrc || ''}`, {
                source: location.pathname,
                kind: 'resource',
                fatal: false
            });
            return;
        }
        capture(event.message || 'Script error', {
            source: `${event.filename || location.pathname}:${event.lineno || 0}:${event.colno || 0}`,
            stack: event.error && event.error.stack
        });
    }, true);

    window.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason;
        capture(reason && reason.message ? reason.message : reason, {
            source: reason && reason.stack ? String(reason.stack).split('\n')[1]?.trim() || location.pathname : location.pathname,
            stack: reason && reason.stack,
            kind: 'rejection'
        });
    });

    window.__errorReporting = { capture, read };
})();
