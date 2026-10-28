/**
 * Tailwind build for the static site.
 *
 * The pages used to load `cdn.tailwindcss.com` (Tailwind Play), which compiles
 * utilities in the browser on every load and is documented as development-only.
 * `npm run build:css` compiles the same configuration here instead, and the
 * pages link the generated `assets/tailwind.css`.
 *
 * The theme extends mirror the inline `tailwind.config` blocks the pages used
 * to set: the brand primary and background colours plus the Space Grotesk
 * display face. Keep this file in step with any new utility configuration.
 */
module.exports = {
    darkMode: 'class',
    content: [
        './index.html',
        './pages/**/*.html',
        './assets/style.css',
        './shared/**/*.js',
        './core/**/*.js',
        './engine/**/*.js',
        './scene/**/*.js',
        './editor/**/*.js',
        './demo/**/*.js',
        './features/**/*.js',
        './app/js/**/*.js'
    ],
    theme: {
        extend: {
            colors: {
                primary: '#13a4ec',
                'background-light': '#f6f7f8',
                'background-dark': '#101c22',
                // calc.html's former inline config; the shades it defined are
                // kept exactly so the calculator page looks unchanged.
                brand: {
                    50: '#f0f9ff',
                    100: '#e0f2fe',
                    500: '#0ea5e9',
                    600: '#0284c7',
                    900: '#0c4a6e'
                }
            },
            fontFamily: {
                display: ['Space Grotesk', 'sans-serif'],
                sans: ['Inter', 'sans-serif']
            }
        }
    },
    plugins: [
        require('@tailwindcss/forms'),
        require('@tailwindcss/container-queries')
    ]
};
