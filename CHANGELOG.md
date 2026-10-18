# Changelog

## 0.3.0 — 2026-10-18

- Detect section IDs in Beast pages and components. Offer editing for existing sections and creation only when no matching ID exists, with compiler validation and stale-source protection before saving.
- Persist builder coordinates in localStorage across reopening and reloads, with viewport clamping and a keyboard reset.
- Expand create and edit panels by up to 60% and animate height changes consistently across screens, review disclosures, and interrupted navigation. Preserve focus and reduced-motion behavior.
- Add a shared sliding hover indicator across all palette tabs, with scroll-aware alignment, filtering cleanup, and dark-mode support.
- Bundle OKX regular/medium and BMR regular for the builder's sans-serif and monospace text without requiring host application assets.
- Complete the client BTSX migration with shared views, typed controller state, form bindings, and browser subscription cleanup.
- Isolate browser test fixtures from the editable playground and verify packaged consumer installation before release.

## 0.2.0 — 2026-10-17

- Edit existing page source with compiler validation, reviewed changes, and stale-source checks before saving.
- Add and edit typed Tabs components on registered pages, with contract-driven fields, route selection, and drafts that survive navigation.
- Discover existing tab instances and registered static page routes, including nested and lazy routes.
- Move the builder with mouse, touch, or keyboard; keep its position within the viewport across views and reopening.
- Toggle the builder theme and launcher visibility, with browser-persisted preferences and thin themed scrollbars. Theme controls remain available in every view's footer.
- Refine the compact builder UI with staggered entrances, a comet-like hex trail, and an Atom loader that smoothly transitions to the blue ready indicator. Reduced-motion preferences are respected.
- Support Ctrl+N and Ctrl+P alongside the existing result and page-selector navigation controls.
- Include typed Tabs and icon utilities for the playground, with expanded project, API, and browser coverage.

## 0.1.0 — 2026-10-08

Initial release of `@beastjs/page-builder`.

- Development-only plugins for Vite, Rspack, and Rsbuild with configurable shortcuts, position, theme, scan duration, and launcher.
- Floating Shadow DOM widget opened with Cmd+B / Ctrl+B, with an entrance transition and hexagonal sonar scan.
- Searchable inventory of Beast pages and components, navigation menus, and tab groups.
- Item inspectors resolve TypeScript contracts, imported component props, required and optional fields, literal unions, and discriminated union variants. Inferred shapes are identified separately.
- Page scaffolding creates `src/pages/<Name>.btsx`, registers a lazy TanStack route in `src/router.ts`, and adds the corresponding navigation link.
- Blank and landing page starters, section insertion, source editing, Beast/Octane compilation, and a review of all proposed files before saving.
- Static BTSX menus and shared TypeScript menu arrays, including grouped data and configurable defaults for required fields.
- Reviewed saves check for stale source, stage all files, preserve permissions, and roll back on write failures. Success survives development-server reloads.
- Keyboard navigation, focus management, mobile layouts, and reduced-motion support.

This version scaffolds source and inspects source semantics. Computed values can remain unresolved; it does not provide visual drag-and-drop editing or whole-project TypeScript validation.
