import type { PlatformAuth } from './types.d.ts'

export interface HandoffSession {
  serverUrl: string
  sessionCookie: string
}

export declare function sessionHandoffPath(dshHome?: string): string | null
export declare function writeHandoffSession(session: HandoffSession | null, options?: { dshHome?: string }): Promise<void>
export declare function removeHandoffSession(options?: { dshHome?: string }): Promise<void>
export declare function readHandoffSession(options?: { dshHome?: string }): Promise<HandoffSession | null>
export declare function createScopedAuth(session: HandoffSession | null, options?: { fetchImpl?: typeof fetch; log?: (line: string) => void }): PlatformAuth
export declare function watchSessionHandoff(handler: (session: HandoffSession | null) => void, options?: { dshHome?: string; log?: (line: string) => void }): () => void
