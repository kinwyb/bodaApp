import { fileURLToPath, URL } from 'node:url'
import { basename } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { syncMenuDescriptions } from './scripts/sync-menu-descriptions.mjs'

/** bridged.ts 是菜单描述的唯一来源；开发中增删改它也立即同步 description.md */
function menuDescriptionsPlugin() {
  let root = process.cwd()
  const sync = (logger?: { info(message: string): void; error(message: string): void }) => {
    try {
      const result = syncMenuDescriptions({ root })
      if (result.written || result.removed) {
        logger?.info(
          `[menu-descriptions] written=${result.written} removed=${result.removed}`,
        )
      }
    } catch (error) {
      logger?.error(
        `[menu-descriptions] ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  return {
    name: 'boda-menu-descriptions',
    configResolved(config: { root: string }) {
      root = config.root
      sync()
    },
    configureServer(server: {
      watcher: { on(event: 'add' | 'change' | 'unlink', listener: (file: string) => void): void }
      config: { logger: { info(message: string): void; error(message: string): void } }
    }) {
      const onChange = (file: string) => {
        if (basename(file) === 'bridged.ts') sync(server.config.logger)
      }
      server.watcher.on('add', onChange)
      server.watcher.on('change', onChange)
      server.watcher.on('unlink', onChange)
    },
  }
}

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

  /*
   * 语音识别服务（仓库 asr/ 目录里那个 Docker，SenseVoice）。
   * 同样走代理：前端用同源的 /asr，就不必让识别服务处理 CORS 预检。
   */
  const asrTarget = env.VITE_ASR_TARGET || 'http://127.0.0.1:9383'

  /*
   * file-viewer 独立预览服务（官方零依赖 iframe 静态站）。
   * npm run file-viewer:setup 安装、npm run file-viewer:serve 起在 8090；
   * 这里代理成同源 /file-viewer，iframe 与主页面同源，postMessage 不受跨域限制。
   */
  const fileViewerTarget = env.VITE_FILE_VIEWER_TARGET || 'http://127.0.0.1:8090'

  return {
    plugins: [react(), menuDescriptionsPlugin()],
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
        // Agent 工作区目录浏览（只读）：与附件同一个后端
        '/ws/agents': {
          target: agentTarget,
          changeOrigin: true,
        },
        // file-viewer 预览服务：站点挂在根路径，这里剥掉 /file-viewer 前缀
        '/file-viewer': {
          target: fileViewerTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/file-viewer/, ''),
        },
        // 语音识别：前端 POST /asr，转发到本地 ASR 容器
        '/asr': {
          target: asrTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
