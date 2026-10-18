# Client BTSX migration: verification and measurements

Verified October 18, 2026. Sections 0–9 of the [migration plan](MIGRATION_PLAN.md) are complete. The client UI is authored in BTSX behind one Octane root; TypeScript owns workflow state, API requests, receipts, and browser integration. The plain TypeScript build script and dependency versions are unchanged.

The migration improves the structure for maintaining the client. These measurements establish a current runtime baseline; there is no comparable runtime measurement of the former client, so they do not establish a speedup or slowdown from BTSX.

## Verification

- `bun run check`: type checking, production build, and **58 non-browser tests passed**, including 6 Vite/Rspack/Rsbuild integration tests and the new package artifact test.
- Complete Playwright run: **69 tests passed** on a separate server at port 5191: 63 widget cases and 6 native loader cases.
- `bun run pack:check`: passed. The dry-run package contains 20 files, including all adapters, public declarations, the client, README, changelog, and license. No publish was performed.
- `tests/package.test.ts` checks the built client has no external imports, every adapter runtime import is a Node built-in or declared package, and public entrypoints/declarations exist. Current non-built-in adapter imports resolve to `beast-tsrx`, `octane`, and `typescript`; the form binding is compiled into the client.
- Desktop/mobile and light/dark screenshots were inspected for the palette, forms, reviews, source/type overflow, status screens, and moved/resized shell. Focus, reduced motion, cancellation, reload recovery, actual page/tabs writes, stale responses, shortcuts, storage fallback, disposal, and reinjection passed browser checks.

The browser suite restores its playground fixtures after real write tests. This verification does not include a fresh dependency installation in an empty consumer project; the bundler tests consume the built adapters and the package test checks declared runtime imports.

## Bundle measurements

Measured from `dist/client.js` with Node's `node:zlib` gzip defaults, independently of runtime timings.

| Client | Minified bytes | Gzip bytes |
| --- | ---: | ---: |
| Recorded baseline before section 3 | 430,304 | 133,446 |
| Final | 454,177 | 141,480 |
| Change | +23,873 (+5.55%) | +8,034 (+6.02%) |

This baseline already included the migrated tabs editor and palette. It is not a baseline for the original entirely imperative client. The final artifact is unchanged from section 8. The recorded growth accompanies the remaining views, shared components, form integration, and consolidated shell; it does not add runtime dependencies or another client chunk. No package splitting or dependency changes were justified by this size change.

Client SHA-256: `02f5d2a701167ca75ddb6d10431a155ed3c7e932626649025bc9879bc66db1af`. UI source revision: `e8776b6fc60d854e975ac938032daf82f8219d43`.

## Responsiveness

Raw samples and environment metadata are in [the saved measurement JSON](measurements/client-2026-10-18.json). Reproduce after building and after finishing other CPU-heavy checks:

```sh
bun run build
bun scripts/measure-client.ts test-results/client-performance.json
```

The read-only harness serves the production client on an ephemeral localhost port. It uses 1,000, 5,000, and 10,000 synthetic files, split evenly between pages and components, with one navigation target and no collections/tab groups. Each operation has 5 warmups and 30 recorded samples. Reported median is the upper middle sorted sample; p95 uses nearest rank.

Environment: Apple M2 Pro, 10 logical CPUs, 16 GiB RAM, darwin/arm64, headless Chromium 156.0.8078.4, Bun 1.4.0, 1440 × 1000 viewport, reduced motion, no CPU throttling. This is one local run, not a performance guarantee for other hardware or browsers.

Timings below are **median / p95 in milliseconds**. They end after synchronous DOM commit and forced layout. Starting-state resets, frame waits, network, project scanning, and paint are excluded. Palette totals include assigning the query value and dispatching a synthetic native input/keydown event. Editor event timings begin at input dispatch, after assigning the value and positioning the caret; the separate full-replacement total includes that preparation. Assertions verify result counts, keyboard selection, suggested routes, source value, caret, focus, and absence of mounted palette rows in the editor.

| Operation | 1,000 files | 5,000 files | 10,000 files |
| --- | ---: | ---: | ---: |
| Narrow all file results to one | 5.8 / 8.6 | 31.6 / 57.3 | 66.8 / 97.6 |
| Expand one result to the full inventory | 47.4 / 57.7 | 256.7 / 289.2 | 488.6 / 551.2 |
| Change query with the same file rows | 1.6 / 2.4 | 8.1 / 10 | 12 / 14.1 |
| Move keyboard selection | 1.8 / 2.4 | 9.3 / 11.8 | 16.2 / 20.6 |
| Page name: input event through layout | 0.6 / 1.7 | 0.5 / 1.4 | 0.5 / 1.4 |
| 58 KB source: input event through layout | 4.7 / 5.2 | 5.6 / 6.5 | 4.4 / 7.6 |
| 58 KB source: full value/caret replacement through layout | 7.3 / 9.9 | 63.5 / 68.8 | 139.2 / 143.7 |

The source buffer contains 2,002 lines and about 58 KB. Its full-replacement measurement replaces the entire value, rather than simulating a single character typed by a person. A separate fresh-session check reproduced the rising full-replacement cost without repeated palette filtering. Phase inspection placed most of the 10,000-file replacement cost before input dispatch, during value assignment/caret placement; the table therefore reports input-event work separately. The exact cause of the pre-event cost was not profiled further.

## Remaining performance work

The palette still constructs actions for the inventory and mounts every matching result. Clearing a narrow query to thousands of rows is the clearest client bottleneck: 256.7 ms median at 5,000 files and 488.6 ms at 10,000. Even retaining all rows or moving selection grows with inventory size. A bounded visible result window or virtualization is the next focused performance improvement to evaluate, while preserving keyboard navigation and accessibility.

Page-editor event processing remains small in this fixture, including the long source buffer, but full-buffer replacement/caret placement is materially more expensive after large inventories. This report does not claim low physical keyboard-to-paint latency. Mobile/low-end timing, mixed collection/tab inventories, scan time, memory profiling, and a matched pre-migration runtime comparison remain unmeasured. Existing source-based compiler validation limits described in the README still apply.
