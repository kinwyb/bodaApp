// bodaWay 的桌面外壳:把已有的 web 前端装进系统自带的 WebView。
//
// 前端本身(根目录的 src/ 与构建产物 dist/)不含任何桌面 API 调用,
// 因此这里只负责开窗与加载页面:
//
//   - 开发时加载 mygo.config.ts 里的 devUrl(Vite dev server),热更新可用;
//   - 打包时加载内嵌的 frontendDist,以 mygo://localhost/ 提供,
//     无扩展名路径自动回退 index.html,SPA 路由无需额外配置。
//
// 也就是说,原先 Electron 版 main.ts 里手写的 node:http 静态服务器
// 已经不需要了,由 MyGo 的前端内嵌机制取代。
package main

import (
	"log"
	"runtime"

	"github.com/egoist/mygo"
)

func main() {
	// 与 Electron 版行为保持一致:macOS 关闭最后一个窗口后应用留在 Dock,
	// 其它平台直接退出。
	mygo.App.OnWindowAllClosed(func() {
		if runtime.GOOS != "darwin" {
			mygo.App.Quit()
		}
	})

	// macOS 点击 Dock 图标且没有可见窗口时,重新开一个。
	mygo.App.OnActivate(func(hasVisibleWindows bool) {
		if !hasVisibleWindows {
			openWindow()
		}
	})

	mygo.App.WhenReady(openWindow)

	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}

// openWindow 创建主窗口,尺寸沿用 Electron 版的 1280x800。
func openWindow() {
	mygo.NewWindow(mygo.WindowOptions{
		Title:           "bodaWay",
		Width:           1280,
		Height:          800,
		MinWidth:        1024,
		MinHeight:       640,
		BackgroundColor: "light-dark(#ffffff, #1e1e1e)",
		StateKey:        "main",
		// "/" 是不带 scheme 的页面地址:开发时指向 devUrl,
		// 打包后指向内嵌的 frontendDist。
		URL: "/",
	})
}
