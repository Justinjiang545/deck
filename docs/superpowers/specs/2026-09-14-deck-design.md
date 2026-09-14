# deck — terminal manager design

**Date:** 2026-09-14
**Status:** approved design, pre-implementation

## Goal

A macOS desktop app that owns all of Daniel's terminals and Claude Code (CC) sessions.
Left: a sidebar listing every terminal, grouped by project, with live CC status.
Right: the terminals themselves (real zsh via a PTY), one or several in a split layout.
Terminals survive app quit/relaunch. The app notifies when a CC session needs attention.

Non-goals for v1: attaching to terminals the app did not spawn; light/dark auto-switching
beyond the bundled themes; importing third-party color schemes; multiple named workspaces;
Windows/Linux.

## Decisions (from brainstorm)

| Topic | Decision |
|---|---|
| Form factor | Native desktop app, Electron |
| Stack | Electron + React (Vite, TypeScript) renderer, node-pty, @xterm/xterm |
| Persistence | tmux-backed: one tmux session per terminal on a private tmux server |
| Scrollback | xterm.js owns scrollback; tmux mouse off; refilled from `capture-pane` on attach |
| Sidebar scope | Only terminals the app spawned; adopts orphan `deck-*` tmux sessions on launch |
| Grouping | By project = live cwd of the pane; creation order within a group |
| Row content | Custom icon, title (auto or renamed), CC status dot + label, elapsed since activity, last CC message snippet |
| CC launch | `+ Claude` (project picker → runs `claude`) and `Resume` (global recent list → `claude --resume <id>`) |
| CC status | Hooks primary (installed into `~/.claude/settings.json`), JSONL fallback |
| States | working · needs-you · idle · none |
| Notifications | Banner + sound on needs-you for unfocused terminals; banner on CC session end/crash; dock badge = count of needs-you |
| Splits | Binary split tree, one layout, persisted |
| Keys | Cmd shortcuts, iTerm-like; everything else passes to the shell |
| Close | ⌘W closes pane only; hover-x / ⌘⇧W kills the tmux session (confirm if foreground ≠ zsh) |
| New terminal cwd | Project picker (CC projects ∪ ~/Documents/GitHub ∪ previously used), MRU, fuzzy; Escape = $HOME |
| Packaging | electron-builder, unsigned local .app; `npm run dev` for development |
| Theme | 3–4 bundled themes (graphite default, ember, tide, paper); font family/size configurable; minimal chrome |
| Motion | Subtle: pulsing dot (working), breathing accent glow (needs-you), dim dot (idle), red + brief shake (crash); honors `prefers-reduced-motion` |
| Testing | Vitest on pure logic; UI verified manually per phase |
| Location | `~/Documents/GitHub/deck` |

## Architecture

Three processes:

1. **Main (Node/Electron)** — owns all state and side effects: tmux server, PTY attachments,
   hook receiver socket, JSONL reader, state persistence, notifications, hook installation.
2. **Renderer (React)** — sidebar + split tree of xterm.js panes. Communicates with main only
   through a typed IPC contract (`invoke` for commands, `on` for events). Never touches the
   filesystem or spawns processes.
3. **Hook script (bash)** — installed into `~/.claude/settings.json`. On each CC hook event it
   POSTs `{event, session_id, cwd, term_id: $DECK_TERM_ID}` to main's unix socket. 3s timeout,
   always exits 0, never blocks CC.

### tmux server

- Private server: `tmux -L deck -f <bundled deck.conf>`.
- `deck.conf`: `status off`, `unbind C-b; set -g prefix None`, `set -g mouse off`,
  `set -g history-limit 50000`, `set -g default-shell /bin/zsh`, `set -g remain-on-exit off`,
  `set -g default-terminal tmux-256color`, `set -ga terminal-overrides ',xterm-256color:Tc'`,
  `set -g escape-time 0`, `set -g focus-events on`, `set -g allow-passthrough on`.
- One session per sidebar terminal, named `deck-<uuid>`, created with
  `new-session -d -s deck-<id> -c <cwd> -e DECK_TERM_ID=<id>`.
- Only visible panes are attached (`attach -t deck-<id>` inside node-pty). Non-visible
  terminals keep running detached.
- tmux binary resolved from PATH then `/opt/homebrew/bin/tmux`; missing → blocking dialog
  with `brew install tmux`.

## Main-process modules

| Module | Responsibility | Tested |
|---|---|---|
| `tmux.ts` | Pure argv builders (`newSession`, `kill`, `list`, `capturePane`, `query`, `sendKeys`, `resize`) + one `run(argv)` executor. Parses `list-panes -F` output into `{id, pid, cwd, fgCommand, dead}`. | builders + parser |
| `pty.ts` | Per visible pane: spawn `tmux -L deck attach -t deck-<id>` in node-pty; pipe bytes ↔ renderer; resize; detach on pane close. On attach, first emits `capture-pane -p -S -50000 -e` output so xterm.js scrollback is pre-filled, then streams live bytes. | manual |
| `store.ts` | Single reducer over `AppState` (below). Persists to `~/Library/Application Support/deck/state.json`, debounced 500ms, atomic write. | reducer |
| `hooks-server.ts` | Unix socket `~/Library/Application Support/deck/hooks.sock`. Maps hook events → actions: `SessionStart`→attach sessionId to terminal; `UserPromptSubmit`→working; `Stop`→needs-you; `Notification`→needs-you; `SessionEnd`→status none + notify. `installHooks()`: idempotent merge into `settings.json`, entries tagged with `"deck": true`-style marker comment in the command string so they can be found/removed; never rewrites a file that fails to parse. | event→action, merge |
| `cc-sessions.ts` | Indexes `~/.claude/projects/*/*.jsonl` for the Resume list: `{sessionId, project (from cwd of first record), firstPrompt, lastActive}`. Tail-watches JSONL of live sessions for `lastMessage` (latest assistant text block) and, if no hook seen for a session, infers status from the last record type. | parser |
| `poller.ts` | Every 1s: `list-panes` across the server → update cwd/fgCommand/title; mark dead sessions; on launch adopt orphan `deck-*` sessions not in state. | reconcile logic |
| `projects.ts` | Project picker source: union of `~/.claude/projects` slugs that exist on disk, `~/Documents/GitHub/*`, and dirs previously used in deck; MRU-sorted. Roots configurable. | union/sort |
| `notify.ts` | Electron `Notification` (+ sound if enabled) and `app.dock.setBadge`. Suppressed when the terminal is focused and the window is focused. Click → focus terminal. | manual |
| `ipc.ts` | Typed channel definitions shared with renderer (`shared/ipc.ts`). | types |

### AppState

```ts
type CCStatus = 'working' | 'needs-you' | 'idle';
interface Terminal {
  id: string;            // uuid; tmux session = deck-<id>
  createdAt: number;
  customTitle?: string;
  cwd: string;           // live from pane_current_path
  fgCommand: string;     // live from pane_current_command
  lastActivity: number;
  cc: null | {
    sessionId?: string;
    status: CCStatus;
    lastMessage?: string;
    unseen: boolean;     // true from needs-you until the terminal is focused
  };
}
type Layout =
  | { type: 'leaf'; terminalId: string }
  | { type: 'split'; dir: 'h' | 'v'; ratio: number; a: Layout; b: Layout };
interface AppState {
  terminals: Record<string, Terminal>;
  layout: Layout | null;
  focusedTerminalId: string | null;
  sidebarOpen: boolean;
  settings: {
    theme: 'graphite' | 'ember' | 'tide' | 'paper';
    fontFamily: string; fontSize: number;
    sound: boolean;
    projectRoots: string[];
    recentProjects: string[];
  };
}
```

Status derivation: `cc` becomes non-null when `fgCommand === 'claude'` or a hook event arrives
for the terminal; back to null when `fgCommand` is not claude and `SessionEnd` was seen (or no
claude process for 3 polls). Focusing a terminal with `unseen` clears it and sets status idle
if it was needs-you.

## Renderer

- **Sidebar** (`Sidebar.tsx`, `TerminalRow.tsx`, `ProjectGroup.tsx`): groups derived from
  `terminals[].cwd` → project name = last path segment (or `~`). Row: status icon, title, status
  label, elapsed, snippet. Click focus/show; double-click rename; hover-x kill (confirm dialog
  if `fgCommand !== 'zsh'`). Header buttons: `+ Terminal`, `+ Claude`, `Resume`. ⌘B toggles.
- **Split tree** (`layout.ts`, pure, tested): `splitLeaf(layout, leafId, dir, newTerminalId)`,
  `removeLeaf`, `replaceLeaf`, `setRatio`, `findLeaf`, `leaves`. `SplitView.tsx` renders it
  with draggable dividers (min pane 200px). Clicking a sidebar terminal already in a leaf
  focuses it; otherwise replaces the focused leaf.
- **Pane** (`TerminalPane.tsx`): one xterm.js instance (`@xterm/xterm`, addons: fit, webgl with
  canvas fallback, web-links). Bytes over IPC; resize observer → fit → `pty:resize`.
- **Palette** (`Palette.tsx`): single fuzzy-search list component used by the project picker
  and the Resume list.
- **Theming** (`themes/*.ts`): each theme exports tokens — `bg, surface, border, text, muted,
  accent, working, needsYou, danger`, 16 ANSI colors, cursor, selection. Applied as CSS
  variables on `:root` and as xterm `theme`. Settings panel (⌘,): theme, font, size, sound,
  project roots.
- **Icons/motion** (`icons/`): hand-drawn SVG set (terminal, claude, project, split, close,
  resume, settings). Status: working = pulsing dot; needs-you = breathing accent glow on dot
  and row edge; idle = dim static dot; crash/exit = red dot + 300ms shake. Row hover/selection
  150ms ease. All animation disabled under `prefers-reduced-motion`.
- **Keys**: ⌘T new terminal · ⌘N new claude · ⌘D split right · ⌘⇧D split down · ⌘W close pane ·
  ⌘⇧W kill terminal · ⌘⇧[ / ⌘⇧] prev/next terminal · ⌘K clear · ⌘B sidebar · ⌘, settings ·
  ⌘C/⌘V copy/paste. Nothing else intercepted.

## Data flow & lifecycle

- **Launch**: ensure tmux binary → start server if needed → `tmux ls` → reconcile with
  `state.json` (adopt orphan `deck-*`, drop terminals whose session is gone) → restore layout
  (leaves referencing dead terminals collapse) → attach visible panes → `installHooks()` if
  missing → start poller + hook socket → index JSONL in background.
- **New terminal**: picker → `new-session` → `ADD_TERMINAL` → `replaceLeaf(focused)` (or create
  root leaf) → attach → focus. `+ Claude`: same, then `send-keys 'claude' Enter`. Resume:
  `send-keys 'claude --resume <sid>' Enter`.
- **Quit**: detach PTYs only. tmux server, sessions, and CC processes keep running.
- **Status**: hook → socket → reducer → sidebar re-render → maybe `notify`. Focusing a
  needs-you terminal → idle, unseen=false, badge recount.
- **Kill**: `kill-session` → `REMOVE_TERMINAL` → `removeLeaf`; if it was the last leaf, layout
  becomes null and an empty-state prompt shows.

## Error handling

- tmux missing → modal with install instructions; app unusable until relaunch.
- Hook socket unavailable → hook script times out at 3s and exits 0; CC unaffected.
- `settings.json` unparseable → do not modify; show a one-time warning in the app.
- Session dies outside the app → poller marks dead → row removed with toast.
- Attach failure (session vanished between poll and click) → toast, remove row.
- `state.json` corrupt → back up to `state.json.bak`, start fresh, adopt orphans.

## Testing

- Vitest, TDD: `store` reducer, `layout` ops, JSONL parser, hook event → action mapping,
  `settings.json` hook merge (idempotent, preserves existing hooks), tmux argv builders and
  `list-panes` parser, project-list union/MRU, poller reconcile.
- Manual per phase with screenshots: attach/persist across relaunch, scrollback refill,
  resize correctness, status transitions with a live CC session, notifications, splits.
- `npm run typecheck` and `npm test` must be green before each phase is called done.

## Phases

1. Skeleton (Electron + Vite + React + TS), tmux server, sidebar with flat rows, single pane,
   new-terminal picker, persistence across relaunch, ⌘T/⌘W/⌘⇧W/⌘B.
2. CC status: hook install + socket server, JSONL index/tail, status states in sidebar,
   `+ Claude`, Resume palette, project grouping.
3. Notifications: banners, sound, dock badge, session-end alerts, unseen handling.
4. Splits: layout tree, SplitView, dividers, ⌘D/⌘⇧D, layout persistence.
5. Polish: 4 themes, settings panel, SVG icon set, status motion, electron-builder .app.
