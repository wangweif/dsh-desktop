export interface TemplateField {
  key: string
  form: 'inline' | 'list' | 'matrix' | 'formula'
}

export interface TemplateEntry {
  id: string
  kind: 'word' | 'excel'
  category: 'report' | 'sheet'
  file: string
  variant: string
  name: { zh: string; en: string }
  description: { zh: string; en: string }
  fields: TemplateField[]
}

export declare const TEMPLATES: TemplateEntry[]
export declare function templateById(id: string): TemplateEntry | undefined
export declare function catalogSummary(): { templates: Array<Omit<TemplateEntry, 'file' | 'fields'>> }
