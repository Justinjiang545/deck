import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('deck', { version: '0.1.0' })
