import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // 后端 API 地址，通过环境变量 VITE_API_TARGET 配置
  // 例如：VITE_API_TARGET=http://192.168.1.100:8080
  const apiTarget = env.VITE_API_TARGET || 'http://localhost:8080'

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      proxy: {
        // 当 VITE_USE_MOCK=false 时，将 /api 请求代理到后端服务
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          // 如果后端接口本身不以 /api 开头，取消下面注释以去掉 /api 前缀
          // rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
  }
})
