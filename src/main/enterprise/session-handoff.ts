import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import type { EnterpriseAuthSnapshot } from './auth'

/**
 * 会话交接文件：harness 插件 dsh-enterprise-agents 的平台会话来源。
 * 路径约定 <dshHome>/enterprise/agent-platform-session.json（0600 原子写）；
 * 明文 cookie + 0600 是有意取舍（自造落盘密钥的加密只是伪装安全，
 * 仓库内 dsh-credentials-local 对磁盘凭证同姿态）。登出/换服务器即删。
 */

export function enterpriseSessionHandoffPath(dshHome: string): string {
  // 约定恒用 '/'（插件按同一约定拼接）；Windows 上 join 会出反斜杠
  return join(dshHome, 'enterprise', 'agent-platform-session.json').split(sep).join('/')
}

export async function writeEnterpriseSessionHandoff(
  dshHome: string,
  snapshot: EnterpriseAuthSnapshot | null
): Promise<void> {
  const path = enterpriseSessionHandoffPath(dshHome)
  if (snapshot === null || snapshot.sessionCookie === undefined) {
    await rm(path, { force: true }).catch(() => undefined)
    return
  }
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp`
  await writeFile(
    temporary,
    `${JSON.stringify({ serverUrl: snapshot.serverUrl, sessionCookie: snapshot.sessionCookie }, null, 2)}\n`,
    { mode: 0o600 }
  )
  try {
    await rename(temporary, path)
  } catch {
    // Windows 上 rename 不能覆盖既有文件：删目标后重试，代价是该窗口内非原子
    await rm(path, { force: true }).catch(() => undefined)
    await rename(temporary, path)
  }
}
