# 界面桥交付检查

## 接入

- [ ] 页面目录有 `bridged.ts`，文件只含常量与纯函数，不 import React、不调 hook。
- [ ] `index.tsx` 用页面 props 的 `view` 调 `useUIBridgeHost(view, bridge)`。
- [ ] context 通过 `read: () => context` 提供最新状态，不复制过期的 state。
- [ ] `guide.summary` 非空；`steps/terms/cautions` 覆盖真实业务难点。
- [ ] `description.md` 已由脚本生成，且与 summary 一致。

## 页面快照

- [ ] 快照只给目录，不塞整表数据行。
- [ ] 单表也在 `tables[]` 中；多表 name 唯一。
- [ ] 页面级查询在 `query`，表内筛选留给 `filterType`。
- [ ] 异步标签页/折叠区正确表达 `visible` 与 `readable`。
- [ ] 分组统计行、服务端分页总数、当前页行数没有被混淆。
- [ ] 没有为了列表首屏接口阻塞 `ready()`。

## 表格

- [ ] `columns` 与页面共用同一份定义。
- [ ] `rowKey` 是业务主键。
- [ ] `keyFields` 是合理的默认投影，没有把几十个细节列全量塞入。
- [ ] 关键字段有 `columnHints`。
- [ ] 依赖选中态的业务按钮配置了 `waitSelected` 或等价等待。
- [ ] enum 过滤依赖 `.filter.options`，不把候选值塞进快照。

## 命令

- [ ] 业务命令来自 `CommandItem`，没有复制按钮逻辑。
- [ ] actions 与 handlers 的 id 一一对应。
- [ ] disabled 时有模型可读的 disabledReason。
- [ ] waitConfirm 命令只触发确认框，回执不说“已完成”。
- [ ] 纯读命令按需标 `returns: 'result'`，其它命令没有乱写档位。
- [ ] handler 执行时从 getter 取最新 command/state。
- [ ] `query.set` 等异步命令等请求真正落地，失败也放行。

## 弹窗

- [ ] 弹窗桥是独立的 `*Bridge.ts`，没有误命名成 `bridged.ts`。
- [ ] 仅在 `open=true` 时 `useUIBridgeDialog`。
- [ ] 字段表、取值、锁、错误都来自弹窗真实状态。
- [ ] 使用 `form.setMany` 批量写入，不逐字段调用。
- [ ] 检测/查人/带出关联字段使用 `sequenced`，解锁顺序正确。
- [ ] 明细使用 `detail.get` + `detail.set` 整份替换，保留 rowId/父单 ID。
- [ ] 保存失败返回可修复的具体原因。
- [ ] 快照结构依赖详情数据时才声明 `ready()`。

## 事件

- [ ] 事件只从真实用户交互上报。
- [ ] payload 必填项和 mergeBy 已声明。
- [ ] immediate 事件只用于 waitConfirm 终态，并配置 waitConfirmFor。

## 验证

- [ ] `node <skill目录>/scripts/audit_bridge.mjs <View>` 无 error。
- [ ] `npm run menu:descriptions:check` 通过。
- [ ] `npx tsc -b` 通过。
- [ ] 修改文件 `oxlint` 无新增 error。
- [ ] 开发环境打开页面，`ui_observe` 能看到 guide/query/tables/actions。
- [ ] 读取一条表格数据，确认行号与屏幕顺序一致。
- [ ] 执行一个纯读命令、一个状态变化命令，确认回执档位合理。
- [ ] 如果接了弹窗，打开后确认页面层被 form 层覆盖，关闭后恢复。
