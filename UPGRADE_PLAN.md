# Studio section components upgrade

Updated: October 29, 2026

Bring the Design Studio section catalog from `~/Code/play` into the page builder so users can browse, preview as wireframes, and install standalone section components into their project.

## Progress board

| Section | Milestone | Status | Depends on |
| --- | --- | --- | --- |
| 0 | Readiness review | Done | — |
| 1 | Section catalog and server endpoint | Done | 0 |
| 2 | Section identity and discovery | Not started | 1 |
| 3 | Section install plan | Not started | 1, 2 |
| 4 | Tailwind detection and studio base styles | Not started | 3 |
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

Status: **Not started**

Files: `server/sections.ts`, `shared/sections.ts`, `shared/types.ts`, and `client/palette/actions.ts`.

- [ ] Choose one identity: the studio kind id (`partners`) or `sectionKey(label)` (`partners-marquee`). Map the existing `sectionLibrary` entries to it.
- [ ] Detect `data-section` roots alongside `id`; record the kind and the component file on `DetectedSection`.
- [ ] Detect studio components used on a page through their imports, so an installed section appears under “Existing sections”.
- [ ] Keep “Edit section” opening the component file for studio sections and the page line for inline ones.
- [ ] Decide whether the existing inline snippets in `client/templates.ts` stay, are replaced by catalog sections, or remain as a “simple” fallback for projects without Tailwind.

Complete when: scans report both inline and studio sections with stable ids, and the palette no longer offers to create a kind already on the page.

Evidence:

## 3. Section install plan

Status: **Not started**

Files: `server/project.ts`, `server/server.ts`, `shared/types.ts`, `client/api.ts`, and `client/controller.ts`.

- [ ] Add a `sectionsDir` option (default beside `pagesDir`, for example `src/sections`) and require it to be inside `include`.
- [ ] Add `previewSection` / `createSection`: plan `create <sectionsDir>/<Name>.btsx` plus `edit <page>` (sorted import and usage line), hashed like page previews.
- [ ] Number repeated kinds (`Features`, `Features2`) and never overwrite an existing component file.
- [ ] Insert the usage at the stage order from `kinds.ts`, or at a position the user chooses.
- [ ] Compile both planned files before review, and reuse `writeFiles` and the review screen for saving.
- [ ] Reject installs into pages whose root cannot accept a component child, with a clear message.

Complete when: installing a section creates the component and edits the page through the existing review/save flow with the same stale-draft and rollback protections.

Evidence:

## 4. Tailwind detection and studio base styles

Status: **Not started**

Files: `server/project.ts`, a new `server/styles.ts`, and `shared/types.ts`.

- [ ] Detect Tailwind v4 in the project (`@import "tailwindcss"` in a stylesheet and the bundler plugin in the config) and report it in `ProjectScan`.
- [ ] Warn before install when Tailwind is missing; the builder does not install packages, so state the requirement.
- [ ] Add the studio base block (`[data-section]` reset, `studio-*` keyframes, `--studio-*` variables) once, behind a marker, as an additional planned file edit.
- [ ] Decide whether the `dark:` custom variant is added or left to the project.
- [ ] Defer studio themes (`themes.ts`, `colorhunt.ts`) unless a later milestone adds them.

Complete when: a first install on a Tailwind project adds the base block exactly once, a second install leaves the stylesheet untouched, and a project without Tailwind gets a clear warning.

Evidence:

## 5. Section library UI

Status: **Not started**

Files: `client/sections/SectionLibrary.btsx`, `Wireframe.btsx`, `types.ts`, `client/widget.css`, and `client/icons.ts`.

- [ ] Port `Wireframe.btsx`; convert its Tailwind token classes to scoped CSS in `widget.css`.
- [ ] Port `SectionLibrary.btsx` logic (stages, kinds, search, current/swap/add states) onto summaries from milestone 1; restyle with existing widget classes.
- [ ] Add missing icons (`chevron-down-tiny` or an existing equivalent).
- [ ] Reach the library from the palette and from the page editor's “Add a section” menu, replacing the plain name list.
- [ ] Load a template's source only when it is chosen.
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
