import { closeSync, openSync, readSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

/** One resumable Claude Code session, indexed from ~/.claude/projects/<slug>/<sessionId>.jsonl. */
export interface CcSession {
  sessionId: string
  cwd: string
  /** CC's own auto title (`ai-title` record), if it wrote one. */
  title?: string
  /** Most recent prompt (`last-prompt` record), else the first real user prompt. */
  prompt?: string
  branch?: string
  lastActive: number
}

const HEAD_BYTES = 64 * 1024
const TAIL_BYTES = 256 * 1024
const MAX_TEXT = 200

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT)
}

/** JSON records in a chunk; a chunk cut mid-line just drops its partial first/last line. */
function records(chunk: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const line of chunk.split('\n')) {
    if (!line.trim()) continue
    try {
      const r = JSON.parse(line) as unknown
      if (r && typeof r === 'object' && !Array.isArray(r)) out.push(r as Record<string, unknown>)
    } catch { /* partial line at a chunk boundary */ }
  }
  return out
}

/** Text a human typed: a string content or text blocks — never tool results, meta records, or <command-…> wrappers. */
function userPrompt(r: Record<string, unknown>): string | undefined {
  if (r['type'] !== 'user' || r['isMeta']) return undefined
  const content = (r['message'] as { content?: unknown } | undefined)?.content
  let text = ''
  if (typeof content === 'string') text = content
  else if (Array.isArray(content)) {
    for (const b of content) {
      if (b && typeof b === 'object' && (b as { type?: unknown }).type === 'text') text += String((b as { text?: unknown }).text ?? '') + ' '
    }
  }
  text = text.trim()
  if (!text || text.startsWith('<')) return undefined
  return oneLine(text)
}

/** Pure: build a session entry from the head and tail of its transcript. null if it never recorded a cwd (nothing to resume into). */
export function parseSession(sessionId: string, head: string, tail: string, lastActive: number): CcSession | null {
  const headRecs = records(head)
  const tailRecs = records(tail)
  let cwd: string | undefined
  let branch: string | undefined
  let firstPrompt: string | undefined
  for (const r of headRecs) {
    if (!cwd && typeof r['cwd'] === 'string' && r['cwd']) cwd = r['cwd']
    if (!branch && typeof r['gitBranch'] === 'string' && r['gitBranch']) branch = r['gitBranch']
    if (!firstPrompt) firstPrompt = userPrompt(r)
  }
  let title: string | undefined
  let lastPrompt: string | undefined
  for (const r of [...headRecs, ...tailRecs]) {
    if (r['type'] === 'ai-title' && typeof r['aiTitle'] === 'string' && r['aiTitle'].trim()) title = oneLine(r['aiTitle'])
    if (r['type'] === 'last-prompt' && typeof r['lastPrompt'] === 'string' && r['lastPrompt'].trim()) lastPrompt = oneLine(r['lastPrompt'])
    if (!cwd && typeof r['cwd'] === 'string' && r['cwd']) cwd = r['cwd']
  }
  if (!cwd) return null
  const prompt = lastPrompt ?? firstPrompt
  return { sessionId, cwd, lastActive, ...(title ? { title } : {}), ...(prompt ? { prompt } : {}), ...(branch ? { branch } : {}) }
}

function readSlice(fd: number, start: number, len: number): string {
  const buf = Buffer.alloc(len)
  const n = readSync(fd, buf, 0, len, start)
  return buf.subarray(0, n).toString('utf8')
}

/** Most recently active CC sessions across every project, newest first. Reads only each file's head + tail. */
export function listCcSessions(ccProjectsDir: string, limit = 60): CcSession[] {
  const files: { file: string; mtime: number; size: number }[] = []
  let slugs: string[] = []
  try { slugs = readdirSync(ccProjectsDir) } catch { return [] }
  for (const slug of slugs) {
    const dir = join(ccProjectsDir, slug)
    let names: string[] = []
    try { names = readdirSync(dir) } catch { continue }
    for (const n of names) {
      if (!n.endsWith('.jsonl')) continue
      const file = join(dir, n)
      try {
        const st = statSync(file)
        if (st.isFile() && st.size > 0) files.push({ file, mtime: st.mtimeMs, size: st.size })
      } catch { /* vanished */ }
    }
  }
  files.sort((a, b) => b.mtime - a.mtime)
  const out: CcSession[] = []
  for (const f of files) {
    if (out.length >= limit) break
    let fd: number | null = null
    try {
      fd = openSync(f.file, 'r')
      const head = readSlice(fd, 0, Math.min(HEAD_BYTES, f.size))
      const tail = f.size > HEAD_BYTES ? readSlice(fd, Math.max(HEAD_BYTES, f.size - TAIL_BYTES), Math.min(TAIL_BYTES, f.size - HEAD_BYTES)) : ''
      const s = parseSession(basename(f.file, '.jsonl'), head, tail, f.mtime)
      if (s) out.push(s)
    } catch { /* unreadable file: skip */ } finally {
      if (fd !== null) closeSync(fd)
    }
  }
  return out
}
