/** agent_platform 智能体在进程间传递的序列化契约；不依赖 Electron。 */

export interface PlatformAgentSummary {
  /** 平台智能体 UUID */
  id: string
  name: string
  description: string
  /** 平台侧配置的模型名，仅展示；本地会话使用 harness 当前模型路由 */
  model: string | null
  recommendedQuestions: string[]
  /** 平台发布版本号；旧版平台未下发时为 null（更新检测退化为 updatedAt） */
  version: number | null
  updatedAt: string | null
}

export interface InstalledPlatformAgent {
  agentId: string
  /** preset 目录名，`nkyz-<平台 uuid>` */
  presetId: string
  name: string
  description: string
  version: number | null
  updatedAt: string | null
  installedAt: string
  serverUrl: string
}

export type EnterpriseAgentFailureCode =
  | 'unauthorized'
  | 'unreachable'
  | 'not-found'
  | 'invalid'
  | 'unknown'

export type AgentListResult =
  | { ok: true; agents: PlatformAgentSummary[] }
  | { ok: false; code: EnterpriseAgentFailureCode; message: string }

export type AgentInstallResult =
  | { ok: true; presetId: string; version: number | null }
  | { ok: false; code: EnterpriseAgentFailureCode; message: string }

export type AgentUninstallResult =
  | { ok: true }
  | { ok: false; message: string }
