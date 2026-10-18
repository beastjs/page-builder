# Client builder BTSX migration

Updated: October 18, 2026

Next deliverable: final package verification, bundle comparison, and large-inventory palette/editor measurements.

## Progress board

| Section | Milestone | Status | Depends on |
| --- | --- | --- | --- |
| 0 | Build and type-check foundation | Done | — |
| 1 | Tabs editor | Done | 0 |
| 2 | Search palette | Done | 0 |
| 3 | Shared view components | Done | 1, 2 |
| 4 | Page creation and editing | Done | 3 |
| 5 | Review and save screens | Done | 3, 4 |
| 6 | Source and collection inspectors | Done | 3, 5 |
| 7 | Scan, success, and error screens | Done | 3 |
| 8 | Builder shell and state cleanup | Done | 4–7 |
| 9 | Final verification and measurements | Next | 8 |

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

Status: **Done**

Files: `client/pages/PageEditor.btsx`, `SourceEditor.btsx`, `form.ts`, `model.ts`, and `types.ts`.

- [x] Move new-page and existing-page editing markup into typed BTSX views, sharing the source editor.
- [x] Connect form state and submission through the installed `@octanejs/tanstack-form` binding.
- [x] Extract name-to-route and name-to-label helpers; preserve automatic suggestions until the user supplies an override.
- [x] Preserve navigation selection, item-contract hints, missing-menu guidance, and create/edit mode differences.
- [x] Preserve template replacement and section insertion before the existing style block.
- [x] Invalidate the reviewed preview whenever its draft changes; preserve drafts through closing, navigation between views, and failed reviews.
- [x] Verify caret/focus retention, manual overrides, templates, sections, validation, pending state, and review retry behavior.

Complete when: both page workflows use BTSX without rebuilding their inputs during ordinary edits, and the existing page create/edit browser flows pass.

Evidence (October 18, 2026): production build and type checking passed. `bun run check` passed all 57 non-browser tests, including 2 new model tests and 6 bundler integration tests. All 31 widget browser tests passed (22 existing workflows, 5 shared-component tests, and 4 page-editor tests); the 4 page-editor tests passed again after the final draft-reset and obsolete-review guards. The review-return regression also passed 6 consecutive runs after fixing controlled input updates. Coverage includes suggestions and manual overrides, caret/focus retention, literal source, navigation contracts and missing-menu guidance, templates, single section insertion before styles, create/edit mode transitions, draft persistence, pending/duplicate submission, errors/retry, stale responses, and real page creation/editing/saving. Desktop and mobile screenshots were inspected. The client bundle is 435,282 bytes minified and 135,311 bytes gzipped (Node zlib defaults): increases of 3,593 and 1,461 bytes over section 3. Dependencies and the plain TypeScript build script are unchanged.

## 5. Review and save screens

Status: **Done**

Files: `client/review/ReviewView.btsx`, `PlannedFile.btsx`, `types.ts`, and `client/ui/SourceViewer.btsx`.

- [x] Migrate the shared page/tabs review screen with explicit create-page, edit-page, add-tabs, and edit-tabs modes.
- [x] Render proposed files and original source through a reusable source viewer, preserving literal source text.
- [x] Preserve file actions, compiler confirmation, route summary, and mode-specific save labels.
- [x] Keep API calls and reviewed hashes in TypeScript; preserve server checks for changed drafts, files, and contracts.
- [x] Preserve pending/error feedback, duplicate-submit protection, route eligibility for tabs, and back-to-draft behavior.
- [x] Verify review/save for all four modes, stale-review rejection, and recovery after a failed save.

Complete when: every page and tabs save flows through the BTSX review screen and retains the existing review protections.

Evidence (October 18, 2026): `bun run check` passed all 57 non-browser tests, including 6 bundler integration tests and server checks for changed drafts, files, and component contracts. The final production build and type check passed. All 39 widget browser tests passed: 22 existing workflows, 5 shared-component tests, 4 page-editor tests, and 8 new read-only review tests. These cover all four save modes, real page/tabs writes, proposed and original literal source (including empty originals), retained disclosure state, back-to-draft focus, pending/duplicate-submit protection, failed-save retry and receipt cleanup, new hashes after stale-review rejection, tabs route eligibility, and closing during a pending save. Desktop and mobile screenshots were inspected, including horizontal scrolling for long source lines. The client bundle is 438,819 bytes minified and 136,411 bytes gzipped (Node zlib defaults): increases of 3,537 and 1,100 bytes over section 4. Dependencies, server behavior, and the plain TypeScript build script are unchanged.

## 6. Source and collection inspectors

Status: **Done**

Files: `client/inspect/FileInspector.btsx`, `CollectionInspector.btsx`, `DetectedItem.btsx`, and `types.ts`.

- [x] Migrate file details, source viewing, clipboard feedback, compiler errors, and edit-page actions.
- [x] Migrate the list of existing tab groups and its edit/source-only actions.
- [x] Migrate collection metadata, bindings, consumers, item kinds, and per-item details.
- [x] Reuse `SourceViewer.btsx` and the existing recursive `TypeContract.btsx`.
- [x] Preserve explanations for computed/read-only collections and empty item lists.
- [x] Verify source copying, navigation/tabs inspection, declared and union types, and opening the correct page or tab editor.

Complete when: file and collection inspection use BTSX and their legacy HTML-rendering helpers are no longer needed.

Evidence (October 18, 2026): `bun run check` passed production build, type checking, and all 57 non-browser tests, including 6 bundler integration tests. All 46 widget browser tests passed: the previous 39 workflows plus 7 new read-only inspector tests. Coverage includes exact source copying, compiler diagnostics and literal text, clipboard failure/retry and obsolete feedback, correct page and tab-group editor actions, source-only tab groups, collection bindings and consumers, nested union contracts, optional fields, item metadata, inferred types, computed/read-only and empty collections, retained disclosure state, theme changes, focus, and real page/tabs workflows. Desktop and mobile screenshots were inspected, including source and type-table overflow. The legacy `renderFileTabs` and `renderType` HTML helpers were removed. The client bundle is 445,616 bytes minified and 138,437 bytes gzipped (Node zlib defaults): increases of 6,797 and 2,026 bytes over section 5. Dependencies, server behavior, and the plain TypeScript build script are unchanged.

## 7. Scan, success, and error screens

Status: **Done**

Files: `client/status/StatusView.btsx`, `ScanView.btsx`, `SuccessView.btsx`, `ErrorView.btsx`, and `types.ts`.

- [x] Migrate scan markup and progress text while preserving the sonar and HexTrace appearance.
- [x] Keep loader integration in effects with cleanup; preserve reduced-motion behavior and configured scan duration.
- [x] Migrate page and tabs success screens, including open-page, edit-page, and return actions.
- [x] Migrate connection failures and retry actions with accessible error messages.
- [x] Preserve reload receipts and ensure a closed or superseded request cannot reopen the builder.
- [x] Verify scan cancellation, retry, reduced motion, successful saves across reloads, and all success actions.

Complete when: these states render through BTSX and pending work cannot update an obsolete view.

Evidence (October 18, 2026): `bun run check` passed production build, type checking, and all 57 non-browser tests, including 6 bundler integration tests. All 64 browser tests passed: 58 widget tests (including 12 new read-only status tests) and 6 native loader tests. Coverage includes configured scan duration, progress updates without loader replacement, reduced motion, loader/style deduplication and cleanup on transitions, close, and host removal; literal accessible errors, retry and back navigation; all four success modes across reloads, open/edit/return/close actions, receipt acknowledgement and expiry, restored route coordination, scan cancellation, and delayed recovery or save responses after reopening. Desktop/mobile screenshots and dark mode were inspected. Recovery now checks the panel generation so an old lookup cannot reopen a subsequently closed builder; pending saves cannot replace a newer draft or steal its focus. The client bundle is 452,075 bytes minified and 139,912 bytes gzipped (Node zlib defaults): increases of 6,459 and 1,475 bytes over section 6. Dependencies, server behavior, and the plain TypeScript build script are unchanged.

## 8. Builder shell and state cleanup

Status: **Done**

Files: `client/Builder.btsx`, `state.ts`, `controller.ts`, `api.ts`, `persistence.ts`, `browser/*.ts`, and the reduced `mount.ts`.

- [x] Consolidate migrated screens behind one builder root and a typed screen-state union.
- [x] Render launcher, backdrop, panel, and screen selection declaratively.
- [x] Keep a single authoritative owner for each draft; remove temporary bridges and duplicate rendering paths.
- [x] Extract API requests, storage/receipts, theme preferences, and route coordination into TypeScript modules.
- [x] Keep small browser utilities for dragging, pointer capture, viewport clamping, focus trapping/restoration, and animation; clean up listeners and observers on unmount.
- [x] Reduce `mount.ts` to bootstrap and integration code; remove legacy view HTML strings, listener rebinding, and unused helpers.
- [x] Verify shortcuts, launcher preferences, route changes, resize behavior, disposal, and repeated open/close cycles.

Complete when: all builder UI is authored in BTSX, the shell has one rendering lifecycle, and imperative DOM code is limited to browser integration utilities.

Evidence (October 18, 2026): `Builder.btsx` owns the declarative shell and screen selection behind one Octane root, with a typed screen union in `state.ts`. The controller owns drafts and async transitions; API, persistence, preferences, routes, animation, geometry, shortcuts, and focus have focused TypeScript modules. All six temporary view roots, legacy shell HTML, listener rebinding, and the unused string icon helper were removed. `mount.ts` decreased from 1,089 to 35 lines. Screen versions replace root-identity guards, including a fix preventing a delayed file load from replacing a newer screen in the same open session. Closing disposes the screen effects while retaining drafts; host removal also disposes subscriptions, listeners, observers, timers, and pointer capture. `bun run check` passed all 57 non-browser tests, including 6 bundler integration tests; the final build and type check also passed. All 69 browser cases were verified: 68 passed in the full run, then all 5 shell tests passed after correcting a test-only launcher-label selector. These cover 63 widget cases and 6 native loader cases, including new checks for repeated open/close cycles and retained drafts, stable shell elements, drag cancellation, resize clamping, removal/reinjection, blocked browser storage, custom shortcuts, and obsolete file responses. Desktop/mobile and dark-mode screenshots were inspected. The client bundle is 454,177 bytes minified and 141,480 bytes gzipped (Node zlib defaults): increases of 2,102 and 1,568 bytes over section 7. The client type checker now includes the existing CSS module declaration for the BTSX shell. Dependencies, server behavior, and the plain TypeScript build script are unchanged.

## 9. Final verification and measurements

Status: **Next**

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
