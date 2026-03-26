/// <reference types="vite/client" />

interface FetchedWebPage {
  finalUrl: string
  contentType: string
  html: string
}

interface ElectronAPI {
  minimize: () => void
  maximize: () => void
  close: () => void
  isMaximized: () => Promise<boolean>
  openExternal: (url: string) => Promise<boolean>
  fetchWebPage: (url: string) => Promise<FetchedWebPage>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
