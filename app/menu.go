// 应用菜单：只加「设置服务器地址…」这一项，其余交给系统 role。
//
// 为什么不全手写：角色项（复制粘贴、窗口、退出）由系统提供标签、快捷键和本地化，
// 手拼一份会丢掉这些 —— 尤其是编辑菜单，用户会立刻发现粘贴失效。
package main

import (
	"runtime"

	"github.com/egoist/mygo"
)

// installMenu 装应用菜单。必须在 App.Run 之后调用（role 项要在就绪后才认得）。
func installMenu() {
	settingsItem := &mygo.MenuItem{
		Label: "设置服务器地址…",
		// macOS 的惯例位置是应用菜单的「偏好设置…」，快捷键 ⌘,
		Accelerator: "CmdOrCtrl+,",
		Click: func(*mygo.MenuItem, *mygo.Window) {
			openSettingsWindow()
		},
	}

	items := make([]*mygo.MenuItem, 0, 4)
	if runtime.GOOS == "darwin" {
		name := mygo.App.Name()
		if name == "" {
			name = "bodaWay"
		}
		items = append(items, &mygo.MenuItem{
			Label: name,
			Submenu: []*mygo.MenuItem{
				{Role: mygo.RoleAbout},
				mygo.Separator(),
				settingsItem,
				mygo.Separator(),
				{Role: mygo.RoleHide},
				{Role: mygo.RoleHideOthers},
				{Role: mygo.RoleUnhide},
				mygo.Separator(),
				{Role: mygo.RoleQuit},
			},
		})
	} else {
		// Windows / Linux 的惯例位置是「文件」菜单
		items = append(items, &mygo.MenuItem{
			Label: "文件",
			Submenu: []*mygo.MenuItem{
				settingsItem,
				mygo.Separator(),
				{Role: mygo.RoleQuit},
			},
		})
	}

	items = append(items,
		&mygo.MenuItem{Role: mygo.RoleEditMenu},
		&mygo.MenuItem{Role: mygo.RoleViewMenu},
		&mygo.MenuItem{Role: mygo.RoleWindowMenu},
	)

	mygo.App.SetMenu(mygo.NewMenu(items))
}
