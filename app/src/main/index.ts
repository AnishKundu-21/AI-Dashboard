import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'fs'
import { openDatabase, closeDatabase, getDb } from './db'
import { registerIpcHandlers } from './ipc/handlers'
import {
  initCollectors,
  startRealtimeWatchers,
  startQuotaPolling,
  stopRealtimeWatchers,
  stopQuotaPolling
} from './collectors/service'
import { getAppDataDir, getLogsDir } from './util/paths'
import { applyRetention } from './db/retention'

// Single instance — avoid two collectors fighting later
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'AI Usage Dashboard',
    backgroundColor: '#08090b',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const protocol = new URL(url).protocol
      if (protocol === 'https:' || protocol === 'http:') {
        void shell.openExternal(url)
      }
    } catch {
      // Ignore malformed or non-web URLs from the renderer.
    }
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  mkdirSync(getAppDataDir(), { recursive: true })
  mkdirSync(getLogsDir(), { recursive: true })

  openDatabase()
  applyRetention(getDb())
  initCollectors()
  registerIpcHandlers()
  createWindow()
  startRealtimeWatchers()
  startQuotaPolling()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopQuotaPolling()
    stopRealtimeWatchers()
    closeDatabase()
    app.quit()
  }
})

app.on('before-quit', () => {
  stopQuotaPolling()
  stopRealtimeWatchers()
  closeDatabase()
})
