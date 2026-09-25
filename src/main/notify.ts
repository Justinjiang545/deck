import { app, Notification } from 'electron'
import type { Terminal } from '../shared/state'
import { titleOf } from '../shared/state'

export function updateDockBadge(count: number): void {
  if (process.platform !== 'darwin' || !app.dock) return
  app.dock.setBadge(count > 0 ? String(count) : '')
}

/** Electron Notification for a terminal that just became needs-you and isn't the visible/focused pane. */
export function notifyAttention(t: Terminal, cc: NonNullable<Terminal['cc']>, opts: { sound: boolean; onClick: () => void }): void {
  if (!Notification.isSupported()) return
  const body = cc.attention === 'input' ? 'Waiting for input' : cc.lastMessage || 'Finished'
  const n = new Notification({ title: titleOf(t), body, silent: !opts.sound })
  n.on('click', opts.onClick)
  n.show()
}
