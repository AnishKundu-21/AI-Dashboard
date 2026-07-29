import type { DashboardApi } from '../shared/ipc'

declare global {
  interface Window {
    api: DashboardApi
  }
}

export {}
