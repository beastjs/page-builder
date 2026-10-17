# Client builder BTSX migration

Updated: October 18, 2026

Next deliverable: migrate page creation and editing using the shared view components now in place.

## Progress board

| Section | Milestone | Status | Depends on |
| --- | --- | --- | --- |
| 0 | Build and type-check foundation | Done | — |
| 1 | Tabs editor | Done | 0 |
| 2 | Search palette | Done | 0 |
| 3 | Shared view components | Done | 1, 2 |
| 4 | Page creation and editing | Next | 3 |
| 5 | Review and save screens | Queued | 3, 4 |
| 6 | Source and collection inspectors | Queued | 3, 5 |
| 7 | Scan, success, and error screens | Queued | 3 |
| 8 | Builder shell and state cleanup | Queued | 4–7 |
| 9 | Final verification and measurements | Queued | 8 |

“Done” means implemented and verified in the current working tree. It does not mean committed or published. Proposed filenames below may change during implementation.

## How to track work

- Work through one section at a time in the board's order.
- Change its status to **In progress** when work starts and **Done** after its completion criteria pass.
- Check off tasks as they finish. Record the checks run, results, and bundle change in that section's evidence line.
- Keep unfinished tasks unchecked and record any blocker beside them.
- Update this file alongside each migration change so it remains the source of progress information.

## Baseline before section 3

- **Foundation:** `scripts/build.ts` remains plain TypeScript and compiles BTSX through Beast and Octane into the prebuilt client. `scripts/check-client.ts` checks generated TSRX without keeping generated source files.
- **Tabs:** `client/tabs/` contains the editor, page picker, typed fields, form binding, and model helpers.
- **Palette:** `client/palette/` contains search, filters, keyed results, keyboard navigation, ready animation, and TypeScript action construction.
- **Shared components already available:** `Icon.btsx`, `ThemeToggle.btsx`, and `TypeContract.btsx` in `client/ui/`.
- **Latest verified checks:** build, type checking, 6 bundler integration tests, and 22 widget browser tests passed.
- **Client bundle:** 430,304 bytes minified; 133,446 bytes gzipped. This is the baseline for subsequent sections, not a runtime speed measurement.
- **Remaining shell:** `client/mount.ts` is 1,034 lines and still renders the remaining screens through HTML strings.

## 3. Shared view components

Status: **Done**

Files: `client/ui/ViewHeader.btsx`, `ActionFooter.btsx`, and `StatusMessage.btsx`.

- [x] Extract the view header: title, subtitle, back, move grip, and close controls.
- [x] Extract the action footer: supporting text, action button, pending/disabled state, and theme toggle.
- [x] Extract the accessible status message used for errors and progress.
- [x] Adopt these components in the existing BTSX tabs editor; reuse the existing icon and theme components.
- [x] Verify back/close actions, dragging, keyboard movement, theme changes, and preservation of tab drafts.

Complete when: the components have real consumers and preserve the existing layout and behavior. Later screens adopt them as they migrate.

Evidence (October 18, 2026): build and type checking passed. All 5 focused browser tests in `tests/shared-ui.e2e.ts` passed, covering back/close and focus restoration, draft persistence, native form submission, pending/disabled state, review errors and retry, themes, keyboard/pointer/touch movement, and route eligibility. Desktop and mobile screenshots were inspected. The palette also uses `StatusMessage.btsx`. The client bundle is 431,689 bytes minified and 133,850 bytes gzipped: increases of 1,385 and 404 bytes respectively over the baseline. No dependencies or build-script changes were needed.

## 4. Page creation and editing

Status: **Next**

Proposed files: `client/pages/PageEditor.btsx`, `SourceEditor.btsx`, `form.ts`, and `model.ts`.

- [ ] Move new-page and existing-page editing markup into typed BTSX views, sharing the source editor.
- [ ] Connect form state and submission through the installed `@octanejs/tanstack-form` binding.
- [ ] Extract name-to-route and name-to-label helpers; preserve automatic suggestions until the user supplies an override.
- [ ] Preserve navigation selection, item-contract hints, missing-menu guidance, and create/edit mode differences.
- [ ] Preserve template replacement and section insertion before the existing style block.
- [ ] Invalidate the reviewed preview whenever its draft changes; preserve drafts through closing, navigation between views, and failed reviews.
- [ ] Verify caret/focus retention, manual overrides, templates, sections, validation, pending state, and review retry behavior.

Complete when: both page workflows use BTSX without rebuilding their inputs during ordinary edits, and the existing page create/edit browser flows pass.

Evidence: pending.

## 5. Review and save screens

Status: **Queued**

Proposed files: `client/review/ReviewView.btsx`, `PlannedFile.btsx`, and `client/ui/SourceViewer.btsx`.

- [ ] Migrate the shared page/tabs review screen with explicit create-page, edit-page, add-tabs, and edit-tabs modes.
- [ ] Render proposed files and original source through a reusable source viewer, preserving literal source text.
- [ ] Preserve file actions, compiler confirmation, route summary, and mode-specific save labels.
- [ ] Keep API calls and reviewed hashes in TypeScript; preserve server checks for changed drafts, files, and contracts.
- [ ] Preserve pending/error feedback, duplicate-submit protection, route eligibility for tabs, and back-to-draft behavior.
- [ ] Verify review/save for all four modes, stale-review rejection, and recovery after a failed save.

Complete when: every page and tabs save flows through the BTSX review screen and retains the existing review protections.

Evidence: pending.

## 6. Source and collection inspectors

Status: **Queued**

Proposed files: `client/inspect/FileInspector.btsx`, `CollectionInspector.btsx`, and `DetectedItem.btsx`.

- [ ] Migrate file details, source viewing, clipboard feedback, compiler errors, and edit-page actions.
- [ ] Migrate the list of existing tab groups and its edit/source-only actions.
- [ ] Migrate collection metadata, bindings, consumers, item kinds, and per-item details.
- [ ] Reuse `SourceViewer.btsx` and the existing recursive `TypeContract.btsx`.
- [ ] Preserve explanations for computed/read-only collections and empty item lists.
- [ ] Verify source copying, navigation/tabs inspection, declared and union types, and opening the correct page or tab editor.

Complete when: file and collection inspection use BTSX and their legacy HTML-rendering helpers are no longer needed.

Evidence: pending.

## 7. Scan, success, and error screens

Status: **Queued**

Proposed files: `client/status/ScanView.btsx`, `SuccessView.btsx`, and `ErrorView.btsx`.

- [ ] Migrate scan markup and progress text while preserving the sonar and HexTrace appearance.
- [ ] Keep loader integration in effects with cleanup; preserve reduced-motion behavior and configured scan duration.
- [ ] Migrate page and tabs success screens, including open-page, edit-page, and return actions.
- [ ] Migrate connection failures and retry actions with accessible error messages.
- [ ] Preserve reload receipts and ensure a closed or superseded request cannot reopen the builder.
- [ ] Verify scan cancellation, retry, reduced motion, successful saves across reloads, and all success actions.

Complete when: these states render through BTSX and pending work cannot update an obsolete view.

Evidence: pending.

## 8. Builder shell and state cleanup

Status: **Queued**

Proposed files: `client/Builder.btsx`, plus focused TypeScript modules for API, state, persistence, and browser behavior.

- [ ] Consolidate migrated screens behind one builder root and a typed screen-state union.
- [ ] Render launcher, backdrop, panel, and screen selection declaratively.
- [ ] Keep a single authoritative owner for each draft; remove temporary bridges and duplicate rendering paths.
- [ ] Extract API requests, storage/receipts, theme preferences, and route coordination into TypeScript modules.
- [ ] Keep small browser utilities for dragging, pointer capture, viewport clamping, focus trapping/restoration, and animation; clean up listeners and observers on unmount.
- [ ] Reduce `mount.ts` to bootstrap and integration code; remove legacy view HTML strings, listener rebinding, and unused helpers.
- [ ] Verify shortcuts, launcher preferences, route changes, resize behavior, disposal, and repeated open/close cycles.

Complete when: all builder UI is authored in BTSX, the shell has one rendering lifecycle, and imperative DOM code is limited to browser integration utilities.

Evidence: pending.

## 9. Final verification and measurements

Status: **Queued**

- [ ] Run `bun run check` for type checking, production build, and the complete non-browser test suite.
- [ ] Run the complete browser suite, including loaders and all migration regressions; use a separate test server if a development server is already running.
- [ ] Inspect desktop/mobile layouts, dark mode, reduced motion, focus, and source overflow.
- [ ] Run `bun run pack:check` and verify the self-contained client and server runtime dependencies.
- [ ] Record final minified/gzipped sizes against this baseline; investigate material growth before adding dependencies or splitting bundles.
- [ ] Measure palette updates and editor input under a large project inventory; report measurements separately from bundle size.
- [ ] Update the README and this board with the final module layout, test results, measurements, and any remaining limitations.

Complete when: the full suite and package check pass, visual checks are complete, and the migration has a recorded final result.

Evidence: pending.

## Rules throughout the migration

- Keep `scripts/build.ts` in plain TypeScript and continue shipping a precompiled widget for Vite, Rspack, and Rsbuild.
- Preserve the current UI and behavior while changing its implementation.
- Keep server-side scanning and file-writing behavior outside this client migration unless a demonstrated integration issue requires a change.
- Preserve unrelated working-tree edits and avoid dependency upgrades as part of routine view migration.
- Prefer existing components and dependencies. Benchmark before claiming runtime performance improvements.
