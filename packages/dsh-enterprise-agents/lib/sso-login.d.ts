import type { spawn } from 'node:child_process'
import type * as http from 'node:http'

export declare const DEFAULT_SERVER_URL: string

export interface EnterpriseSsoLoginOptions {
  serverUrl?: string
  dshHome?: string
  fetchImpl?: typeof fetch
  spawnImpl?: typeof spawn
  httpImpl?: Pick<typeof http, 'createServer'>
  log?: (line: string) => void
}

export interface EnterpriseSsoLoginResult {
  serverUrl: string
  // The exchange response validates the cookie; user metadata remains external input.
  username: unknown
  nickname: unknown
}

export declare function openEnterpriseSsoLogin(options?: EnterpriseSsoLoginOptions): Promise<EnterpriseSsoLoginResult>
