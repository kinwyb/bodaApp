interface ImportMetaEnv {
  /** RESTful 接口基础路径，默认 /api */
  readonly VITE_API_BASE_URL?: string;
  /** 是否启用本地 mock，设为 "false" 可关闭（仅开发环境生效） */
  readonly VITE_USE_MOCK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
