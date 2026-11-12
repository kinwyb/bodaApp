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
//
// 另外两件只有桌面端才需要的事:
//   - 服务器地址改由应用内配置(见 settings.go):内嵌页面没有反代可依赖,
//     接口/ws/语音都得拿绝对地址,所以启动时把配置注入页面;
//   - 应用菜单里加「设置服务器地址…」(见 menu.go),入口不依赖页面能否加载。
package main

import (
	"log"
	"runtime"

	"github.com/egoist/mygo"
)

// mainWindow 是当前主窗口。设置窗口切换组织后要用它的 Page().Eval 通知页面。
// 关闭时置空；macOS 点 Dock 重开时再赋值。
var mainWindow *mygo.Window

func main() {
	// 启动时读一次配置作为注入页面的默认值。地址类修改仍是「重启后生效」;
	// 组织切换是例外 —— 它只改代理上游并即时通知页面,不必重启(见 settings_window.go)。
	appSettings = loadSettings().withDefaults()

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

	mygo.App.WhenReady(func() {
		installMenu()
		// 代理要先起来：页面注入的地址就是它的端口
		if err := startProxy(appSettings); err != nil {
			log.Printf("启动转发失败: %v", err)
		}
		openWindow()
	})

	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}

// openWindow 创建主窗口,尺寸沿用 Electron 版的 1280x800。
func openWindow() *mygo.Window {
	win := mygo.NewWindow(mygo.WindowOptions{
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
		// 把应用内配置的服务器地址在页面脚本之前注入 window.__BODA_SETTINGS__;
		// 没配就注入空脚本,前端照旧用构建期的默认值。
		Page: mygo.PageOptions{
			PreloadScript: appSettings.preloadScript(),
		},
	})
	mainWindow = win
	win.OnClosed(func() {
		if mainWindow == win {
			mainWindow = nil
		}
	})
	return win
}
