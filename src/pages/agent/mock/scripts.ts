/**
 * 演示脚本：回答用的内容（思考 / 工具 / 正文）。
 *
 * 只是内容，不含协议结构 —— transport/mock.ts 会按 ws 协议把它拆成
 * reasoning_delta / tool_start / tool_completed / message_delta / finished。
 */

/** 一个演示工具调用，字段对齐后端 types.ToolCall */
export type MockToolCall = {
  id: string;
  name: string;
  /** JSON 字符串，和后端 ToolCall.Params 一致 */
  params: string;
  result: string;
};

export type MockScript = {
  /** 思考过程，按 reasoning_delta 分块下发 */
  reasoning: string;
  tools: MockToolCall[];
  text: string;
};

export const DELIVERY_SCRIPT: MockScript = {
  reasoning:
    '用户要本周预订单的交付风险。先取本周交付的预订单列表，再按单号批量查工序进度，用「已完成工序数 / 总工序数」估完成率，最后按交付日期排序挑出可能延期的。',
  tools: [
    {
      id: 'tool-preorder-list',
      name: 'plan.queryPreorder',
      params: '{"deliveryFrom":"2026-10-26","deliveryTo":"2026-11-01","status":"active"}',
      result: '命中 37 张预订单，其中 4 张带风险标记（risk=late）',
    },
    {
      id: 'tool-process-progress',
      name: 'plan.loadProgress',
      params: '{"orderNos":["YD-20261026-018","YD-20261025-042","YD-20261024-007","YD-20261026-031"]}',
      result: '4 张单的工序完成率：45% / 62% / 71% / 58%',
    },
  ],
  text: `本周共 **37 张**预订单，其中 **4 张**存在交付风险，建议优先处理：

| 预订单号 | 客户 | 交付日期 | 完成率 | 风险原因 |
| --- | --- | --- | --- | --- |
| YD-20261026-018 | 华东精密 | 10-27 | 45% | 关键工序「热处理」排队 2 天 |
| YD-20261025-042 | 中冶重工 | 10-28 | 62% | 缺料：M8 螺栓库存不足 |
| YD-20261024-007 | 恒立液压 | 10-28 | 71% | 外协件回货延期 |
| YD-20261026-031 | 三花智造 | 10-29 | 58% | 设备故障停机 6 小时 |

### 建议动作

1. **YD-20261026-018**：与热处理车间确认插单，可压缩约 1.5 天；
2. **YD-20261025-042**：走急件采购，或在系统内改为替代料号；
3. 其余两张按当前节奏可在交付日前完成，建议保持每日跟踪。

> 以上判断基于「计划工序完成率」，未包含质检返工时间。`,
};

export const CAPACITY_SCRIPT: MockScript = {
  reasoning:
    '要比较各车间的计划工时和可用工时。先拉本周工时统计，再按车间算负荷率（计划 ÷ 可用），超过 100% 的就是瓶颈。',
  tools: [
    {
      id: 'tool-worktime',
      name: 'bi.worktime',
      params: '{"week":"2026-W44","groupBy":"workshop"}',
      result: '6 个车间：计划 4 820h，可用 4 210h',
    },
    {
      id: 'tool-load-rate',
      name: 'bi.loadRate',
      params: '{"formula":"plan/available","unit":"percent"}',
      result: '机加工 132%、热处理 121%、焊接 106%、装配 78%',
    },
  ],
  text: `整体负荷率 **114%**，已超出可用产能，瓶颈集中在两个车间：

- **机加工车间**：负荷率 132%，其中 CNC-03 / CNC-07 两台设备连续 6 天满排；
- **热处理车间**：负荷率 121%，且只有一条产线，插单空间很小；
- 装配车间负荷率 78%，仍有富余，可承接前道工序的提前装配。

\`\`\`text
车间          计划工时   可用工时   负荷率
机加工         1 860      1 410     132%
热处理         1 090        900     121%
焊接             720        680     106%
装配             680        870      78%
\`\`\`

建议把「YD-20261026-018」的热处理工序拆成两批，先做已齐套的部分，可把该车间负荷降到 108% 左右。`,
};

export const REPORT_SCRIPT: MockScript = {
  reasoning:
    '用户要今天的生产日报。需要产量、异常、在制品三类数据，按日报模板组织；缺的项标注出来，不要编。',
  tools: [
    {
      id: 'tool-daily-output',
      name: 'production.dailyOutput',
      params: '{"date":"2026-10-26"}',
      result: '计划 1 240 件，实际 1 186 件',
    },
    {
      id: 'tool-daily-exception',
      name: 'production.exceptions',
      params: '{"date":"2026-10-26","level":"all"}',
      result: '3 条异常：主轴报警、气体压力不足、外协件超差',
    },
  ],
  text: `## 生产日报 · 2026-10-26

**产量**：计划 1 240 件，实际 1 186 件，达成率 **95.6%**。

**异常**：3 条
1. CNC-05 主轴报警，停机 1.5 小时（已恢复）；
2. 焊接车间气体压力不足，影响 2 个工单；
3. 来料检验发现 1 批外协件尺寸超差，已退货。

**在制品**：482 件，较昨日 +36 件，主要集中在机加工车间。

需要我把这份日报写入「报表管理 → 生产日报」，或者导出为 Excel 吗？`,
};

export const FALLBACK_SCRIPT: MockScript = {
  reasoning: '当前没有连后端，只能给出示例回答；先说明演示模式的边界，再引导用户提问。',
  tools: [],
  text: `当前是**界面演示模式**，还没有连上真正的 Agent 服务，所以只能给出示例回答。

界面这一侧已经按后端 ws 协议对接完毕，等 \`VITE_AGENT_WS_URL\` 指过去即可直接使用：

- 流式正文（\`message_delta\` 逐段追加，\`message_completed\` 收尾）
- 思考过程（\`reasoning_start / reasoning_delta / reasoning_completed\`）
- 工具调用链（\`tool_start / tool_completed\`，带参数与结果）
- 历史消息（\`session.history\`，含翻页与增量补发）
- Markdown、表格、代码块渲染
- 复制、点赞、重新生成

你可以试着问「本周预订单交付风险」「产能瓶颈」或「生成生产日报」，会走对应的示例脚本。`,
};

/** 按关键词挑一段示例回答 */
export function buildMockScript(question: string): MockScript {
  if (/预订单|订单|交付|延期/.test(question)) return DELIVERY_SCRIPT;
  if (/产能|工时|瓶颈|负荷|效率/.test(question)) return CAPACITY_SCRIPT;
  if (/日报|报表|统计|汇总/.test(question)) return REPORT_SCRIPT;
  return FALLBACK_SCRIPT;
}
