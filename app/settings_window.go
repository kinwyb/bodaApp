// 「设置服务器地址」窗口：用 MyGo 的原生 UI 画，不是网页。
//
// 为什么不用网页：这个窗口要在「地址配错、页面连不上后端」时照样能打开。
// 做成网页就得先加载前端、先拿到地址，正好卡在它要解决的问题上。
// 原生 UI 不依赖 webview，也不需要前端构建，是唯一自洽的选择。
package main

import (
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
)

var (
	// settingsWindow 保证同一时刻只有一个设置窗口；关掉后置空，下次重新读配置。
	settingsWindow *mygo.Window
	// appSettings 是本次进程启动时读到的配置，主窗口注入它。
	// 保存只写文件，不回头改它 —— 所以「必须重启才生效」是真实语义，不是提示话术。
	appSettings Settings
)

// noticeTone 区分提示的语气：清空是「说明」，写盘失败是「错误」，不能都标红。
type noticeTone int

const (
	toneInfo noticeTone = iota
	toneOK
	toneError
)

// settingsState 是这个窗口的状态：三个输入框的值 + 校验/保存结果。
type settingsState struct {
	apiBaseURL string
	agentWSURL string
	asrURL     string

	problems map[string]string
	notice   string
	tone     noticeTone
}

// openSettingsWindow 打开设置窗口（已开着就提到前台）。
func openSettingsWindow() {
	if settingsWindow != nil && !settingsWindow.IsDestroyed() {
		settingsWindow.Focus()
		return
	}

	// 显示当前实际生效的地址（空项已填成默认），而不是一片空输入框
	current := loadSettings().withDefaults()
	state := &settingsState{
		apiBaseURL: current.APIBaseURL,
		agentWSURL: current.AgentWSURL,
		asrURL:     current.ASRURL,
	}

	win := mygo.NewWindow(mygo.WindowOptions{
		Title: "设置服务器地址",
		Width: 600,
		// 384 = 顶部 12 拖动区 + 内容区（内容实际需要约 360，底部留 12 的内边距）
		Height: 384,
		// 无边框：这是个固定尺寸的设置窗，不需要缩放/缩放按钮，关闭也走底部那个。
		// 系统标题栏去掉后由 view 自己画一条可拖动的标题区（见下）。
		Frameless: true,
		// 刻意不给 StateKey：固定尺寸的窗口没有「记住位置」的需求，而它恢复的是整份
		// 窗口状态（含 maximized / fullscreen）。一旦那里留下过 maximized，
		// 下次打开就会铺满整个屏幕 —— 这个坑已经踩过一次。
		Content: ui.View(state.view),
	})
	// 无边框窗口默认仍能从边缘拉伸，显式关掉才是真正的固定尺寸
	win.SetResizable(false)
	win.OnClosed(func() { settingsWindow = nil })
	settingsWindow = win
	win.Focus()
}

// closeSettingsWindow 关掉设置窗口（没开就什么都不做）。
func closeSettingsWindow() {
	if settingsWindow != nil && !settingsWindow.IsDestroyed() {
		settingsWindow.Close()
	}
}

// view 每帧按当前状态重画整个窗口；按钮的点击结果在构建时读取。
func (s *settingsState) view(c *ui.Context) {
	ui.Column(c).Fill().Children(func() {
		// 无边框窗口没有系统标题栏，顶部留一条空的拖动区（不放文字 —— 内容里的大标题
		// 已经说清这是什么了）。只留 12，够抓住拖窗口就行。
		ui.Box(c).FillWidth().Height(12).DragWindow()

		// 底部内边距比上面小：路径那行是收尾，不需要再多留一截空白
		ui.Column(c).Fill().Padding(16, 24, 12, 24).Gap(16).Children(func() {
			ui.Text(c, "服务器地址").FontSize(18).Bold()
			// 两行说明属同一段，用小间距包起来；直接用外层 Gap(16) 会被拆成两段
			ui.Column(c).Gap(4).Children(func() {
				ui.Text(c, "桌面版把前端打包在应用内，没有服务器反代可依赖，所以接口、").FontSize(12).TextColor(ui.Hex("#8c8c8c"))
				ui.Text(c, "Agent 服务、语音识别都要写绝对地址。留空则使用应用内置的默认值。").FontSize(12).TextColor(ui.Hex("#8c8c8c"))
			})

			s.addressField(c, fieldAPIBaseURL, "后端接口地址", &s.apiBaseURL,
				"http://192.168.9.9:82/v1/boda")
			s.addressField(c, fieldAgentWSURL, "Agent 服务地址", &s.agentWSURL,
				"ws://192.168.9.16:8767/ws")
			s.addressField(c, fieldASRURL, "语音识别地址", &s.asrURL,
				"http://192.168.9.16:9383")

			// 字段级错误已经逐条标红，这里只在没有字段错误时补一句整体状态
			// （保存成功、写盘失败这类），避免同一个意思说两遍。
			if len(s.problems) == 0 && s.notice != "" {
				ui.Text(c, s.notice).FontSize(12).TextColor(s.toneColor())
			}

			// 撑满宽度后把按钮推到右侧（macOS 的确认/关闭区惯例在右下）
			ui.Row(c).FillWidth().Gap(8).Justify(ui.End).Children(func() {
				if ui.PrimaryButton(c, "保存").Clicked() {
					s.save()
				}
				if ui.Button(c, "清空").Clicked() {
					s.clear()
				}
				if s.tone == toneOK {
					if ui.Button(c, "立即重启").Clicked() {
						mygo.App.Relaunch()
					}
				}
				if ui.Button(c, "关闭").Clicked() {
					closeSettingsWindow()
				}
			})

			if path, err := settingsFilePath(); err == nil {
				ui.Text(c, "配置文件："+path).FontSize(11).TextColor(ui.Hex("#8c8c8c"))
			}
		})
	})
}

// addressField 画「标签 + 输入框」。校验失败时把原因接在标签后面并标红 ——
// 不另起一行，窗口高度才是恒定的（底下还有按钮和路径，撑出去就看不见了）。
func (s *settingsState) addressField(c *ui.Context, field, label string, value *string, placeholder string) {
	ui.Column(c).Gap(6).Children(func() {
		if reason := s.problems[field]; reason != "" {
			ui.Text(c, label+" · "+reason).FontSize(13).TextColor(ui.Hex("#cf1322"))
		} else {
			ui.Text(c, label).FontSize(13)
		}
		ui.TextInput(c, value).Placeholder(placeholder).FillWidth()
	})
}

// toneColor 提示文字的颜色：成功绿、错误红、说明灰。
func (s *settingsState) toneColor() ui.Color {
	switch s.tone {
	case toneOK:
		return ui.Hex("#389e0d")
	case toneError:
		return ui.Hex("#cf1322")
	default:
		return ui.Hex("#8c8c8c")
	}
}

// save 校验并写盘。写成功后只提示，不关窗 —— 用户可能还要看一眼路径或直接重启。
func (s *settingsState) save() {
	next := Settings{
		APIBaseURL: s.apiBaseURL,
		AgentWSURL: s.agentWSURL,
		ASRURL:     s.asrURL,
	}.normalized()

	if problems := next.validate(); len(problems) > 0 {
		s.problems = problems
		s.notice = ""
		return
	}

	if err := saveSettings(next); err != nil {
		s.problems = nil
		s.notice = err.Error()
		s.tone = toneError
		return
	}

	// 把规范化后的值写回输入框，避免用户看到的是带尾斜杠的旧样子
	s.apiBaseURL = next.APIBaseURL
	s.agentWSURL = next.AgentWSURL
	s.asrURL = next.ASRURL
	s.problems = nil
	s.notice = "已保存。重启应用后生效。"
	s.tone = toneOK
}

// clear 只清空输入框，不写盘 —— 要让「清空」真正生效仍要点保存，
// 免得误点一下就把正在用的地址删了。
func (s *settingsState) clear() {
	s.apiBaseURL = ""
	s.agentWSURL = ""
	s.asrURL = ""
	s.problems = nil
	s.notice = "已清空输入框，点「保存」后恢复为内置默认地址"
	s.tone = toneInfo
}
