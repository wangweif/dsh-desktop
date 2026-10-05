import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => void>(),
  openExternal: vi.fn(),
  updater: { setFeedURL: vi.fn(), checkForUpdates: vi.fn(), downloadUpdate: vi.fn(), quitAndInstall: vi.fn(), on: vi.fn(), autoDownload: false, allowDowngrade: false, allowPrerelease: false }
}))
vi.mock('electron-updater', () => ({ default: { autoUpdater: mocks.updater } }))
vi.mock('electron', () => ({ app: { isPackaged: true, getVersion: () => '0.8.0', getPath: () => '/nonexistent-desktop-test', isReady: () => true }, BrowserWindow: { getAllWindows: () => [] }, powerMonitor: { on: vi.fn(), removeListener: vi.fn() }, ipcMain: { handle: vi.fn() }, shell: { openExternal: mocks.openExternal } }))
vi.mock('../src/main/update/update-policy', async importOriginal => ({ ...await importOriginal<object>(), supportsAutoUpdates: () => true }))
let manager: typeof import('../src/main/update/update-manager')
let base = 'http://localhost:3002'
const realPlatform = process.platform
function setPlatform(value: string): void {
  Object.defineProperty(process, 'platform', { value, configurable: true })
}
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); mocks.handlers.clear(); base = 'http://localhost:3002'
  setPlatform(realPlatform)
  mocks.updater.on.mockImplementation((event, callback) => { mocks.handlers.set(event, callback) })
  mocks.updater.downloadUpdate.mockResolvedValue([])
  manager = await import('../src/main/update/update-manager')
  manager.configureUpdateBase(() => base)
  manager.startUpdateManager({ prepareToInstall: async () => {} })
})
afterEach(() => {
  manager.stopUpdateManager()
  setPlatform(realPlatform)
})
it('offers the stable feed version and only downloads on acceptance', async () => {
  setPlatform('win32')
  mocks.updater.checkForUpdates.mockImplementation(async () => { mocks.handlers.get('update-available')!({ version: '0.9.0' }); return { updateInfo: { version: '0.9.0' } } })
  await manager.checkForUpdates()
  expect(mocks.updater.setFeedURL).toHaveBeenCalledWith({ provider: 'generic', url: 'http://localhost:3002/api/desktop/updates/latest/' })
  expect(manager.getUpdateStatus().phase).toBe('available')
  expect(mocks.updater.downloadUpdate).not.toHaveBeenCalled()
  await manager.downloadAvailableUpdate(); expect(mocks.updater.downloadUpdate).toHaveBeenCalledTimes(1)
})
it('on darwin (unsigned builds) the download button opens the browser instead of Squirrel', async () => {
  setPlatform('darwin')
  mocks.updater.checkForUpdates.mockImplementation(async () => { mocks.handlers.get('update-available')!({ version: '0.9.0' }); return { updateInfo: { version: '0.9.0' } } })
  await manager.checkForUpdates()
  expect(manager.getUpdateStatus().phase).toBe('available')
  await manager.downloadAvailableUpdate()
  expect(mocks.openExternal).toHaveBeenCalledWith('http://localhost:3002/api/desktop/updates/archive/0.9.0/download')
  expect(mocks.updater.downloadUpdate).not.toHaveBeenCalled()
  expect(manager.getUpdateStatus().phase).toBe('idle')
})
it('follows the enterprise server base across checks without a restart', async () => {
  mocks.updater.checkForUpdates.mockImplementation(async () => { mocks.handlers.get('update-not-available')!(); return { updateInfo: { version: '0.8.0' } } })
  await manager.checkForUpdates()
  base = 'https://ai.touchit.com.cn/agent'
  await manager.checkForUpdates()
  const urls = mocks.updater.setFeedURL.mock.calls.map(call => call[0]?.url)
  expect(urls).toEqual([
    'http://localhost:3002/api/desktop/updates/latest/',
    'https://ai.touchit.com.cn/agent/api/desktop/updates/latest/'
  ])
})
it('reports up-to-date when the feed has nothing newer', async () => {
  mocks.updater.checkForUpdates.mockImplementation(async () => { mocks.handlers.get('update-not-available')!(); return { updateInfo: { version: '0.8.0' } } })
  await manager.checkForUpdates()
  expect(manager.getUpdateStatus().phase).toBe('up-to-date')
})
it('surfaces feed failures as an error status', async () => {
  mocks.updater.checkForUpdates.mockRejectedValue(new Error('feed offline'))
  await manager.checkForUpdates()
  expect(manager.getUpdateStatus().phase).toBe('error')
})
it('accepts whatever the stable feed offers without a pinned-version check', async () => {
  // 回归钉：普通 stable 检查没有第二决策来源，feed 返回什么就提示什么，不报不匹配错
  mocks.updater.checkForUpdates.mockImplementation(async () => { mocks.handlers.get('update-available')!({ version: '0.10.0' }); return { updateInfo: { version: '0.10.0' } } })
  await manager.checkForUpdates()
  expect(manager.getUpdateStatus().phase).toBe('available')
})
it('preserves explicitly selected history installs and validates version input', async () => {
  setPlatform('win32')
  mocks.updater.checkForUpdates.mockImplementation(async () => { mocks.handlers.get('update-available')!({ version: '0.7.0' }); return { updateInfo: { version: '0.7.0' } } })
  await manager.installSpecificVersion('../../unsafe')
  expect(mocks.updater.checkForUpdates).not.toHaveBeenCalled()
  await manager.installSpecificVersion('0.7.0')
  expect(mocks.updater.downloadUpdate).toHaveBeenCalledTimes(1)
  expect(mocks.updater.setFeedURL).toHaveBeenCalledWith({ provider: 'generic', url: 'http://localhost:3002/api/desktop/updates/archive/0.7.0/' })
  expect(mocks.updater.allowDowngrade).toBe(false)
  expect(mocks.updater.setFeedURL).toHaveBeenLastCalledWith({ provider: 'generic', url: 'http://localhost:3002/api/desktop/updates/latest/' })
})
it('blocks a pinned history install when the archive feed answers with a different version', async () => {
  mocks.updater.checkForUpdates.mockImplementation(async () => { mocks.handlers.get('update-available')!({ version: '0.10.0' }); return { updateInfo: { version: '0.10.0' } } })
  await manager.installSpecificVersion('0.7.0')
  expect(manager.getUpdateStatus().phase).toBe('error')
  expect(mocks.updater.downloadUpdate).not.toHaveBeenCalled()
})
