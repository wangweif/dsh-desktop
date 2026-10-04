import type {
  AgentInstallResult,
  AgentListResult,
  AgentUninstallResult,
  AgentUploadResult,
  InstalledPlatformAgent,
  LocalPresetListResult,
  PlatformAuth
} from './types.d.ts'

export interface EnterpriseAgentStoreOptions {
  /** harness 用户 preset 根目录（<dshHome>/.agent-presets） */
  presetRoot: string
  log?: (line: string) => void
}

export interface AgentSyncOutcome {
  /** 平台列表拉取失败（未登录/不可达）时为 false；单项安装失败不置 false */
  ok: boolean
  installed: number
  updated: number
  skipped: number
  failed: number
}

export declare class EnterpriseAgentStore {
  constructor(options: EnterpriseAgentStoreOptions)
  syncAgents(auth: PlatformAuth): Promise<AgentSyncOutcome>
  listPlatformAgents(auth: PlatformAuth): Promise<AgentListResult>
  installAgent(auth: PlatformAuth, agentId: string): Promise<AgentInstallResult>
  listInstalledAgents(): Promise<InstalledPlatformAgent[]>
  listLocalPresets(): Promise<LocalPresetListResult>
  uploadAgent(auth: PlatformAuth, presetId: string): Promise<AgentUploadResult>
  uninstallAgent(presetId: string): Promise<AgentUninstallResult>
}
