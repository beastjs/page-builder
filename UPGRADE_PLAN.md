# Studio section components upgrade

Updated: October 29, 2026

Bring the Design Studio section catalog from `~/Code/play` into the page builder so users can browse, preview as wireframes, and install standalone section components into their project.

## Progress board

| Section | Milestone | Status | Depends on |
| --- | --- | --- | --- |
| 0 | Readiness review | Done | — |
| 1 | Section catalog and server endpoint | Done | 0 |
| 2 | Section identity and discovery | Done | 1 |
| 3 | Section install plan | Done | 1, 2 |
| 4 | Tailwind detection and studio base styles | Done | 3 |
| 5 | Section library UI | Not started | 1, 3 |
| 6 | Final verification and measurements | Not started | 1–5 |

“Done” means implemented and verified in the current working tree. It does not mean committed or published. Proposed filenames below may change during implementation.

## How to track work

- Work through one section at a time in the board's order.
- Change its status to **In progress** when work starts and **Done** after its completion criteria pass.
- Check off tasks as they finish. Record the checks run, results, and bundle change in that section's evidence line.
- Keep unfinished tasks unchecked and record any blocker beside them.
- Update this file alongside each upgrade change so it remains the source of progress information.

## Sources

- **Section templates:** `play/src/playground/studio/` — `types.ts`, `kinds.ts`, `catalog.ts`, `recipes.ts`, and `sections/*.ts` (83 templates across 14 kinds, about 135 KB of source; the largest is 4.7 KB).
- **Studio UI:** `play/src/components/studio/` — 15 `.btsx` files plus `studio.ts`. These are the studio's chrome, not sections.
- **Install model reference:** `play/src/playground/studio/page.ts` — `composePage`, `sectionFile`, name numbering, preset markers, and `STUDIO_STYLES`.

## 0. Readiness review

Status: **Done**

- [x] Compile every studio section template with the builder's `beast-tsrx` and `octane` (0.13.8) through `compileBeastResult` and the Octane bundler transform.
- [x] Compile every studio UI `.btsx` file the same way.
- [x] Compare the builder's section model, write path, and styling with the studio's.

Evidence (October 29, 2026): all 83 templates and all 15 studio UI files compiled without errors, although play is on `octane` 0.12.1 and `beast-tsrx` 0.8.0. This proves syntax compatibility only; runtime behavior of the studio UI under 0.13.8 is unverified. Findings that shape the milestones below:

- The builder treats a section as an inline snippet inserted before a page's `style` block (`client/pages/model.ts`), detected by its `id` (`server/sections.ts`) and matched to the library by `sectionKey(name)` (`client/palette/actions.ts`). Studio sections are standalone components in `src/sections/<Name>.btsx`, with their own `setup`, sometimes `import { useState } from 'octane'` (8 kinds), and a root carrying `data-section='<kind>'` rather than an `id`.
- The server can create a page (page, router, navigation) or edit one existing file. It cannot create a component and wire it into a page. `writeFiles` already supports atomic multi-file create/edit with rollback.
- Templates require Tailwind v4 (opacity modifiers such as `border-current/15`, arbitrary values, `group-hover:`, a `dark:` custom variant), use `var(--studio-accent)` 73 times, use `studio-*` keyframes, and rely on the `[data-section]` base reset. The builder never edits CSS and its playground has no Tailwind.
- The studio UI depends on play's Tailwind design tokens, the `@/` alias, icons the builder lacks (`chevron-down-tiny`, `desktop`, `tablet`, `smartphone`), Convex, jev, the in-browser compiler preview, resizable panels, dnd-kit, and base-ui. The builder renders inside a shadow root styled by `client/widget.css`.

## 1. Section catalog and server endpoint

Status: **Done**

Files: `shared/catalog/types.ts` and `kinds.ts` (client-safe), `server/catalog/index.ts` and `sections/*.ts` (server-only), `SectionSummary` in `shared/types.ts`, endpoints in `server/server.ts`, `scripts/sync-catalog.ts`, and `tests/catalog.test.ts`.

- [x] Copy `types.ts`, `kinds.ts`, and `sections/*.ts` from play; keep `catalog.ts` lookups (`sectionTemplate`, `templatesOf`, `searchTemplates`) in `server/catalog/index.ts`. `recipes.ts` and the `ir/` layer are deferred.
- [x] Serve summaries (every template field except `source`) from `GET /__beast-page-builder/sections`, and one template from `GET /__beast-page-builder/sections/:id`. Unknown or malformed ids return 404. Summaries carry no keywords; search uses the kind's keywords from `kinds.ts`, as play does.
- [x] Keep template sources out of `dist/client.js`: they live under `server/`, which the client never imports. Only `shared/catalog/` may reach the client.
- [x] Add a test that compiles every catalog template, and checks unique ids, registered kinds, page order, wireframes, and a `data-section='<kind>'` root.
- [x] Record where catalog updates come from and how to resync them from play: `bun run catalog:sync` copies the files (rewriting relative imports to `.js`) and `bun run catalog:check` reports drift. Synced files carry a do-not-edit header. A new kind upstream still needs registering in `server/catalog/index.ts`.

Complete when: the server returns all summaries and sources, every template compiles in the test suite, and the client bundle has not grown by the catalog's source size.

Evidence (October 29, 2026): `bun run check` passed type checking, client type checking, the production build, and all 67 non-browser tests across 10 files, including 4 new catalog tests and 1 new endpoint test. All 83 templates compile. `bun run catalog:check` reports no drift from play. The client bundle is 575,113 bytes minified and 230,827 bytes gzipped (Node zlib defaults), the same size as the HEAD build; the only bytes that differ are two swapped minifier names, and no template id appears in it. Each server adapter (for example `dist/vite.js`) grew from 83,850 to 247,927 bytes because the catalog is bundled into it. `npm pack --dry-run` lists 39 files and a 424.7 kB package. Browser tests were not run, since no UI changed. Note for milestone 6: the client baseline is now 575,113 bytes, not the 454,177 recorded in `CLIENT_VERIFICATION.md` before v0.3.0.

## 2. Section identity and discovery

Status: **Done**

Files: `server/sections.ts`, `server/project.ts`, `shared/sections.ts`, `shared/types.ts`, `client/palette/actions.ts`, `tests/sections.test.ts`, `tests/project.test.ts`, and `tests/sections-ui.e2e.ts`.

- [x] Choose one identity: the studio kind id is canonical. `sectionKindOf(name)` in `shared/sections.ts` also accepts a kind's label and component name as keys, so `#partners-marquee`, `data-section='partners'`, and `Partners` are all kind `partners`, and `Call to action` / `CallToAction` / `cta` are all `cta`. `Sidebar` has no kind and keeps matching by name.
- [x] Detect `data-section` roots alongside `id` (literal strings only, as for `id`). `DetectedSection` gains optional `marker: 'data-section'` (set when there is no `id`), `kind`, and `usedBy`. An element with both keeps its `id` as its name and takes its kind from `data-section`.
- [x] Detect studio components used on a page: `discoverComponentUses` follows relative, default, non-type `.btsx` imports to the tags that render them, and the scan sets `usedBy` on sections in component files.
- [x] Keep “Edit section” opening the component file for studio sections (at the root's line) and the page line for inline ones. The existing edit, review, and save path needed no change.
- [x] Decide on the inline snippets in `client/templates.ts`: keep them for now as the no-Tailwind fallback. The palette hides a “Create” entry when a section of the same kind is detected. Milestone 5 decides whether the catalog replaces them.

Complete when: scans report both inline and studio sections with stable ids, and the palette no longer offers to create a kind already on the page.

Evidence (October 29, 2026): `bun run check` passed type checking, client type checking, the production build, and all 71 non-browser tests across 10 files, including 3 new discovery tests (data-section roots and kinds, every catalog template discovered as its own kind, import-based uses) and a new scan test linking a section component to its page. The full browser suite passed all 83 tests in 3.4 minutes, including a new test where a studio section lists as “Edit Stats” with its `data-section` marker and page, hides “Create Stats”, and opens its component source. `bun run catalog:check` reports no drift. The client is 578,128 bytes minified and 232,001 gzipped (Node zlib defaults): +3,015 and +1,174 bytes over milestone 1, from the kind list the palette now imports. Remaining limits: named imports and re-exports are not followed for `usedBy`, and the section edit heading still reads “Edit #stats” for a `data-section` root (see milestone 5).

## 3. Section install plan

Status: **Done**

Files: `server/install.ts` (page edit), `server/project.ts` (`previewSection`, `installSection`, `sectionInstall`), `server/errors.ts`, `server/sections.ts` (shared import helpers), `server/server.ts`, `shared/types.ts`, `client/api.ts` (config default only), `tests/install.test.ts`, `tests/project.test.ts`, and `tests/server.test.ts`.

- [x] Add a `sectionsDir` option, defaulting beside `pagesDir` (`src/pages` → `src/sections`). Like `pagesDir`, it is added to the scan directories rather than required to be in `include`. It must be inside the project and outside `pagesDir` and any `pages`/`routes` folder, since files there scan as pages. `ClientConfig` carries it for milestone 5.
- [x] Add `POST /install/preview` and `POST /install/create` (plus `GET /install/creation?hash=` for reload receipts). The plan creates `<sectionsDir>/<Name>.btsx` and edits the page, adding a default import after the page's other imports and a usage line under the page root. It is hashed with the template id, name, files, and route.
- [x] Number repeated kinds (`Stats`, `Stats2`) past any name the page's imports or declarations bind and any file in `sectionsDir`. A chosen name must be PascalCase and free, or the review fails with 409. An existing component file is never overwritten.
- [x] Insert the usage before the root's first child of a later kind. Children are typed by their `data-section`/`id` kind, or by the kind of the section file a component tag imports. With no typed children, navigation kinds go first and the rest go last (before any `style` block). An `index` overrides this and is range checked.
- [x] Compile both planned files before review, and save through `writeFiles` behind the same mutation queue, hash recheck, and rollback as pages and tabs.
- [x] Reject installs into pages with no root element, more than one root, or a void root (`img`, `input`, …), and into pages that do not compile, each with its own message.
- [ ] Client wiring (an install action and the review screen in `client/controller.ts`) moves to milestone 5, where the library UI calls it.

Complete when: installing a section creates the component and edits the page through the existing review/save flow with the same stale-draft and rollback protections.

Evidence (October 29, 2026): `bun run check` passed type checking, client type checking, the production build, and all 81 non-browser tests across 11 files. New tests: 5 planner tests (story order, end-of-root before styles, navigation first, explicit index, root errors), 4 project tests (end-to-end install with numbering and next-scan `usedBy`, one template per kind previewed as a compiling install, taken names / bad inputs / stale review leaving no file, `sectionsDir` defaults and rules), and 1 API test (preview, create, receipt, replay 409). All 83 browser tests passed in 3.5 minutes. `bun run catalog:check` reports no drift. The client is 578,155 bytes minified and 232,006 gzipped: +27 and +5 bytes over milestone 2, from the config default. `dist/vite.js` is 259,687 bytes (+11,760 over milestone 2). Previewing an install rescans the project, about 280 ms for the small fixture, so the per-kind test samples one template per kind; `tests/catalog.test.ts` still compiles all 83. Limits: inserted usage lines take their indentation from the root's first child, and the import goes after the last import even if the page interleaves other declarations.

## 4. Tailwind detection and studio base styles

Status: **Done**

Files: `server/styles.ts`, `server/project.ts`, `shared/types.ts`, `scripts/sync-catalog.ts`, `tests/styles.test.ts`, `tests/project.test.ts`, and `tests/widget.e2e.ts`.

- [x] Detect Tailwind v4 and report it as `ProjectScan.tailwind` (`version`, `integration`, `stylesheet`, `ready`). The version and integration come from `package.json` (`tailwindcss`, plus `@tailwindcss/vite`, `@tailwindcss/postcss`, `@rsbuild/plugin-tailwindcss`, or `@tailwindcss/webpack`) rather than parsing bundler configs. The stylesheet is the first scanned `.css` file that imports `tailwindcss`, with the same import rule as play. Ranges without a major version (`latest`, `workspace:*`) count as v4.
- [x] Warn before install when Tailwind is missing: install previews carry `warnings` naming the missing package, an outdated major, a missing integration, or a missing `@import "tailwindcss"`. Warnings do not block the install; the builder never installs packages.
- [x] Add the studio base block (`[data-section]` reset, the five `studio-*` keyframes, `--studio-*` variables and `[data-page]` theme base) once, behind play's marker, as a third planned file edit on the Tailwind stylesheet. Later installs find the marker and leave the stylesheet alone. The block is copied from play's `page.ts` and `themes.ts`, and `bun run catalog:check` now fails if play's copy changes.
- [x] Decide on the `dark:` custom variant: left to the project. No catalog template uses `dark:`.
- [x] Defer studio themes (`themes.ts`, `colorhunt.ts`).

Complete when: a first install on a Tailwind project adds the base block exactly once, a second install leaves the stylesheet untouched, and a project without Tailwind gets a clear warning.

Evidence (October 29, 2026): `bun run check` passed type checking, client type checking, the production build, and all 86 non-browser tests across 12 files. New tests: 4 in `tests/styles.test.ts` (import recognition; readiness across versions, integrations, and stylesheets; warning text; the block appended once and covering every keyframe and variable templates use) and 1 project test (a project without Tailwind gets 2 warnings; with Tailwind the first install edits `src/style.css` and the next does not). The drift check was confirmed by editing one keyframe and seeing `catalog:check` fail. The full browser suite passed all 83 tests in 3.5 minutes. The client is unchanged at 578,155 bytes minified and 232,006 gzipped; `dist/vite.js` is 264,158 bytes (+4,471 over milestone 3).

Test change: “reduced motion skips the waiting animation” required the real scan to finish within 1,200 ms of opening the builder, while warm scans take about 0.75 s on the browser fixture. It failed 1–6 times in 20 isolated repeats on the working tree (0 in 30 at HEAD, same machine) and passed full runs. Timing the real test server's `/scan` gave the same latency in both trees (about 0.72–0.78 s warm, 8 s for the first request), and switching off this milestone's scan reads did not remove the failures, so no single cause was found. The test now stretches the configured scan animation to 10 seconds through a routed `/config` and allows 5 seconds. A build that ignored reduced motion still fails it (checked), and it passed 20 of 20 repeats. If later work shows scans getting slower, compare with `/scan` timings against `bun scripts/serve-browser-tests.ts`.

## 5. Section library UI

Status: **Not started**

Files: `client/sections/SectionLibrary.btsx`, `Wireframe.btsx`, `types.ts`, `client/widget.css`, and `client/icons.ts`.

- [ ] Port `Wireframe.btsx`; convert its Tailwind token classes to scoped CSS in `widget.css`.
- [ ] Port `SectionLibrary.btsx` logic (stages, kinds, search, current/swap/add states) onto summaries from milestone 1; restyle with existing widget classes.
- [ ] Add missing icons (`chevron-down-tiny` or an existing equivalent).
- [ ] Reach the library from the palette and from the page editor's “Add a section” menu, replacing the plain name list.
- [ ] Load a template's source only when it is chosen.
- [ ] Wire install into `client/controller.ts`: choose a page, call `/install/preview`, show the existing review screen, save through `/install/create`, and recover through `/install/creation` after a reload.
- [ ] Title studio section edits by kind (“Edit Stats”) rather than “Edit #stats”, since `data-section` roots have no `id`.
- [ ] Leave out `DesignStudio`, `StudioStage`, `DesignOverlay`, `DesignInspector`, `ThemeDesigner`, `ThemePicker`, and `FullstackBrowser`; saved sections already render in the user's site through HMR.

Complete when: users can browse, search, and install catalog sections from the builder, in light and dark themes, on desktop and mobile.

Evidence:

## 6. Final verification and measurements

Status: **Not started**

- [ ] Run `bun run check` for type checking, production build, and the complete non-browser test suite.
- [ ] Extend `tests/sections.test.ts`, `tests/sections-ui.e2e.ts`, and the palette tests for studio sections; run the complete browser suite.
- [ ] Install at least one section of every kind into the playground (with Tailwind added) and inspect it on desktop and mobile.
- [ ] Inspect the library in light/dark mode, reduced motion, and keyboard focus.
- [ ] Run `bun run pack:check` and verify the catalog ships with the server, not the client.
- [ ] Record minified/gzipped client sizes against the 575,113 / 230,827 byte baseline measured in milestone 1.
- [ ] Update the README and CHANGELOG with the new option, requirements, and limitations.

Complete when: the full suite and package check pass, visual checks are complete, and the upgrade has a recorded final result.

Evidence:

## Rules throughout the upgrade

- Keep `scripts/build.ts` in plain TypeScript and continue shipping a precompiled widget for Vite, Rspack, and Rsbuild.
- Do not add Convex, jev, or the studio's in-browser compiler; the builder's catalog is static and its preview is the user's own site.
- Keep every write behind the existing review, hash, and rollback flow.
- Do not upgrade dependencies as part of this work; port play code to the builder's `octane` and `beast-tsrx` versions, not the reverse.
- Prefer existing components and dependencies. Measure the bundle after each milestone.
