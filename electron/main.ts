import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'path'

let mainWindow: BrowserWindow | null = null

const APP_AMPERSAND_RE = /&(?:amp(?:;|%3[Bb])|#38;)/gi
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])
const READABLE_WEB_CONTENT_TYPES = ['text/html', 'application/xhtml+xml', 'text/plain']
const MAX_WEB_PAGE_CHARS = 500000
const WEB_FETCH_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) KatopGPT/1.0 Chrome/124.0.0.0 Safari/537.36'

function normalizeExternalUrl(rawUrl: string) {
  const trimmedUrl = rawUrl.trim()
  if (!trimmedUrl) return null

  const normalizedUrl = trimmedUrl.replace(APP_AMPERSAND_RE, '&')

  try {
    const url = new URL(normalizedUrl)
    if (!ALLOWED_EXTERNAL_PROTOCOLS.has(url.protocol)) {
      return null
    }
    return url.toString()
  } catch {
    return null
  }
}

function openExternalUrl(rawUrl: string) {
  const externalUrl = normalizeExternalUrl(rawUrl)
  if (!externalUrl) return false
  void shell.openExternal(externalUrl)
  return true
}

async function fetchWebPage(rawUrl: string) {
  const externalUrl = normalizeExternalUrl(rawUrl)
  if (!externalUrl) {
    throw new Error('无效网页链接')
  }

  const response = await fetch(externalUrl, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'User-Agent': WEB_FETCH_USER_AGENT,
    },
    redirect: 'follow',
  })

  if (!response.ok) {
    throw new Error(`网页请求失败 (${response.status})`)
  }

  const contentType = response.headers.get('content-type') ?? ''
  const isReadableContent = READABLE_WEB_CONTENT_TYPES.some((type) => contentType.includes(type))
  if (contentType && !isReadableContent) {
    throw new Error(`暂不支持读取该网页类型：${contentType}`)
  }

  const html = (await response.text()).slice(0, MAX_WEB_PAGE_CHARS)

  return {
    finalUrl: normalizeExternalUrl(response.url) ?? externalUrl,
    contentType,
    html,
  }
}

function isAppUrl(url: string) {
  if (url.startsWith('file://')) return true
  if (process.env.VITE_DEV_SERVER_URL && url.startsWith(process.env.VITE_DEV_SERVER_URL)) {
    return true
  }
  return false
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (openExternalUrl(url)) {
      return { action: 'deny' }
    }

    if (url.startsWith('data:') || url === 'about:blank') {
      return { action: 'allow' }
    }

    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return

    event.preventDefault()
    openExternalUrl(url)
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// Window controls
ipcMain.on('window:minimize', () => mainWindow?.minimize())
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow?.maximize()
  }
})
ipcMain.on('window:close', () => mainWindow?.close())
ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized())
ipcMain.handle('shell:openExternal', (_event, url: string) => openExternalUrl(url))
ipcMain.handle('web:fetchPage', (_event, url: string) => fetchWebPage(url))
