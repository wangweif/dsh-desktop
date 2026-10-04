import type { TEMPLATES } from './catalog.js'

export interface DocTemplateSessionState {
  sessionId: string
  selectedTemplateId: string | null
  updatedAt: string | null
}

export interface DocTemplateSessionCatalogState extends DocTemplateSessionState {
  templates: Array<{ id: string; kind: string; category: string; variant: string; name: { zh: string; en: string }; description: { zh: string; en: string } }>
}

export declare class DocTemplateStore {
  constructor(root: string)
  read(sessionId: string): Promise<DocTemplateSessionState>
  select(sessionId: string, templateId: string): Promise<DocTemplateSessionState>
  deselect(sessionId: string): Promise<DocTemplateSessionState>
  stateWithCatalog(sessionId: string): Promise<DocTemplateSessionCatalogState>
}

export declare const CATALOG_IDS: Array<(typeof TEMPLATES)[number]['id']>
