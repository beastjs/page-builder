# Beast Page Builder

A floating page builder for Beast projects. Press **⌘B** on macOS or **Ctrl+B** elsewhere: the widget transitions in, scans your project with a hexagonal sonar animation, and opens a searchable list of pages, components, navigation menus, tabs, and actions. Creating a page scaffolds its BTSX file, registers its URL in `src/router.ts`, and adds its navigation link in one reviewed change.

The plugin runs on development servers only. The widget uses an isolated Shadow DOM and a prebuilt browser bundle with its own Octane runtime, so the host app needs no additional widget styles or runtime setup.

## Try it locally

Requires Bun and Node.js 22.22.2 or newer.

```sh
bun install
bun run dev
```

Open `http://127.0.0.1:5190` and press **⌘B**, or click **Builder** in the bottom-right corner. The playground is a real Beast/Octane app; its `.btsx` files appear in the scan.

## Client development

Track the remaining sections and their task checklists in the [BTSX migration plan](MIGRATION_PLAN.md).

The search palette lives in `client/palette/*.btsx`, and the tabs editor lives in `client/tabs/*.btsx`. Palette action construction and filtering live in `client/palette/actions.ts`; the remaining views and the widget shell are TypeScript. `scripts/build.ts` stays plain TypeScript and compiles BTSX through Beast and Octane before esbuild bundles the client, including source-distributed Octane bindings. Consumers still receive a self-contained `dist/client.js` on Vite, Rspack, and Rsbuild.

Shared headers, action footers, and status messages live in `client/ui/`. The tabs editor uses these components, and the palette shares the status message. New views should reuse them as they migrate.

`bun run typecheck` checks the TypeScript shell and type-checks generated TSRX for the client components in a temporary directory. Edit the authored BTSX files; the check removes its generated files afterward. The tabs form uses `@octanejs/tanstack-form`, while the shell handles API requests, draft persistence, navigation, dragging, and focus management.

## Add it to a Beast project

After the release is published to npm, install it in your Beast app:

```sh
bun add -d @beastjs/page-builder
```

To try the package locally before publishing, build and link it:

```sh
# In beast-page-builder
bun run build
bun link

# In your Beast app
bun add -d link:@beastjs/page-builder
```

### Vite

```ts
import { defineConfig } from 'vite'
import { beastOctane } from 'beast-tsrx/vite'
import { beastPageBuilder } from '@beastjs/page-builder/vite'

export default defineConfig({
  plugins: [beastOctane(), beastPageBuilder()],
})
```

The package root also exports the Vite plugin. HTML injection respects Vite's `base`.

### Rspack

```ts
import { beastOctane } from 'beast-tsrx/rspack'
import { beastPageBuilder } from '@beastjs/page-builder/rspack'

export default {
  plugins: [beastOctane(), beastPageBuilder()],
}
```

Run with `rspack serve`. When constructing `RspackDevServer` yourself, pass `compiler.options.devServer` so its plugin middleware is used. Only browser compilers receive the widget.

### Rsbuild

```ts
import { defineConfig } from '@rsbuild/core'
import { beastOctane } from 'beast-tsrx/rsbuild'
import { beastPageBuilder } from '@beastjs/page-builder/rsbuild'

export default defineConfig({
  plugins: [...beastOctane(), beastPageBuilder()],
})
```

The plugin runs with `rsbuild dev`, adding a pre-entry to browser environments.

## Configure it

All three adapters accept the same options:

```ts
beastPageBuilder({
  include: ['src'],
  pagesDir: 'src/pages',
  routerFile: 'src/router.ts',
  // Optional: choose the shared menu for new page links.
  navigation: { file: 'src/lib/navs.ts', array: 'navGroups', group: 'Workspace' },
  shortcut: 'Mod+B',
  position: 'center',
  theme: 'light',
  scanDuration: 1600,
  launcher: true,
})
```

| Option | Default | Behavior |
| --- | --- | --- |
| `include` | `['src']` | Project-relative directories to scan recursively for `.btsx`, `.ts`, and `.tsx` sources |
| `pagesDir` | `'src/pages'` | Destination for new files; also included in the scan |
| `routerFile` | `'src/router.ts'` | Existing `@octanejs/tanstack-router` module with a root `addChildren([...])` route tree |
| `navigation` | Auto-detect | Optional menu file and selector/array/group; see below |
| `shortcut` | `'Mod+B'` | `Mod` means Command on macOS and Control elsewhere. Supports `Meta`, `Ctrl`, and optional `+Shift`, followed by a letter. |
| `position` | `'center'` | `'center'` or `'bottom-right'` |
| `theme` | `'light'` | `'light'`, `'dark'`, or `'auto'` |
| `scanDuration` | `1600` | Minimum sonar duration, in milliseconds, from 0 to 10,000. Reduced motion skips this delay. |
| `launcher` | `true` | Show the floating Builder button |

⌘B/Ctrl+B is intercepted while the plugin is active, including in text fields. Choose a different shortcut if it conflicts with your app. The optional launcher is always another way to open the widget.

## Build a page

1. Open the widget. It requests a fresh inventory from the dev server.
2. Search or filter **Pages** and **Components**. Open a result to inspect or copy its source. For a page, choose **Edit page** to update its BTSX content and styles, then **Review changes** and **Save page**. Use **Navs** and **Tabs** to inspect groups, item types, and data bindings. Compiler diagnostics stay visible for broken files.
3. Choose **Create a new page**. Name it in PascalCase, such as `PricingPage`.
4. Set the **Page URL** and **Navigation label**, and choose a menu if several are available. These default to `/pricing` and `Pricing` for `PricingPage`.
5. Start with a blank page or landing page. Add sections and edit the BTSX source. Choose **Review page** to inspect all three proposed files: the new page, router, and navigation.
6. Choose **Create page**. The server saves the reviewed files together. Use **Open page** or the new nav link to visit the URL.

Use the arrow keys and Enter to navigate search results. Escape, the close button, the backdrop, or the shortcut closes the widget. Focus returns to the element that opened it. New-page drafts stay in memory when you close the widget; they reset on reload. Template buttons replace the current draft source. Tabs drafts also survive navigation through their page selector.

Use the sun/moon button in the footer to toggle dark mode. Your choice is remembered in this browser; until you choose, the builder follows its configured theme. Scrollbars stay thin in both themes.

Choose **Hide launcher** under **All** to hide the floating Builder button. Open the builder with **⌘B** on macOS or **Ctrl+B** elsewhere (or your configured shortcut), then choose **Show launcher** to restore it. Your visibility choice is remembered across reloads.

Drag the builder's header or grip to move it. Its position stays within the viewport and is kept when switching views or reopening the builder. You can also focus **Move builder** and use the arrow keys (Shift for larger steps); Home restores its configured position.

Pages are classified by `pagesDir`, a `pages/` or `routes/` folder, or a component name ending in `Page`. Other Beast files appear as components. Dependency, generated, hidden, and symlinked entries are skipped. Use **Rescan project** after filesystem changes; there is no background file watcher in this version.

## Add Tabs to a page

Choose **Add Tabs to a page** in **All** or **Tabs**. The page route defaults to the current URL. Search by page name, URL, or source file to choose another page; selecting it navigates there and restores the form. **Review Tabs** becomes available once the selected page is loaded.

The scanner finds BTSX components named `Tabs` (or ending in `Tabs`) with a typed `items` or `tabs` prop. The form follows the component's item contract, including required and optional string, number, and boolean fields. Literal unions become dropdowns, so `IconName` offers the project's actual icons. For the included Tabs component, fill in `href`, `id`, `label`, `shortLabel`, and `icon`, then select the active tab and an accessible label. Add or remove items as needed.

Review the proposed page source, then choose **Add Tabs**. The builder imports the component and inserts it into the page's first native container, or before a component/conditional root. Existing content and styles are preserved. IDs must be unique, values must match the item type, and changes to the page, route, or contract require another review. Components with complex item fields or additional required props show why insertion is unavailable. Route selection supports registered static routes, including nested paths and direct or lazy BTSX page imports; parameterized routes require a concrete URL and are currently excluded.

## Router and navigation integration

The host app must already render a TanStack `RouterProvider` and use an app shell with an `Outlet`. The included playground demonstrates this setup. The builder edits `src/router.ts` by default. It adds a lazy `createRoute`, using the existing root route, and appends it to `rootRoute.addChildren([...])`. It preserves aliased imports, existing routes, comments, and the common `lazyPage` wrapper. It refuses duplicate URLs and computed route trees/paths that cannot be checked safely. If the router file is missing or uses another router, review explains what needs configuring before any files are written.

Without a `navigation` option, the scanner offers static `nav` blocks in component BTSX files and exported literal menu arrays with `href`/`to` fields in any scanned TypeScript module. Page-local menus and tab lists remain visible in the inventory but are excluded from automatic page-link insertion. If there is more than one target, choose **Add link to** in the draft.

For a static BTSX menu:

```ts
navigation: { file: 'src/components/Header.btsx', selector: 'nav.workspace-nav' }
```

The new link uses `Link(to=...)` when the menu uses TanStack links, or `a(href=...)` for a menu using anchors. The selector is the complete `nav` selector, including its ID and classes; omit it when the file contains one editable nav. Dynamic loops are edited through their data file instead.

For shared menu data, including menus used by desktop and mobile sidebars:

```ts
navigation: {
  file: 'src/lib/navs.ts',
  array: 'navGroups',
  group: 'Workspace',
  itemDefaults: { icon: 'folder' },
}
```

Supported exported arrays are flat literal items or literal groups with `title`/`label` and `items`. New items follow the acquired contract and existing schema (`href` or `to`, `label` or `title`, and optional `icon`, `value`, `id`, `short`, `description`, `tags`, `disabled`). An icon defaults to the existing first item's icon; override it with a valid icon from your project. Supply `itemDefaults` for additional fields your menu requires. Existing items and other groups are preserved. Required fields from declared types are included even in empty typed arrays. Simple field types and literal unions are checked against the proposed values; optional fields are omitted unless present in the existing template or supplied in defaults. Computed arrays and spreads are inspectable but cannot be edited automatically.

## Edit existing pages and tabs

Open **Pages**, select a page, and choose **Edit page**. The editor loads its current BTSX source, including any tabs already added. Choose **Review changes** to compile and compare the proposed source with the current file, then **Save page**. You can also choose **Edit page** directly after creating or saving a page.

Open **Tabs** and select an existing group under **Existing tabs**, or select **Edit tabs** in its page details. The form loads the saved items, active tab, and accessible label. Add or remove items and edit their fields, then choose **Review Tabs** and **Save tabs**. Saving updates the selected group in place and preserves other tab groups, page content, and component props. The page and component selectors stay fixed while editing.

The tabs form supports literal item arrays and literal active/label props, including the tabs inserted by the builder. Groups with computed values or spread props link to their page source instead. A changed page, tab group, route, or item contract requires another review before saving.

## Navigation, tabs, and item types

The scan detects BTSX `nav`, navigation/menu roles, tablist/tab roles, and common `Nav`, `Navigation`, `SidebarNav`, `MenuList`, `TabsList`, and `TabsTrigger` components, including named import aliases. It also discovers shared arrays by link fields, menu/tab naming, or use in an `each` loop or `items`/`tabs`/`links` binding. Loops connect rendered groups to their source arrays, including aliased imports and grouped menus. Custom components with these semantics can expose them using ARIA roles.

Open a result in **Navs** or **Tabs** to see:

- Each item's kind: internal link, external link, anchor, action, or tab.
- Its TypeScript type and fields, with required/optional status and literal unions.
- Distinct item variants in a discriminated union, and the type of each individual item.
- Imported component prop contracts, shared data bindings, and the files that render them.

The TypeScript checker resolves imported types and the host project's `tsconfig.json` aliases. BTSX module/setup declarations participate in type discovery. Explicit contracts are marked **Declared type**; untyped data and static HTML attributes are marked **Inferred shape**. Typed computed collections expose their contracts with unknown runtime values. Scanning parses source without executing host modules.

Detection is based on source semantics, not the browser DOM. Runtime-generated labels, destinations, or items may remain unresolved, and arbitrary custom component names need recognizable roles. The `navigation` option restricts where new page links are inserted; it does not hide other menus or tabs from inspection. Tab groups are inspected as controls and are not page-link destinations.

## Scope of this version

This is a source-based page builder. Review shows BTSX source, not a rendered page. It creates and edits page source, and adds or edits typed Tabs components on existing pages. It does not arrange arbitrary project components visually, generate content with AI, or generate new router infrastructure. Compilation validates Beast and Octane syntax; it does not type-check imports or props against the whole host project. Run the host app's normal checks after changes.

The API lives under `/__beast-page-builder`. Reads and writes reject cross-site requests. Writes require same-origin JSON, bounded request bodies, valid page names, and project-contained paths. The review hash includes every original and proposed file. Saving rechecks the reviewed source, stages all complete files, then commits them, with rollback on a write failure. Page creation never overwrites existing pages; explicit page and Tabs edits update the selected existing page after review. A changed draft, router, menu, or Tabs contract requires another review; concurrent saves through one project instance are serialized. If an external edit prevents rollback, the error identifies the files to inspect.

## Develop and verify

```sh
bun run check
bunx playwright install chromium  # First browser-test run
bun run test:browser
```

`bun run build` produces the Node plugin adapters, public types, and the standalone widget in `dist/`. Restart the playground after changing the plugin or widget source.

```text
vite.ts / rspack.ts / rsbuild.ts  Bundler adapters
server/                         Project scan, route/menu edits, reviewed saves, JSON API
shared/                         Public configuration and wire types
client/                         Widget, sonar animation, page starters
playground/                     Beast app for trying the plugin
tests/                          Project, API, bundler, and browser checks
```

## Release and publish

Release artifacts are attached to the corresponding [GitHub release](https://github.com/beastjs/page-builder/releases). The package is published to npm manually.

To publish the verified tarball from a release:

```sh
npm publish ./releases/beastjs-page-builder-0.2.0.tgz --access public
```

For a future release, update the package version and changelog, run `bun run check` and `bun run test:browser`, then run `npm pack --pack-destination releases`. `prepack` builds the distribution so each tarball includes the adapters, declarations, and browser widget. Publishing from the repository also runs `prepublishOnly` checks. Check the packed file list with `bun run pack:check`.
