# deck — addendum: folders and tabs

**Date:** 2026-09-14
**Amends:** `2026-09-14-deck-design.md` (sidebar grouping; how sidebar clicks map to the main area)
**Status:** approved design (Daniel, 2026-09-14), scheduled as Phase 1.5 — after Phase 1 core, before CC status

## Decisions

| Topic | Decision |
|---|---|
| Sidebar grouping | **Manual folders replace automatic project grouping.** The spec's "grouped by project (live cwd)" row is superseded. |
| Folder model | `folders: Record<id, { id, name, order, collapsed }>`; `Terminal.folderId?: string` (absent = "Unfiled", always shown last). |
| Folder ops | `+ Folder` in the sidebar header; rename (double-click header); delete (hover-x; its terminals move to Unfiled, no confirm needed); collapse/expand (click chevron); reorder folders by drag. |
| Moving terminals | Drag a row onto a folder header or into a folder's list (HTML5 drag-and-drop). Right-click a row → "Move to…" submenu as the no-mouse-precision fallback. |
| Where new terminals land | The folder of the currently focused terminal; if none, the folder whose header was last clicked; else Unfiled. |
| Tabs | **Tab bar at the top of the main area = the open terminals, in open order.** The sidebar remains the full inventory (open and closed/detached). |
| Tab model | `openTabs: string[]` (terminal ids), `activeTabId: string \| null`. In Phase 1.5 `layout` is derived: `activeTabId ? leaf(activeTabId) : null`. Phase 4 splits live *inside* a tab (each tab owns a layout tree). |
| Tab ops | Click = activate. Hover-x / ⌘W = close tab (detach only; terminal stays in sidebar); closing the active tab activates its right neighbour, else left. Drag to reorder. Middle-click closes. |
| Sidebar ↔ tabs | Clicking a sidebar row opens its tab if absent (appended at the end) and activates it. Killing a terminal removes its tab. Rows of open terminals show a subtle "open" marker. |
| Keys | ⌘W close active tab · ⌘⇧[ / ⌘⇧] previous/next tab · ⌘1…⌘9 jump to tab N · ⌘⇧N new folder. ⌘T / ⌘B unchanged. |
| Persistence | `folders`, `folderId`, `openTabs`, `activeTabId` all persist in `state.json`; on launch, tabs referencing dead terminals are dropped. |
| Look | Tab bar 34px, sits in the title-bar drag region right of the traffic lights (drag region preserved between/after tabs); tabs show status dot + title, active tab uses `--surface-2` with an accent underline; no icons beyond the dot. |

## Reducer additions (main/store.ts)

`ADD_FOLDER {folder}`, `RENAME_FOLDER {id,name}`, `DELETE_FOLDER {id}` (re-files terminals), `SET_FOLDER_COLLAPSED {id,collapsed}`, `REORDER_FOLDERS {ids}`, `MOVE_TERMINAL {id, folderId|null}`, `OPEN_TAB {id}` (append if absent + activate), `CLOSE_TAB {id}` (remove + neighbour activation), `ACTIVATE_TAB {id}`, `REORDER_TABS {ids}`. `SHOW_TERMINAL` becomes an alias of `OPEN_TAB`; `CLOSE_PANE` becomes an alias of `CLOSE_TAB`; `REMOVE_TERMINAL` also removes the tab. Hydrate prunes tabs whose terminal is missing.

## Out of scope for 1.5

Nested folders; per-folder colors/icons (Phase 5 polish); tab pinning; multiple windows.
