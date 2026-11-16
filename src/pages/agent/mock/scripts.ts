/**
 * 演示脚本：回答用的内容（思考 / 工具 / 正文）。
 *
 * 只是内容，不含协议结构 —— transport/mock.ts 会按 ws 协议把它拆成
 * reasoning_delta / tool_start / tool_completed / message_delta / finished。
 */

/** 一个演示工具调用，字段对齐后端 types.ToolCall */
export type MockToolCall = {
  id: string;
  /** 工具类型，对齐后端 types.ToolType；缺省按本地工具（function）演示 */
  type?: 'function' | 'mcp';
  name: string;
  /** MCP 服务名，对齐后端 ToolCall.extra.server */
  server?: string;
  /** JSON 字符串，和后端 ToolCall.Params 一致 */
  params: string;
  result: string;
};

/** 演示用的一次审批：推帧后阻塞演示轮，等用户允许 / 拒绝再决定后续正文 */
export type MockApproval = {
  content: string;
  command?: string[];
  cwd?: string;
  reason?: string;
  /** 用户允许后继续输出的正文 */
  acceptText: string;
  /** 用户拒绝后输出的正文 */
  declineText: string;
};

/** 演示用的一次结构化提问：推帧后阻塞演示轮，等用户作答 / 跳过再继续 */
export type MockUserInput = {
  questions: Array<{
    id: string;
    header?: string;
    question: string;
    options?: Array<{ label: string; description?: string }>;
  }>;
  /** 非零时卡片显示倒计时（毫秒），与上游 autoResolutionMs 一致 */
  autoResolutionMs?: number;
  /** 用户作答后继续输出的正文 */
  answeredText: string;
  /** 用户跳过后输出的正文 */
  skippedText: string;
};

export type MockScript = {
  /** 思考过程，按 reasoning_delta 分块下发 */
  reasoning: string;
  tools: MockToolCall[];
  text: string;
  /** 可选审批步骤：有它就在正文前插入一次审批并阻塞等待决定 */
  approval?: MockApproval;
  /** 可选提问步骤：有它就在正文前插入一次结构化提问并阻塞等待作答 */
  userInput?: MockUserInput;
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
      type: 'mcp',
      server: 'boda',
      name: 'bi.worktime',
      params: '{"week":"2026-W44","groupBy":"workshop"}',
      result: '6 个车间：计划 4 820h，可用 4 210h',
    },
    {
      id: 'tool-load-rate',
      type: 'mcp',
      server: 'boda',
      name: 'bi.loadRate',
      params: '{"formula":"plan/available","unit":"percent"}',
      result: '{"机加工":132,"热处理":121,"焊接":106,"装配":78}',
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

/** 审批演示：问「审批 / 删除 / 清理」触发，弹窗里允许或拒绝后走不同结尾 */
export const APPROVAL_SCRIPT: MockScript = {
  reasoning:
    '用户要清理过期的临时导出文件。这属于有副作用的删除操作，需要先列出目标目录确认范围，再向用户发起审批，拿到允许后才执行。',
  tools: [],
  text: '',
  approval: {
    content: '执行命令：[rm -rf /tmp/boda-exports/2026-10],理由：清理一个月前的临时导出文件，释放磁盘空间',
    command: ['rm', '-rf', '/tmp/boda-exports/2026-10'],
    cwd: '/tmp/boda-exports',
    reason: '清理一个月前的临时导出文件，释放磁盘空间',
    acceptText:
      '已按你的允许执行清理：删除了 `/tmp/boda-exports/2026-10` 下 **128 个**过期导出文件，释放约 **342 MB** 磁盘空间。当前导出目录只保留最近 30 天的内容。',
    declineText:
      '好的，已**取消**这次清理，没有删除任何文件。如果之后想继续，可以告诉我改用「移到回收站」或「只列出将被删除的文件」这类更稳妥的方式。',
  },
};

/** 提问演示：问「调整生产计划 / 提问 / 澄清」触发，作答或跳过后走不同结尾 */
export const USER_INPUT_SCRIPT: MockScript = {
  reasoning:
    '用户要调整下周的生产计划，但没说调整范围和排产取向。这两个信息会直接影响排产结果，先向用户发起结构化提问，拿到答案后再给出调整方案。',
  tools: [],
  text: '',
  userInput: {
    autoResolutionMs: 60000,
    questions: [
      {
        id: 'workshop',
        header: '调整范围',
        question: '要调整哪个车间的生产计划？',
        options: [
          { label: '机加工车间', description: 'CNC 产线，当前负荷 132%' },
          { label: '热处理车间', description: '单产线，插单空间小' },
          { label: '装配车间', description: '负荷 78%，仍有富余' },
        ],
      },
      {
        id: 'strategy',
        header: '排产策略',
        question: '排产时优先保证什么？',
        options: [
          { label: '交付日期优先', description: '按期交付，可能增加换型次数' },
          { label: '设备利用率优先', description: '减少换型，部分订单可能顺延' },
        ],
      },
      {
        id: 'constraints',
        header: '补充约束',
        question: '还有其他约束需要纳入吗？（如物料齐套、人员班次，没有可跳过）',
      },
    ],
    answeredText:
      '已按你的选择生成调整方案：重排了下周对应车间的工单顺序，优先保住承诺交付日期，并把换型集中在夜班低谷时段。预计负荷率下降 **9 个百分点**，两张风险预订单（YD-20261026-018 / YD-20261025-042）可回到交付日前完成。方案已写入排产草稿，确认后才会下发到车间。',
    skippedText:
      '好的，先不做调整。我按当前计划继续跟踪，如果之后想改，可以直接告诉我车间和排产取向，或让我先给出一版默认方案供你对比。',
  },
};

/** 按关键词挑一段示例回答 */
export function buildMockScript(question: string): MockScript {
  if (/审批|删除|清理|授权/.test(question)) return APPROVAL_SCRIPT;
  if (/调整.*计划|生产计划|提问|澄清/.test(question)) return USER_INPUT_SCRIPT;
  if (/预订单|订单|交付|延期/.test(question)) return DELIVERY_SCRIPT;
  if (/产能|工时|瓶颈|负荷|效率/.test(question)) return CAPACITY_SCRIPT;
  if (/日报|报表|统计|汇总/.test(question)) return REPORT_SCRIPT;
  return FALLBACK_SCRIPT;
}
