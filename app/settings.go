// 可在应用内修改的服务器地址。
//
// 为什么桌面端需要这份配置：打包后前端被内嵌进可执行文件、以 mygo://localhost/
// 提供，页面没有「同源的反向代理」可用，所以接口、Agent ws、语音识别三处都必须拿到
// 绝对地址才能发请求。浏览器里访问同一份前端时走服务器反代，用相对路径即可 ——
// 那边的默认值仍在 .env 里，与这里互不影响。
//
// 三项都允许留空：留空表示「用构建期注入的默认值」（.env.production 那一套）。
// 因此这里刻意不写死任何地址 —— 写死就会和 .env 里那份分叉，改一处忘一处。
package main

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/egoist/mygo"
)

// Settings 是持久化在用户数据目录里的一份地址配置。
type Settings struct {
	// APIBaseURL 后端接口前缀，需带 /v1/boda（如 http://192.168.9.9:82/v1/boda）。
	APIBaseURL string `json:"apiBaseUrl"`
	// AgentWSURL Agent 对话的 ws 地址（如 ws://192.168.9.16:8767/ws）。
	AgentWSURL string `json:"agentWsUrl"`
	// ASRURL 语音识别服务的根地址，前端自己补 /asr（如 http://192.168.9.16:9383）。
	ASRURL string `json:"asrUrl"`
}

const settingsFileName = "settings.json"

// 字段名与 json tag 一致，便于把校验结果按字段交给界面显示。
const (
	fieldAPIBaseURL = "apiBaseUrl"
	fieldAgentWSURL = "agentWsUrl"
	fieldASRURL     = "asrUrl"
)

// settingsFilePath 返回配置文件路径（用户数据目录，而不是安装目录）。
func settingsFilePath() (string, error) {
	dir, err := mygo.App.Path(mygo.PathUserData)
	if err != nil {
		return "", fmt.Errorf("拿不到用户数据目录：%w", err)
	}
	return filepath.Join(dir, settingsFileName), nil
}

// loadSettings 读取配置。
//
// 文件不存在、读不动或者 JSON 坏了，一律返回空配置：配置文件不该让应用起不来，
// 退回构建期默认值继续跑，用户还能从菜单重新填一遍。
func loadSettings() Settings {
	path, err := settingsFilePath()
	if err != nil {
		return Settings{}
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return Settings{}
	}
	var s Settings
	if err := json.Unmarshal(data, &s); err != nil {
		return Settings{}
	}
	return s.normalized()
}

// saveSettings 原子感地把配置写回磁盘。
func saveSettings(s Settings) error {
	path, err := settingsFilePath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("创建配置目录失败：%w", err)
	}
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return fmt.Errorf("序列化配置失败：%w", err)
	}
	if err := os.WriteFile(path, append(data, '\n'), 0o644); err != nil {
		return fmt.Errorf("写入配置失败：%w", err)
	}
	return nil
}

// normalized 去掉首尾空白与结尾斜杠 —— 前端一律按「自己补 /」的方式拼接，
// 多一个斜杠就会拼出 //v1/boda 这种地址。
func (s Settings) normalized() Settings {
	return Settings{
		APIBaseURL: normalizeAddress(s.APIBaseURL),
		AgentWSURL: normalizeAddress(s.AgentWSURL),
		ASRURL:     normalizeAddress(s.ASRURL),
	}
}

func normalizeAddress(value string) string {
	return strings.TrimRight(strings.TrimSpace(value), "/")
}

// isEmpty 表示三项都没配，前端应完全按构建期默认值走。
func (s Settings) isEmpty() bool {
	return s.APIBaseURL == "" && s.AgentWSURL == "" && s.ASRURL == ""
}

// validate 逐字段校验，返回「字段 → 原因」。
//
// 留空是合法的（表示用默认值），所以只校验填了的那几个。校验放在保存前，
// 是因为写进去的地址要等下次启动才会被前端用上 —— 那时改不动了，错在启动前拦住。
//
// 原因只写「哪里不对」，不带字段名：界面上把它拼在字段标签后面（`后端接口地址 · 需要…`），
// 这样错误不额外占一行 —— 这个窗口高度固定，三条错误各占一行会把底部按钮挤出去。
func (s Settings) validate() map[string]string {
	problems := make(map[string]string, 3)
	check := func(field, value string, schemes ...string) {
		if value == "" {
			return
		}
		parsed, err := url.Parse(value)
		if err != nil || parsed.Host == "" {
			problems[field] = "要带协议和主机名"
			return
		}
		for _, scheme := range schemes {
			if parsed.Scheme == scheme {
				return
			}
		}
		problems[field] = "需要以 " + strings.Join(schemes, " 或 ") + " 开头"
	}
	check(fieldAPIBaseURL, s.APIBaseURL, "http", "https")
	check(fieldAgentWSURL, s.AgentWSURL, "ws", "wss")
	check(fieldASRURL, s.ASRURL, "http", "https")
	return problems
}

// preloadScript 生成注入到页面里的那段脚本。
//
// 用 PageOptions.PreloadScript 而不是 query 参数：它在页面自身脚本之前执行，
// 所以前端模块顶层读 window.__BODA_SETTINGS__ 时值已经就位，不需要异步等待，
// 也不用把「请求前先取配置」这件事扩散到每个调用点。
//
// 内容全部来自用户输入，用 json.Marshal 转义，避免拼出可执行的 JS 片段。
func (s Settings) preloadScript() string {
	if s.isEmpty() {
		return ""
	}
	payload, err := json.Marshal(s)
	if err != nil {
		// 字段都是字符串，正常走不到这里；真出错就不注入，退回默认值。
		return ""
	}
	return "window.__BODA_SETTINGS__=" + string(payload) + ";"
}
