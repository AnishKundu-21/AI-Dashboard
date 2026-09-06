import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { writeFileSync } from 'fs'
import {
  AlertsDismissInput,
  ExportInput,
  GetAnalyticsSnapshotInput,
  GetBurnInput,
  GetBurnSeriesInput,
  GetDailyUsageInput,
  GetModelUsageInput,
  GetOverviewInput,
  GetSessionsInput,
  IPC,
  RescanProviderInput,
  SettingsSetInput
} from '../../shared/ipc'
import { getDb } from '../db'
import {
  dismissAlert,
  exportAsCsv,
  exportAsJson,
  getBurn,
  getBurnSeries,
  getAnalyticsSnapshot,
  getCollectorHealth,
  getDailyUsage,
  getModelUsage,
  getLatestQuotas,
  getModelMix,
  getOverview,
  getProjections,
  getSessions,
  getSettings,
  listAlerts,
  setSettings
} from '../db/queries'
import {
  collectProviderSessions,
  refreshEverything,
  startRealtimeWatchers
} from '../collectors/service'
import {
  rebuildAllDays,
  refreshSessionRollups,
  repriceEvents
} from '../db/events'
import { setPriceOverrides } from '../pricing/store'
import { applyRetention } from '../db/retention'

export function registerIpcHandlers(): void {
  secureHandle(IPC.getOverview, (_e, raw) => {
    const input = GetOverviewInput.parse(raw ?? {})
    return getOverview(getDb(), input.provider, input)
  })

  secureHandle(IPC.getQuotas, () => getLatestQuotas(getDb()))

  secureHandle(IPC.getDailyUsage, (_e, raw) => {
    const input = GetDailyUsageInput.parse(raw ?? {})
    return getDailyUsage(getDb(), input.provider, input, input.resolution)
  })

  secureHandle(IPC.getBurn, (_e, raw) => {
    const input = GetBurnInput.parse(raw)
    return getBurn(getDb(), input.provider, input.range_days)
  })

  secureHandle(IPC.getModelUsage, (_e, raw) => {
    const input = GetModelUsageInput.parse(raw ?? {})
    return getModelUsage(getDb(), input.provider, input, input.resolution)
  })

  secureHandle(IPC.getAnalyticsSnapshot, (_e, raw) => {
    const input = GetAnalyticsSnapshotInput.parse(raw ?? {})
    return getAnalyticsSnapshot(getDb(), input)
  })

  secureHandle(IPC.getBurnSeries, (_e, raw) => {
    const input = GetBurnSeriesInput.parse(raw ?? {})
    return getBurnSeries(getDb(), input.provider, input.range_days)
  })

  secureHandle(IPC.getModelMix, (_e, raw) => {
    const input = GetOverviewInput.parse(raw ?? {})
    return getModelMix(getDb(), input.provider, input)
  })

  secureHandle(IPC.getSessions, (_e, raw) => {
    const input = GetSessionsInput.parse(raw ?? {})
    return getSessions(getDb(), input.provider, input, input.search, {
      model: input.model,
      day: input.day,
      sortBy: input.sort_by,
      sortDir: input.sort_dir,
      limit: input.limit,
      offset: input.offset
    })
  })

  secureHandle(IPC.getCollectorHealth, () => getCollectorHealth(getDb()))

  secureHandle(IPC.rescanProvider, (_e, raw) => {
    const input = RescanProviderInput.parse(raw)
    return collectProviderSessions(input.provider)
  })

  secureHandle(IPC.getProjections, () => getProjections(getDb()))

  secureHandle(IPC.refreshQuotas, async () => {
    return refreshEverything()
  })

  secureHandle(IPC.exportData, async (e, raw) => {
    const input = ExportInput.parse(raw)
    const content =
      input.format === 'csv'
        ? exportAsCsv(getDb(), input.filter.provider, input.filter)
        : exportAsJson(getDb(), input.filter.provider, input.filter)

    const win = BrowserWindow.fromWebContents(e.sender)
    const rangeLabel = input.filter.start_day && input.filter.end_day
      ? `${input.filter.start_day}-to-${input.filter.end_day}`
      : input.filter.range_days === 0 ? 'lifetime' : `${input.filter.range_days}d`
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

  secureHandle(IPC.settingsGet, () => getSettings(getDb()))

  secureHandle(IPC.settingsSet, (_e, raw) => {
    const input = SettingsSetInput.parse(raw ?? {})
    const db = getDb()
    const previous = getSettings(db)
    const next = setSettings(db, input)

    // Stored costs are a cache of the rate table, and stored day buckets a
    // cache of the display timezone. Both have to be rebuilt when the input
    // they were derived from changes, or the dashboard keeps showing figures
    // computed under the old setting.
    if (input.price_overrides !== undefined) {
      setPriceOverrides(next.price_overrides)
      repriceEvents(db)
      refreshSessionRollups(db)
      rebuildAllDays(db, next.timezone)
    } else if (next.timezone !== previous.timezone) {
      rebuildAllDays(db, next.timezone)
    }

    applyRetention(db, next.retention_days)
    if (input.enabled_providers !== undefined) {
      startRealtimeWatchers()
      // Enabling a provider should populate it immediately; disabling one is
      // also respected by this refresh, so no further requests reach it.
      void refreshEverything()
    }
    broadcastChanged()
    return next
  })

  secureHandle(IPC.alertsList, () => listAlerts(getDb()))

  secureHandle(IPC.alertsDismiss, (_e, raw) => {
    const input = AlertsDismissInput.parse(raw)
    dismissAlert(getDb(), input.id)
    broadcastChanged()
  })
}

function secureHandle(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
): void {
  ipcMain.handle(channel, (event, ...args) => {
    const url = event.senderFrame?.url ?? event.sender.getURL()
    const devUrl = process.env.ELECTRON_RENDERER_URL
    let trusted = false
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'file:') {
        trusted = parsed.pathname.replace(/\\/g, '/').endsWith('/out/renderer/index.html')
      } else if (devUrl) {
        trusted = parsed.origin === new URL(devUrl).origin
      }
    } catch {
      trusted = false
    }
    if (!trusted) throw new Error('Rejected IPC request from an untrusted renderer')
    return listener(event, ...args)
  })
}

function broadcastChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.onChanged)
  }
}
