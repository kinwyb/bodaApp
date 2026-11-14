# 统一登录（SSO）

未登录时跳转统一登录平台，平台登录后回调后端，后端验证并签发 token，
302 回前端时在 URL fragment 里带上 token；前端拾取后复用现有的登录态校验流程。

**启用条件（三者同时满足）**：

1. release 环境（`npm run build` 的产物；dev 固定走账号密码登录）；
2. 配置了 `VITE_SSO_LOGIN_URL`（没配置 = 现状的账号密码登录）；
3. 不是桌面壳（页面协议为 `mygo://` 时禁用 —— 平台无法 302 回应用内）。

判定收敛在 `src/utils/sso.ts` 的 `isSsoEnabled`。

## 完整流程

```
浏览器                    统一登录平台                 后端
  │  未登录，跳平台            │                          │
  │  GET <VITE_SSO_LOGIN_URL>?returnUrl=<原地址编码>       │
  │ ───────────────────────► │                          │
  │                          │  用户在平台完成登录        │
  │                          │  回调后端（平台与后端约定） │
  │                          │ ───────────────────────► │
  │                          │                          │ 验证回调、获取用户信息、签发 token
  │                          │                          │ （可同时 Set-Cookie 作后端自己的会话）
  │  302 Location: <returnUrl>#sso_token=<token>         │
  │ ◄────────────────────────────────────────────────── │
  │  前端启动拾取 token → localStorage(boda_token)        │
  │  replaceState 清掉 fragment                          │
  │  GET /v1/boda/login/userInfo（token 请求头）          │
  │ ──────────────────────────────────────────────────► │
  │  校验通过 → authenticated，进入主界面                 │
```

## 与后端的契约

- 回跳地址：`returnUrl` 指向前端页面（含用户原本要访问的路径），后端在其后追加
  `#sso_token=<token>` 后 302。例如 `https://mes.example.com/app/V0189#sso_token=abc123`。
- token 与 `/login` 接口返回的凭证同义：前端存 `localStorage(boda_token)`，
  之后所有请求照旧用 `token` 请求头携带，`/login/userInfo` 校验、401/10001 失效广播全部复用。
- **为什么用 fragment 不用 query**：fragment 不随 HTTP 请求发送，不进 nginx / 后端
  access log；前端拾取后立即 `replaceState` 清除，地址栏与浏览历史不残留。
- fragment 里的其它参数会保留，只摘掉 `sso_token`。
- 参数名 `sso_token` 定义在 `src/utils/sso.ts` 的 `TOKEN_PARAM`，改动需两侧同步。

## 配置

```bash
# .env.production（或部署时注入构建环境）
VITE_SSO_LOGIN_URL=https://sso.example.com/login?returnUrl={returnUrl}
# 可选：平台登出地址
VITE_SSO_LOGOUT_URL=https://sso.example.com/logout?returnUrl={returnUrl}
```

- `{returnUrl}` 占位符会被替换为 **URL 编码后的整串回跳地址**（origin + 原路径）；
  模板里没有占位符时自动追加 `?returnUrl=<编码地址>`（已有 query 则用 `&`）。
  平台侧参数名不叫 `returnUrl` 时，用占位符写成平台要的名字，
  例如 `https://sso.example.com/login?service={returnUrl}`。
- 本机演练正式流程：`.env.development` 里 `VITE_APP_ENV=release` + 配置登录地址
  （环境覆盖机制见 `src/utils/env.ts`）。

## 行为细节

- **深链接**：用户原本要访问的路径经 `returnUrl` 贯穿全链，登录回来落在原页面。
- **防死循环**：10 秒内只允许一次自动跳转（`sessionStorage` 时间戳守卫）。
  后端持续签发无效 token 时，「跳平台 → 秒回 → 校验失败 → 又跳」会被拦下，
  停在登录页给出重试入口；登录成功后守卫复位。
- **退出登录**：清本地凭证后停留在登录页（不自动跳平台 —— 平台会话还在，
  自动跳会被静默放行、瞬间回登）。配置了 `VITE_SSO_LOGOUT_URL` 时顺带跳转它
  清平台会话；没配置时再点「统一身份认证登录」仍会被平台秒回，这是平台侧
  会话未清的预期行为。
- **兜底入口**：SSO 登录页保留「使用账号密码登录」切换，平台故障时后端
  `/login` 仍可直接登录。
- **门户发起的登录**：即使本系统没配 `VITE_SSO_LOGIN_URL`，release 的 web 页面
  也会拾取回跳 fragment 里的 token（用户从平台门户主动进入的场景）。

## 代码路径

| 位置 | 职责 |
|------|------|
| `src/utils/sso.ts` | 启用判定、token 拾取、跳转与守卫、登出标记 |
| `src/main.tsx` | React 挂载前拾取回跳 token |
| `src/App.tsx`（Protected） | 未登录自动跳平台；登录成功复位守卫 |
| `src/store/auth.tsx`（logout） | 登出后打标记 / 跳平台登出 |
| `src/pages/LoginPage.tsx` | 统一登录入口态 + 账号密码兜底 |
