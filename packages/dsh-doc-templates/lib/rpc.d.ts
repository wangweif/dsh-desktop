import type { DocTemplateStore } from './store.js'

export interface RpcEnvelopeOk<T = unknown> {
  ok: true
  value: { status: 'ok'; data: T }
}

export interface RpcEnvelopeError {
  ok: true
  value: { status: 'error'; error: { code: string; message: string } }
}

export interface RpcTransportError {
  ok: false
  error: { code: string; message: string }
}

export type RpcResult = RpcEnvelopeOk | RpcEnvelopeError | RpcTransportError

export declare function createRpcHandler(options: {
  store: DocTemplateStore
  log?: (line: string) => void
}): (endpoint: string, payload?: Record<string, unknown>) => Promise<RpcResult>
