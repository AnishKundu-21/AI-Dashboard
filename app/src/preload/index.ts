import { contextBridge, ipcRenderer } from 'electron'
import type { DashboardApi } from '../shared/ipc'
import {
  AlertsDismissInput,
  ExportInput,
  GetBurnInput,
  GetOverviewInput,
  GetSessionsInput,
  IPC,
  SettingsSetInput
} from '../shared/ipc'

const api: DashboardApi = {
  getOverview: (input) =>
    ipcRenderer.invoke(IPC.getOverview, GetOverviewInput.parse(input ?? {})),
  getQuotas: () => ipcRenderer.invoke(IPC.getQuotas),
  getDailyUsage: (input) =>
    ipcRenderer.invoke(IPC.getDailyUsage, GetOverviewInput.parse(input ?? {})),
  getBurn: (input) => ipcRenderer.invoke(IPC.getBurn, GetBurnInput.parse(input)),
  getModelMix: (input) =>
    ipcRenderer.invoke(IPC.getModelMix, GetOverviewInput.parse(input ?? {})),
  getSessions: (input) =>
    ipcRenderer.invoke(IPC.getSessions, GetSessionsInput.parse(input ?? {})),
  getProjections: () => ipcRenderer.invoke(IPC.getProjections),
  refreshQuotas: () => ipcRenderer.invoke(IPC.refreshQuotas),
  exportData: (input) =>
    ipcRenderer.invoke(IPC.exportData, ExportInput.parse(input)),
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  setSettings: (input) =>
    ipcRenderer.invoke(IPC.settingsSet, SettingsSetInput.parse(input ?? {})),
  listAlerts: () => ipcRenderer.invoke(IPC.alertsList),
  dismissAlert: (input) =>
    ipcRenderer.invoke(IPC.alertsDismiss, AlertsDismissInput.parse(input)),
  onChanged: (cb) => {
    const handler = (): void => cb()
    ipcRenderer.on(IPC.onChanged, handler)
    return () => {
      ipcRenderer.removeListener(IPC.onChanged, handler)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
