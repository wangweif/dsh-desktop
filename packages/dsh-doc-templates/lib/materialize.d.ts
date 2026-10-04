export interface MaterializeOptions {
  root: string
  packageAssets: string
  log?: (line: string) => void
}

/** 物化并返回技能目录绝对路径（<root>/skills/doc-templates）。 */
export declare function materializeAssets(options: MaterializeOptions): Promise<string>
