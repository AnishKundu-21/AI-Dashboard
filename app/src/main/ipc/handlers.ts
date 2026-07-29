import { BrowserWindow, dialog, ipcMain } from 'electron'
import { writeFileSync } from 'fs'
import {
  AlertsDismissInput,
  ExportInput,
  GetBurnInput,
  GetOverviewInput,
  GetSessionsInput,
  IPC,
  SettingsSetInput
} from '../../shared/ipc'
import { getDb } from '../db'
import {
  dismissAlert,
  exportAsCsv,
  exportAsJson,
  getBurn,
  getDailyUsage,
  getLatestQuotas,
  getModelMix,
  getOverview,
  getProjections,
  getSessions,
  getSettings,
  listAlerts,
  setSettings
} from '../db/queries'
import { refreshEverything } from '../collectors/service'
import { applyRetention } from '../db/retention'

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC.getOverview, (_e, raw) => {
    const input = GetOverviewInput.parse(raw ?? {})
    return getOverview(getDb(), input.provider, input.range_days)
  })

  ipcMain.handle(IPC.getQuotas, () => getLatestQuotas(getDb()))

  ipcMain.handle(IPC.getDailyUsage, (_e, raw) => {
    const input = GetOverviewInput.parse(raw ?? {})
    return getDailyUsage(getDb(), input.provider, input.range_days)
  })

  ipcMain.handle(IPC.getBurn, (_e, raw) => {
    const input = GetBurnInput.parse(raw)
    return getBurn(getDb(), input.provider, input.range_days)
  })

  ipcMain.handle(IPC.getModelMix, (_e, raw) => {
    const input = GetOverviewInput.parse(raw ?? {})
    return getModelMix(getDb(), input.provider, input.range_days)
  })

  ipcMain.handle(IPC.getSessions, (_e, raw) => {
    const input = GetSessionsInput.parse(raw ?? {})
    return getSessions(getDb(), input.provider, input.range_days, input.search)
  })

  ipcMain.handle(IPC.getProjections, () => getProjections(getDb()))

  ipcMain.handle(IPC.refreshQuotas, async () => {
    return refreshEverything()
  })

  ipcMain.handle(IPC.exportData, async (e, raw) => {
    const input = ExportInput.parse(raw)
    const content =
      input.format === 'csv'
        ? exportAsCsv(getDb(), input.filter.provider, input.filter.range_days)
        : exportAsJson(getDb(), input.filter.provider, input.filter.range_days)

    const win = BrowserWindow.fromWebContents(e.sender)
    const rangeLabel =
      input.filter.range_days === 0 ? 'lifetime' : `${input.filter.range_days}d`
    const defaultName = `ai-usage-${input.filter.provider}-${rangeLabel}.${input.format}`
    const dialogOpts = {
      title: 'Export usage data',
      defaultPath: defaultName,
      filters:
        input.format === 'csv'
          ? [{ name: 'CSV', extensions: ['csv'] }]
          : [{ name: 'JSON', extensions: ['json'] }]
    }
    const result = win
      ? await dialog.showSaveDialog(win, dialogOpts)
      : await dialog.showSaveDialog(dialogOpts)

    if (result.canceled || !result.filePath) {
      return { ok: true as const, content, cancelled: true }
    }

    writeFileSync(result.filePath, content, 'utf-8')
    return { ok: true as const, content, path: result.filePath }
  })

  ipcMain.handle(IPC.settingsGet, () => getSettings(getDb()))

  ipcMain.handle(IPC.settingsSet, (_e, raw) => {
    const input = SettingsSetInput.parse(raw ?? {})
    const next = setSettings(getDb(), input)
    applyRetention(getDb(), next.retention_days)
    broadcastChanged()
    return next
  })

  ipcMain.handle(IPC.alertsList, () => listAlerts(getDb()))

  ipcMain.handle(IPC.alertsDismiss, (_e, raw) => {
    const input = AlertsDismissInput.parse(raw)
    dismissAlert(getDb(), input.id)
    broadcastChanged()
  })
}

function broadcastChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.onChanged)
  }
}
