import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // 后端 API 地址，通过环境变量 VITE_API_TARGET 配置
  // 例如：VITE_API_TARGET=http://192.168.1.100:8080
  const apiTarget = env.VITE_API_TARGET || 'http://localhost:8080'

  /*
   * Agent 文件端点（上传/下载）的目标地址。
   *
   * 文件服务与 ws 服务同源（{ws 路径}/files），所以从 VITE_AGENT_WS_URL 推：
   * ws://127.0.0.1:8765/ws → http://127.0.0.1:8765。
   * 有了这条代理，前端可以配 VITE_AGENT_FILES_URL=/ws/files 用同源请求 ——
   * 否则带 Authorization 头的上传会先撞 OPTIONS 预检，而后端没有处理 CORS。
   */
  const agentWsUrl = env.VITE_AGENT_WS_URL || ''
  const agentTarget = (() => {
    if (!agentWsUrl) return 'http://127.0.0.1:8765'
    try {
      const url = new URL(agentWsUrl)
      url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
      return url.origin
    } catch {
      // 相对地址（如 /ws）说明本来就同源，交给兜底目标
      return 'http://127.0.0.1:8765'
    }
  })()

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      proxy: {
        // 当 VITE_USE_MOCK=false 时，将 /v1/boda 请求代理到后端服务。
        // 代理前缀要与 VITE_API_BASE_URL 保持一致（后端接口统一带 /v1/boda 前缀）。
        '/v1/boda': {
          target: apiTarget,
          changeOrigin: true,
        },
        // Agent 附件上传/下载：前缀与 VITE_AGENT_FILES_URL 一致
        '/ws/files': {
          target: agentTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
