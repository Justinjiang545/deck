/** POSIX single-quote a path for pasting into a shell prompt. Safe chars are left bare. */
export function quotePath(p: string): string {
  if (p === '') return "''"
  if (/^[A-Za-z0-9_\-./~:@%+=]+$/.test(p)) return p
  return "'" + p.replace(/'/g, "'\\''") + "'"
}

/** Space-separated quoted paths with a trailing space, ready to type after a command. */
export function quotePaths(paths: string[]): string {
  return paths.map(quotePath).join(' ') + ' '
}
