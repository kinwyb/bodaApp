// 组织切换：对应 C# 主窗口底部栏的组织下拉（Main.cs 的 OrgEdit_EditValueChanged）。
//
// C# 的做法：拉 /login/userOrgs 得到用户可用的组织，每个组织带自己的接口地址
// （ApiHost，纯 origin）；选中后把 API 的 host 换过去、记住 OrgID、通知已打开的页面。
// 桌面壳照搬这套语义，但落点不同：页面所有接口都经应用内代理（见 proxy.go），
// 所以「换服务器」= 换代理的 API 上游（retargetAPI），页面注入的代理地址不变，
// 无需重启、无需重新注入；ws 与语音地址不受影响。
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/egoist/mygo"
)

// Org 对应 /login/userOrgs 的 data 项（C# Models/Config.cs 的 Org，字段名一致）。
type Org struct {
	OrgID   string `json:"OrgID"`
	OrgName string `json:"OrgName"`
	// ApiHost 该组织的接口 origin（scheme://host:port），路径前缀另算（basePath）。
	ApiHost string `json:"ApiHost"`
	// ApiDomain 接口域名，C# 用于 Host 头伪装；走代理后由 Director 统一处理，这里仅接收不使用。
	ApiDomain string `json:"ApiDomain"`
}

// orgHTTPClient 拉组织列表专用：设置窗口在等它，超时必须短。
var orgHTTPClient = &http.Client{Timeout: 10 * time.Second}

// fetchOrgs 向当前 API 上游请求组织列表，同时返回响应头里的 Service-Org
// （当前服务器的组织 ID，nginx 下发）——它是「我现在连的是哪个组织」的权威答案，
// 设置窗口用它回显选中项。basePath 为接口路径前缀（/v1/boda）。
func fetchOrgs(token, basePath string) ([]Org, string, error) {
	origin := currentAPIOrigin()
	if origin == nil {
		return nil, "", fmt.Errorf("未配置后端接口地址")
	}
	// userID 留空与 C# 一致：服务端按 token 识别用户，返回其可用组织
	endpoint := origin.String() + basePath + "/login/userOrgs?userID="
	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, "", fmt.Errorf("构造请求失败：%w", err)
	}
	req.Header.Set("token", token)

	resp, err := orgHTTPClient.Do(req)
	if err != nil {
		log.Printf("拉取组织列表失败：%v", err)
		return nil, "", fmt.Errorf("连不上服务器（%s）", origin.Host)
	}
	defer resp.Body.Close()
	serverOrg := strings.TrimSpace(resp.Header.Get("Service-Org"))

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, "", fmt.Errorf("读取响应失败：%w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("服务器返回 %d", resp.StatusCode)
	}
	var payload struct {
		Code   int    `json:"code"`
		Errmsg string `json:"errmsg"`
		Data   []Org  `json:"data"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, "", fmt.Errorf("解析组织列表失败：%w", err)
	}
	if payload.Code != 0 {
		msg := payload.Errmsg
		if msg == "" {
			msg = fmt.Sprintf("code=%d", payload.Code)
		}
		return nil, "", fmt.Errorf("%s", msg)
	}

	// 与 C# LoadOrgs 一致：忽略组织 ID 为空的项
	orgs := make([]Org, 0, len(payload.Data))
	for _, org := range payload.Data {
		if strings.TrimSpace(org.OrgID) == "" {
			continue
		}
		orgs = append(orgs, org)
	}
	return orgs, serverOrg, nil
}

// initialOrgName 决定下拉的初始选中项：优先服务器自报的组织（Service-Org），
// 其次是配置里记住的 OrgID，都没有就选第一个。与 C# LoadOrgs 的选中逻辑对应。
func initialOrgName(orgs []Org, serverOrg, savedOrg string) string {
	for _, id := range []string{serverOrg, savedOrg} {
		if id == "" {
			continue
		}
		for _, org := range orgs {
			if org.OrgID == id {
				return org.OrgName
			}
		}
	}
	if len(orgs) > 0 {
		return orgs[0].OrgName
	}
	return ""
}

// switchOrg 把 API 上游切到指定组织并立即生效（不重启）：
//  1. 新地址与 OrgID 写盘（ws / 语音沿用盘上原值，绝不改动）；
//  2. retargetAPI 原子替换代理上游，页面注入的代理地址不变；
//  3. 通知页面 dispatch boda-org-changed，前端据此重拉菜单、重置页签。
//
// basePath 是当前接口路径前缀（/v1/boda）：组织的 ApiHost 只提供 origin，
// 前缀保持不变。page 为主窗口页面（调用方在主线程捕获），为 nil 时跳过通知。
// 返回写盘后的配置，供调用方回写输入框与 appSettings。
func switchOrg(org Org, basePath string, page *mygo.Page) (Settings, error) {
	apiHost := normalizeAddress(org.ApiHost)
	if apiHost == "" {
		// 与 C# 一致：组织没配自己的地址就留在当前服务器（只切换组织身份）
		if origin := currentAPIOrigin(); origin != nil {
			apiHost = origin.String()
		}
	}
	if originOf(apiHost) == nil {
		return Settings{}, fmt.Errorf("组织「%s」未配置有效的接口地址", org.OrgName)
	}

	next := loadSettings().withDefaults()
	next.APIBaseURL = apiHost + basePath
	next.OrgID = org.OrgID
	next = next.normalized()
	if err := saveSettings(next); err != nil {
		return Settings{}, err
	}
	if err := retargetAPI(next.APIBaseURL); err != nil {
		return Settings{}, err
	}
	notifyPageOrgChanged(page, next.OrgID)
	return next, nil
}

// notifyPageOrgChanged 让页面广播组织切换事件（前端 utils/service-org.ts 在监听）。
// orgID 来自服务端接口，仍做转义，避免个别字符截断 JS 字符串。
func notifyPageOrgChanged(page *mygo.Page, orgID string) {
	if page == nil {
		return
	}
	escaped := strings.ReplaceAll(orgID, `\`, `\\`)
	escaped = strings.ReplaceAll(escaped, `'`, `\'`)
	js := `window.dispatchEvent(new CustomEvent('boda-org-changed', {detail: {orgId: '` + escaped + `'}}))`
	if _, err := page.Eval(js); err != nil {
		log.Printf("通知页面组织切换失败：%v", err)
	}
}
