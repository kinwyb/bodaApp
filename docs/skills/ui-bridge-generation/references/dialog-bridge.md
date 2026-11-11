# 弹窗级界面桥

## 边界

弹窗打开时，弹窗层覆盖页面层：

- actions 换成弹窗动作；
- `mode=form`；
- page `query` 与 `tables` 清空；
- `form` 段来自弹窗；
- guide 优先使用弹窗自己的 guide。

关闭后自动回到页面层。页面桥不要转述弹窗字段或提交逻辑。

## 文件与注册

弹窗桥放在 `models/xxxEditBridge.ts`，不要命名为 `bridged.ts`，否则会被页面接入标记的 glob 误认为页面。

```tsx
const dialogBridge = useMemo(() => createXxxEditBridge(() => context), [context]);
useUIBridgeDialog(view, dialogBridge, open);
```

弹窗组件要知道自己所在页面的 `view`，由页面把 props 传下来。

## 表单快照

```ts
{
  id: 'xxxEdit',
  title: ctx.title,
  mode: ctx.mode,          // add/edit/view/copy
  recordId: ctx.recordId,
  fields: currentFields(), // id/label/type/value/options/readOnly/errors
  errors: detailErrors(),  // 不属于单个字段的表单级错误
  dirty: ctx.dirty,
}
```

字段表、JSX 与锁规则应共用业务状态。字段读取走 form 实例，不要另存一份表单值。

## 批量写入

使用公共 writer，不要逐字段写：

```ts
const writer = createFormWriter({
    fields: () => currentFieldSpecs(),
    fieldLock: (id) => ctx.fieldLock(id),
    write: (patch) => ctx.form.setFieldsValue(patch),
    sequenced: [
        {id: 'OrderCode', unlocksOthers: true, run: checkOrderCode},
        {id: 'Employee', run: resolveEmployee},
    ],
});

actions: [
    ...createFormWriteActions(currentFieldSpecs()),
    {id: 'form.submit', label: '保存', group: 'form'},
    {id: 'form.cancel', label: '取消', group: 'form'},
],
handlers: {
    ...createFormWriteHandlers(writer),
    'form.submit': submit,
    'form.cancel': cancel,
},
```

`sequenced` 用于“写完还要检测/查库/带出关联字段”的字段。`unlocksOthers` 表示它成功后，其余字段才解除锁定；writer 会轮询 `fieldLock`，避免 React state 尚未提交时误判。

## 明细与结构化数据

复杂明细不要逐格暴露成几十个 action：

- `detail.get` 返回可写字段定义、当前 rows、rowId/父单 ID 和回写顺序；
- `detail.set` 接收整份 rows 或 JSON 字符串；
- 页面负责字段白名单、类型转换、保留内部字段、重算汇总、跑校验；
- 回执列出写入行数、总数量、前几条具体错误。

数组参数用公共 `toArrayParam`，不要只接受一种格式。

## 保存与取消

- `form.submit` 成功才返回“已保存”。
- 校验、后端错误、明细红格都必须转成具体原因后 throw，模型才能修。
- `form.cancel` 明确返回“已关闭表单”。
- 保存成功/取消会关闭弹窗，桥通过结构变化自动发 full；页面不要手工伪造。

## Ready

编辑/复制/查看通常需要等详情接口落地，否则字段为空、recordId 不可靠。只有这种“快照结构依赖异步数据”的场景才声明 `ready`。

新增弹窗如果字段结构立即可用，不要等列表或选项接口。
