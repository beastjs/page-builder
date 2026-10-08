# Changelog

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
