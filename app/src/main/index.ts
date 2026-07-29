import { app, BrowserWindow, dialog, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
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

const windowIcon = join(__dirname, '../../resources/icon.png')

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
    icon: windowIcon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const protocol = new URL(url).protocol
      if (protocol === 'https:') {
        void shell.openExternal(url)
      }
    } catch {
      // Ignore malformed or non-web URLs from the renderer.
    }
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const current = mainWindow?.webContents.getURL()
    if (current && url !== current) event.preventDefault()
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
  configureAutoUpdates()
  startRealtimeWatchers()
  startQuotaPolling()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

function configureAutoUpdates(): void {
  const feedUrl = process.env.AI_USAGE_UPDATE_URL
  if (!app.isPackaged || !feedUrl || !/^https:\/\//i.test(feedUrl)) return
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl })
  autoUpdater.on('update-available', async (info) => {
    const result = await dialogForUpdate(
      `Version ${info.version} is available. Download it now?`,
      ['Download', 'Later']
    )
    if (result === 0) void autoUpdater.downloadUpdate().catch(() => undefined)
  })
  autoUpdater.on('update-downloaded', async () => {
    const result = await dialogForUpdate(
      'The update is ready. Restart and install now?',
      ['Restart now', 'On exit']
    )
    if (result === 0) autoUpdater.quitAndInstall()
  })
  autoUpdater.on('error', () => {
    // Updates are optional; collector operation must never depend on the feed.
  })
  void autoUpdater.checkForUpdates().catch(() => undefined)
}

async function dialogForUpdate(message: string, buttons: string[]): Promise<number> {
  const options = { type: 'info' as const, title: 'AI Usage Dashboard update', message, buttons }
  const result = mainWindow
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options)
  return result.response
}

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
