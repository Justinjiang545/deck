import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

export interface ProjectEntry {
  path: string
  name: string
  source: 'recent' | 'cc' | 'root'
}

function isDir(p: string): boolean {
  try { return statSync(p).isDirectory() } catch { return false }
}

function newestJsonl(dir: string): { file: string; mtime: number } | null {
  let best: { file: string; mtime: number } | null = null
  let names: string[]
  try { names = readdirSync(dir) } catch { return null }
  for (const n of names) {
    if (!n.endsWith('.jsonl')) continue
    const f = join(dir, n)
    let mtime: number
    try { mtime = statSync(f).mtimeMs } catch { continue }
    if (!best || mtime > best.mtime) best = { file: f, mtime }
  }
  return best
}

export function projectPathFromCCDir(dir: string): string | null {
  const j = newestJsonl(dir)
  if (!j) return null
  let head: string
  try { head = readFileSync(j.file, 'utf8').slice(0, 64 * 1024) } catch { return null }
  for (const line of head.split('\n')) {
    if (!line.trim()) continue
    try {
      const rec = JSON.parse(line) as { cwd?: unknown }
      if (typeof rec.cwd === 'string' && rec.cwd) return rec.cwd
    } catch { /* partial line at slice boundary */ }
  }
  return null
}

export function listProjects(opts: {
  ccProjectsDir: string
  roots: string[]
  recent: string[]
  exists?: (p: string) => boolean
}): ProjectEntry[] {
  const exists = opts.exists ?? isDir
  const out: ProjectEntry[] = []
  const seen = new Set<string>()
  const push = (path: string, source: ProjectEntry['source']): void => {
    if (seen.has(path) || !exists(path)) return
    seen.add(path)
    out.push({ path, name: basename(path) || path, source })
  }

  for (const p of opts.recent) push(p, 'recent')

  if (existsSync(opts.ccProjectsDir)) {
    const cc: { path: string; mtime: number }[] = []
    for (const slug of readdirSync(opts.ccProjectsDir)) {
      const d = join(opts.ccProjectsDir, slug)
      if (!isDir(d)) continue
      const j = newestJsonl(d)
      const path = j ? projectPathFromCCDir(d) : null
      if (path && j) cc.push({ path, mtime: j.mtime })
    }
    cc.sort((a, b) => b.mtime - a.mtime)
    for (const c of cc) push(c.path, 'cc')
  }

  for (const root of opts.roots) {
    if (!isDir(root)) continue
    for (const n of readdirSync(root).sort()) {
      if (n.startsWith('.')) continue
      push(join(root, n), 'root')
    }
  }
  return out
}
