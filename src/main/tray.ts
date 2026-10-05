import { app, Menu, nativeImage, Tray } from 'electron'
import { join } from 'node:path'
import { sortedTerminals, titleOf, type AppState } from '../shared/state'

/** resources/brand in dev; <app>/Contents/Resources/brand when packaged (electron-builder extraResources). */
export function brandDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'brand') : join(app.getAppPath(), 'resources', 'brand')
}

export interface TrayHandle {
  update(state: AppState): void
  destroy(): void
}

/**
 * Menu-bar icon: the deck mark as a template image (macOS tints it for light/dark menu bars),
 * with the count of Claude sessions waiting on you beside it. The menu lists those sessions
 * so you can jump straight to one from anywhere.
 */
export function createTray(opts: { show: () => void; showTerminal: (id: string) => void }): TrayHandle {
  // "…Template.png" + its @2x sibling are picked up automatically and marked as a template.
  const image = nativeImage.createFromPath(join(brandDir(), 'trayTemplate.png'))
  image.setTemplateImage(true)
  const tray = new Tray(image)
  tray.setToolTip('deck')
  let lastKey = ''

  function update(state: AppState): void {
    const waiting = sortedTerminals(state).filter((t) => t.cc?.unseen)
    const key = waiting.map((t) => t.id + ':' + titleOf(t) + ':' + t.cc?.attention).join('|')
    if (key === lastKey) return
    lastKey = key
    tray.setTitle(waiting.length > 0 ? String(waiting.length) : '', { fontType: 'monospacedDigit' })
    const template: Electron.MenuItemConstructorOptions[] = [
      ...(waiting.length > 0
        ? [
            { label: waiting.length === 1 ? '1 session needs you' : `${waiting.length} sessions need you`, enabled: false },
            ...waiting.map((t) => ({
              label: `${t.cc?.attention === 'input' ? '?' : '✓'}  ${titleOf(t)}`,
              click: () => { opts.show(); opts.showTerminal(t.id) }
            })),
            { type: 'separator' as const }
          ]
        : [{ label: 'No sessions waiting', enabled: false }, { type: 'separator' as const }]),
      { label: 'Show deck', click: opts.show },
      { type: 'separator' },
      { label: 'Quit deck', role: 'quit' }
    ]
    tray.setContextMenu(Menu.buildFromTemplate(template))
  }

  return { update, destroy: () => tray.destroy() }
}
