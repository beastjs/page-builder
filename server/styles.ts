import type { TailwindSetup } from '../shared/types.js'

/** Only stylesheets that opt in with `@import "tailwindcss"` (or a subpath) are compiled by Tailwind. */
const TAILWIND_IMPORT = /@import\s+(?:url\(\s*)?["']tailwindcss(?:\/[\w.-]+)?["']/
export const usesTailwind = (css: string) => TAILWIND_IMPORT.test(css)

/** Packages that connect Tailwind v4 to a bundler; the builder cannot install them. */
const INTEGRATIONS = ['@tailwindcss/vite', '@tailwindcss/postcss', '@rsbuild/plugin-tailwindcss', '@tailwindcss/webpack']

const majorOf = (version: string | null) => { const major = version?.match(/\d+/)?.[0]; return major === undefined ? undefined : Number(major) }

export function tailwindSetup(packageJson: string | null, stylesheets: string[]): TailwindSetup {
  let dependencies: Record<string, string> = {}
  try {
    const manifest = packageJson ? JSON.parse(packageJson) as Record<string, Record<string, string> | undefined> : {}
    dependencies = { ...manifest.dependencies, ...manifest.devDependencies }
  } catch { /* An unreadable manifest reads as no dependencies. */ }
  const version = typeof dependencies.tailwindcss === 'string' ? dependencies.tailwindcss : null
  const integration = INTEGRATIONS.find(name => typeof dependencies[name] === 'string') ?? null
  // Ranges such as `latest` or `workspace:*` carry no major version, so they get the benefit of the doubt.
  const supported = version !== null && (majorOf(version) ?? 4) >= 4
  return { version, integration, stylesheet: stylesheets[0] ?? null, ready: supported && integration !== null && stylesheets.length > 0 }
}

/** What stands between the project and a studio section rendering as designed. */
export function tailwindWarnings(setup: TailwindSetup): string[] {
  const warnings: string[] = []
  if (setup.version === null) warnings.push('Studio sections are styled with Tailwind CSS v4, which this project does not install. Add tailwindcss and its bundler integration, such as @tailwindcss/vite.')
  else if ((majorOf(setup.version) ?? 4) < 4) warnings.push(`Studio sections need Tailwind CSS v4; this project uses tailwindcss ${setup.version}.`)
  if (setup.version !== null && setup.integration === null) warnings.push(`Add a Tailwind bundler integration (${INTEGRATIONS.slice(0, 3).join(', ')}) so section classes are compiled.`)
  if (setup.stylesheet === null) warnings.push('No stylesheet in the scanned folders imports tailwindcss. Add @import "tailwindcss" to your main stylesheet, then review again so the section base styles are added.')
  return warnings
}

/**
 * Element defaults sections rely on when a project has no Preflight reset, the keyframes their motion uses, and
 * the theme variables they read. Copied from play/src/playground/studio/page.ts (`STUDIO_STYLES` and `THEME_BASE`);
 * keep the two in step when the catalog is resynced.
 */
export const STYLES_MARKER = '/* Design Studio sections'
export const STUDIO_STYLES = `${STYLES_MARKER}: element defaults and motion. */
@layer base {
  [data-section], [data-section] * { box-sizing: border-box; }
  [data-section] :where(h1, h2, h3, h4, p, ul, ol, dl, dd, figure, blockquote) { margin: 0; }
  [data-section] :where(h1, h2, h3, h4) { font-size: inherit; font-weight: inherit; }
  [data-section] :where(ul, ol) { padding: 0; list-style: none; }
  [data-section] :where(a) { color: inherit; text-decoration: inherit; }
  [data-section] :where(button, input, select, textarea) { font: inherit; color: inherit; background: transparent; border: 0 solid; }
}
@keyframes studio-marquee { to { transform: translateX(-50%); } }
@keyframes studio-spin { to { transform: rotate(360deg); } }
@keyframes studio-rise { from { transform: translateY(0) scale(0.6); opacity: 0; } 12% { opacity: 1; } to { transform: translateY(-110vh) scale(1.15); opacity: 0; } }
@keyframes studio-sway { 0%, 100% { transform: rotate(-5deg); } 50% { transform: rotate(7deg); } }
@keyframes studio-fill { from { height: 0; } }
@layer base {
  :root {
    --studio-bg: transparent;
    --studio-fg: inherit;
    --studio-accent: currentColor;
  }
  [data-page] {
    color: var(--studio-fg);
    background-color: var(--studio-bg);
    font-family: var(--studio-font, inherit);
  }
}
`

/** The stylesheet with the studio block appended, or null when it already has one. */
export function addStudioStyles(css: string): string | null {
  if (css.includes(STYLES_MARKER)) return null
  return `${css.trimEnd()}\n\n${STUDIO_STYLES}`
}
