// 内置反向代理：把页面的接口请求转发到真实服务器。
//
// 为什么需要它：桌面版的页面 origin 是 `mygo://localhost`，直接请求后端属跨域，
// 浏览器要读响应就必须带 `Access-Control-Allow-Origin`，而线上 nginx 没配（实测
// OPTIONS 直接 405、POST 响应无该头），登录会静默失败。改后端要运维配合、还要放行
// 这个非常规 origin；在应用内做一层转发则完全不用碰服务器。
//
// 为什么用本地回环端口而不是自定义 scheme：先试过注册 `boda://` 转发，
// 页面确实能 fetch 通，**但 WKWebView 的自定义 scheme 会丢掉 POST 的请求体**
// （handler 拿到的 r.Body 是空的，后端一直回「username参数缺失」）。
// 换成本地 127.0.0.1:随机端口 走普通 http，body 完整，跨域头仍由我们自己加。
//
// 路由（路径前缀 → 目标机）：
//
//	/v1/boda/...  →  <API origin>/v1/boda/...
//	/asr          →  <ASR origin>/asr
//	/ws/files/... →  <Agent http origin>/ws/files/...
//
// Agent 的 WebSocket 不走这里：ws 不受同源策略约束，直连即可。
package main

import (
	"fmt"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/egoist/mygo"
)

// proxyRoutes 是启动时确定下来的转发目标（只存 scheme+host，路径原样透传）。
type proxyRoutes struct {
	api    *url.URL
	asr    *url.URL
	agentH *url.URL // Agent 的 http 端点（由 ws 地址推导），用于附件上传下载
}

var (
	routes proxyRoutes
	// proxyBaseURL 是注入给页面的代理地址，形如 http://127.0.0.1:52341
	proxyBaseURL string
)

// startProxy 在本地回环的随机端口起转发服务，返回后 proxyBaseURL 才可用。
func startProxy(settings Settings) error {
	routes = proxyRoutes{
		api:    originOf(settings.APIBaseURL),
		asr:    originOf(settings.ASRURL),
		agentH: agentHTTPOrigin(settings.AgentWSURL),
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return fmt.Errorf("代理端口监听失败：%w", err)
	}
	proxyBaseURL = "http://" + listener.Addr().String()
	logProxy("代理已启动 %s -> api=%v asr=%v", proxyBaseURL, settings.APIBaseURL, settings.ASRURL)

	go func() {
		// 端口随机、只绑回环地址，不对外暴露
		if err := http.Serve(listener, http.HandlerFunc(handleProxy)); err != nil {
			log.Printf("proxy serve: %v", err)
		}
	}()
	return nil
}

// originOf 取 scheme://host:port，丢掉路径。
func originOf(raw string) *url.URL {
	if raw == "" {
		return nil
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return nil
	}
	return &url.URL{Scheme: u.Scheme, Host: u.Host}
}

// agentHTTPOrigin 把 ws://host:port/ws 换成 http://host:port。
func agentHTTPOrigin(wsURL string) *url.URL {
	if wsURL == "" {
		return nil
	}
	u, err := url.Parse(wsURL)
	if err != nil || u.Host == "" {
		return nil
	}
	scheme := "http"
	if u.Scheme == "wss" {
		scheme = "https"
	}
	return &url.URL{Scheme: scheme, Host: u.Host}
}

func handleProxy(w http.ResponseWriter, r *http.Request) {
	origin := r.Header.Get("Origin")

	// 预检：带 Authorization 头的请求会先来一趟 OPTIONS
	if r.Method == http.MethodOptions {
		logProxy("OPTIONS %s -> 204", r.URL.Path)
		writeCORS(w.Header(), origin)
		w.WriteHeader(http.StatusNoContent)
		return
	}

	target := pickTarget(r.URL.Path)
	if target == nil {
		logProxy("FAIL %s %s -> 未配置目标", r.Method, r.URL.Path)
		writeCORS(w.Header(), origin)
		http.Error(w, "未配置服务器地址", http.StatusBadGateway)
		return
	}
	logProxy("%s %s -> %s%s", r.Method, r.URL.Path, target.Host, r.URL.Path)

	proxy := &httputil.ReverseProxy{
		Director: func(req *http.Request) {
			req.URL.Scheme = target.Scheme
			req.URL.Host = target.Host
			req.Host = target.Host
			// 真实的 Origin 对后端没意义，删掉免得被当成非法来源拒绝
			req.Header.Del("Origin")
			req.Header.Del("Referer")
		},
		ModifyResponse: func(resp *http.Response) error {
			writeCORS(resp.Header, origin)
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			logProxy("ERROR %s %s -> %v", r.Method, r.URL.Path, err)
			writeCORS(w.Header(), origin)
			w.Header().Set("Content-Type", "application/json;charset=UTF-8")
			w.WriteHeader(http.StatusBadGateway)
			// 按前端约定的错误结构返回，让界面直接显示原因而不是「Failed to fetch」
			msg := `{"code":502,"errmsg":"连不上服务器（` + target.Host + `）：` + escapeJSON(err.Error()) + `","data":null}`
			w.Write([]byte(msg))
		},
	}
	proxy.ServeHTTP(w, r)
}

// pickTarget 按路径前缀选目标机。最长前缀优先，避免 /asr 抢了别的路由。
func pickTarget(path string) *url.URL {
	switch {
	case routes.agentH != nil && strings.HasPrefix(path, "/ws/"):
		return routes.agentH
	case routes.asr != nil && (path == "/asr" || strings.HasPrefix(path, "/asr/")):
		return routes.asr
	default:
		return routes.api
	}
}

// writeCORS 放行应用自己的页面。origin 传空时用固定的页面 origin 兜底。
func writeCORS(h http.Header, origin string) {
	if origin == "" {
		origin = "mygo://localhost"
	}
	h.Set("Access-Control-Allow-Origin", origin)
	h.Set("Access-Control-Allow-Credentials", "true")
	h.Set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
	h.Set("Access-Control-Allow-Headers", "Content-Type,Authorization,Token,X-Requested-With")
	h.Set("Access-Control-Max-Age", "600")
}

// escapeJSON 只处理会把 JSON 字符串截断的字符，够用了。
func escapeJSON(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `"`, `\"`)
	s = strings.ReplaceAll(s, "\n", " ")
	return s
}

// logProxy 把转发情况写进用户数据目录的 proxy.log（超过 512KB 就重置）。
// 排查「登录失败」这类问题时，能一眼区分是没走代理、还是走了但连不上后端。
func logProxy(format string, args ...any) {
	dir, err := mygo.App.Path(mygo.PathUserData)
	if err != nil {
		return
	}
	path := filepath.Join(dir, "proxy.log")
	if info, err := os.Stat(path); err == nil && info.Size() > 512<<10 {
		os.Remove(path)
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	fmt.Fprintf(f, "%s %s\n", time.Now().Format("15:04:05"), fmt.Sprintf(format, args...))
}
