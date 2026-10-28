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
  /**
   * Agent 文件端点的基础地址（上传 / 下载 / 列表）。
   *
   * 不配时由 `VITE_AGENT_WS_URL` 推导：`ws://host:8765/ws` → `http://host:8765/ws/files`。
   * 开发环境建议配成 `/ws/files` 走 dev server 代理（同源，绕开 CORS 与预检），
   * 生产环境留空即用推导出的绝对地址（需要后端放行跨域）。
   */
  readonly VITE_AGENT_FILES_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
