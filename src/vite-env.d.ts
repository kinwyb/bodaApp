interface ImportMetaEnv {
  /** RESTful 接口基础路径，默认 /api */
  readonly VITE_API_BASE_URL?: string;
  /** 是否启用本地 mock，设为 "false" 可关闭（仅开发环境生效） */
  readonly VITE_USE_MOCK?: string;
  /**
   * Agent 对话的 WebSocket 地址（如 ws://127.0.0.1:8765/ws，即 buibuiCodex 的默认 host/port/path）。
   * 不配置时 Agent 页面走本地演示实现（src/pages/agent/transport/mock.ts）。
   */
  readonly VITE_AGENT_WS_URL?: string;
  /**
   * WebSocket 鉴权 token（服务端 Authenticator 用它解析 userID / chatID）。
   * 浏览器无法设请求头，走 `?token=`。
   * 不配也行：默认用登录 token（localStorage 里的 boda_token），这里只用于本地固定凭证调试。
   */
  readonly VITE_AGENT_WS_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
