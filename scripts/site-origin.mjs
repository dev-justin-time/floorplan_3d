/**
 * The one place the site's public origin is declared.
 *
 * GitHub Pages serves a project site from https://<user>.github.io/<repo>/, so
 * every absolute URL — canonical, `og:url`, the sitemap and its line in
 * robots.txt — carries that subpath. Moving to a custom domain is this constant
 * plus `node scripts/generate-sitemap.mjs`: the page gate fails while any page,
 * the sitemap or robots.txt still names the old origin, so the move cannot be
 * half-done.
 */

export const SITE_ORIGIN = 'https://dev-justin-time.github.io/floorplan_3d';

/** The public landing page. The root `index.html` only redirects to it. */
export const LANDING_PAGE = 'pages/index.html';

/** Absolute URL for a project-relative path such as `pages/calc.html`. */
export function pageUrl(relative) {
    return `${SITE_ORIGIN}/${relative.replace(/\\/g, '/').replace(/^\/+/, '')}`;
}

export const SITEMAP_PATH = 'sitemap.xml';
export const SITEMAP_URL = pageUrl(SITEMAP_PATH);
