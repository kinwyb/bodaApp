/**
 * 表单类弹窗的写入引擎（界面桥的一部分，与具体业务无关）。
 *
 * 一条 `ui_act` 只能带一条命令，所以「一次改多处」必须做成一条批量命令 —— 否则往返次数
 * 等于条目数，每次往返都要模型重读一遍手里那份字段表。这里把这套逻辑固定在桥这一层，
 * 弹窗只回答三个问题：
 *
 * - **有哪些字段**（`fields`，每次调用时取，下拉候选可能随页面数据变）；
 * - **哪个字段此刻为什么不能改**（`fieldLock`，锁的唯一真相在弹窗里，别在这儿再推一遍）；
 * - **写完还有后续动作的字段怎么处理**（`sequenced`：订单号要检测、业务员要查工号）。
 *
 * 剩下的都一样：解析入参（对象 / JSON 字符串 / 中文名）、逐字段判锁与类型、顺序字段先走、
 * 一次写入、拼回执。所以新弹窗接桥时不用再抄一遍 `form.setMany`。
 *
 * 两条实现约束，改之前先读：
 * - **逐字段判断、一次写入**：不能为了省事逐个 setFieldsValue，界面会渲染多次、校验跑多次。
 * - **别自己推「刚检测通过 = 可写」**：检测类字段成功后，界面的锁（React state）还没提交，
 *   立刻写别的字段会被判成未解锁 —— 只能轮询 `fieldLock` 等它变（见 waitForUnlock）。
 */

import dayjs from 'dayjs';
import {DATE_FORMAT, toDayjs, toStringOrEmpty} from '@/utils';
import type {UIAction, UIFieldType} from '../protocol';
import type {UIBridgeHandler} from './types';

/** 表单字段描述（不含运行时取值）：解析、转换、回执都用它 */
export type FormFieldSpec = {
  /** 字段 id，就是 Form.Item 的 name */
  id: string;
  label: string;
  /** 控件类型。直接用协议里的 `UIFieldType` 字面量，别另外发明一套枚举 */
  type: UIFieldType;
  /** 枚举字段的候选值：模型填了候选之外的值会被拒绝，请它让用户手动选 */
  options?: string[];
  required?: boolean;
  /** 界面上就改不了（编辑态锁死、汇总字段等），与运行时的 fieldLock 是两个来源 */
  readOnly?: boolean;
  /** 只读的原因：不写的话模型会一直试着改 */
  readOnlyReason?: string;
};

/**
 * 单个字段的写入结果。
 *
 * `ok=false` 时 message 已经说清「为什么没设进去」与「下一步该谁做」，调用方直接回给模型。
 * 不抛错：抛错会让模型当成失败反复重试，而它该做的往往是「请用户手动设置」。
 */
export type FieldOutcome = {ok: boolean; message: string};

/**
 * 写完还有后续动作的字段（检测、查人、带出关联值）。
 *
 * `run` 自己负责把值写进表单并回一句话 —— 它比通用写入多一步（可能还要 await 接口），
 * 通用层只按顺序调用它，成功与否看 `ok`。
 */
export type SequencedFieldSpec = {
  id: string;
  /**
   * 成功后其余字段的锁可能才解除（例如订单号检测通过后日期才可改）。
   * 标了它，批量写其余字段前会先等界面摘锁，而不是立刻写（那样会被判成未解锁）。
   */
  unlocksOthers?: boolean;
  run: (value: unknown) => Promise<FieldOutcome>;
};

/** 批量一次的入参解析结果 */
export type FieldEntry = {field: FormFieldSpec; value: unknown};

/**
 * 把模型给的值转成界面上的写回形态（日期 Dayjs、数字 number，其余原样），顺带做取值校验。
 *
 * 单字段与批量共用同一套规则：批量是一次写入多个字段，每个值都得先确认能写，
 * 否则一个坏值会把整批都拖下水。
 */
export function normalizeFieldValue(
  field: FormFieldSpec,
  value: unknown,
): {ok: true; value: unknown} | {ok: false; reason: string} {
  // 枚举字段：值必须来自界面给出的候选，否则硬塞一个不存在的产地，保存时才炸
  if (field.type === 'select' && field.options && !field.options.includes(toStringOrEmpty(value))) {
    return {
      ok: false,
      reason: `只能是 ${field.options.join(' / ') || '（当前没有可选值）'}，请让用户手动选择`,
    };
  }
  if (field.type === 'date') {
    const parsed = toDayjs(value);
    if (!parsed) {
      // 只描述期望格式：调用方回执里已经写了「哪个字段 = 什么值」，这里再带一遍只是噪音
      return {ok: false, reason: '不是日期，格式要 YYYY-MM-DD'};
    }
    return {ok: true, value: parsed};
  }
  if (field.type === 'number') {
    const number = Number(value);
    if (Number.isNaN(number)) {
      return {ok: false, reason: '不是数字'};
    }
    return {ok: true, value: number};
  }
  return {ok: true, value};
}

/** 交给 agent 的取值：日期转成 YYYY-MM-DD 字符串 —— 模型读得懂，也填得回来 */
export function toAgentValue(value: unknown): unknown {
  if (dayjs.isDayjs(value)) return value.format(DATE_FORMAT);
  return value ?? null;
}

/** 回执里描述「设成了什么」：日期用 YYYY-MM-DD，其余按字符串 */
function describeValue(field: FormFieldSpec, value: unknown): string {
  if (field.type === 'date') return toStringOrEmpty(toAgentValue(value));
  return toStringOrEmpty(value);
}

/**
 * 解析批量入参：`{ 字段id: 新值 }`，或它的 JSON 字符串。
 *
 * 键先按字段 id 认，认不出再按界面上显示的名称认 —— 字段一多，模型很容易写成中文名，
 * 为这一个字返工一轮不划算（同一弹窗内 label 唯一，按名称识别不会串到别的字段）。
 * 返回 null 表示形状不对（不是对象），由调用方回一句「该怎么传」。
 */
export function resolveFieldEntries(
  input: unknown,
  fields: FormFieldSpec[],
): {entries: FieldEntry[]; unknownKeys: string[]} | null {
  let source = input;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source) as unknown;
    } catch {
      return null;
    }
  }
  // 数组是明细行的形状（detail.set 那类），不是批量字段表 —— 按形状不对处理，别猜
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return null;
  }

  const byId = new Map(fields.map((field) => [field.id, field]));
  const byLabel = new Map(fields.map((field) => [field.label, field]));
  const merged = new Map<string, FieldEntry>();
  const unknownKeys: string[] = [];
  Object.entries(source as Record<string, unknown>).forEach(([key, value]) => {
    const field = byId.get(key) ?? byLabel.get(key);
    if (!field) {
      unknownKeys.push(key);
      return;
    }
    // 同一个字段既按 id 又按名称给了值：后者覆盖前者，只保留一条（否则会写两次）
    merged.set(field.id, {field, value});
  });
  return {entries: [...merged.values()], unknownKeys};
}

/** 回执里的字段名列表：列太多反而淹没重点，超了就截断 */
export function summarizeLabels(labels: string[]): string {
  const LIMIT = 10;
  if (labels.length <= LIMIT) return labels.join('、');
  return `${labels.slice(0, LIMIT).join('、')} 等`;
}

/**
 * 数组类入参：数组，或数组的 JSON 字符串。
 *
 * 参数在协议里只有标量类型，模型常把结构化数据序列化成字符串再传 —— 两种都认，
 * 免得它按格式报错反复重试。
 */
export function toArrayParam(input: unknown): unknown[] | null {
  if (Array.isArray(input)) return input;
  if (typeof input === 'string') {
    try {
      const parsed: unknown = JSON.parse(input);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

export type FormWriterOptions = {
  /** 当前字段表：每次调用时取（下拉候选等可能随页面数据变） */
  fields: () => FormFieldSpec[];
  /** 这个字段此刻为什么改不了（null = 可以改）；锁的唯一真相在弹窗里 */
  fieldLock: (id: string) => string | null;
  /** 一次写入多个已转换好的值（弹窗传 form.setFieldsValue） */
  write: (patch: Record<string, unknown>) => void;
  /** 写完还有后续动作的字段，按数组顺序处理 */
  sequenced?: SequencedFieldSpec[];
  /** 等界面摘锁的上限（检测类字段成功后，React state 提交晚于这次写入） */
  unlockTimeoutMs?: number;
};

export type FormWriter = {
  fields: () => FormFieldSpec[];
  /** 设置一个字段；字段不存在时抛错（那是模型写错了 id，要它看到原因） */
  setOne: (id: string, value: unknown) => Promise<FieldOutcome>;
  /** 批量设置：入参是 ui_act 的整个 params，回执是一段给模型看的话 */
  setMany: (params: Record<string, unknown>) => Promise<string>;
};

/** 等这些字段真的可以改了（轮询界面上的锁，超时返回 false） */
async function waitForUnlock(
  options: FormWriterOptions,
  entries: FieldEntry[],
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (entries.every((entry) => options.fieldLock(entry.field.id) === null)) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
}

/**
 * 装配写入引擎。
 *
 * 吃的是取值函数（`fields` / `fieldLock` / `write`）而不是快照：弹窗每次渲染都会换一份状态，
 * 而引擎要在「被调用的那一刻」读到最新的字段表与锁。
 */
export function createFormWriter(options: FormWriterOptions): FormWriter {
  const timeoutMs = options.unlockTimeoutMs ?? 800;
  const sequenced = options.sequenced ?? [];

  const setOne = async (id: string, value: unknown): Promise<FieldOutcome> => {
    const field = options.fields().find((item) => item.id === id);
    if (!field) {
      throw new Error(`表单没有字段「${id}」；可用字段见 form.fields[].id`);
    }
    // 先看界面的锁，再看静态只读 —— 顺序与用户点不动的原因一致
    const lock = options.fieldLock(id);
    if (lock) {
      return {ok: false, message: `未设置「${field.label}」：${lock}`};
    }
    if (field.readOnly) {
      return {
        ok: false,
        message: `未设置「${field.label}」：它是只读的，${field.readOnlyReason ?? '当前状态下不可修改'}`,
      };
    }

    const special = sequenced.find((item) => item.id === id);
    if (special) return await special.run(value);

    const normalized = normalizeFieldValue(field, value);
    if (!normalized.ok) {
      return {
        ok: false,
        message: `未设置「${field.label}」= ${JSON.stringify(value)}：${normalized.reason}`,
      };
    }
    options.write({[id]: normalized.value});
    return {ok: true, message: `已设置「${field.label}」= ${describeValue(field, normalized.value)}`};
  };

  /**
   * 批量写入。
   *
   * 判断逐字段做（锁 / 只读 / 取值），写入只做一次 —— 这是「一趟设多个字段」的关键。
   * 回执逐项说清：成功的只列字段名（模型知道自己传了什么），失败的点名原因；
   * 同一句原因按字段归组，否则十几个字段被同一把锁挡住会输出十几行一样的句子。
   */
  const writeMany = async (entries: FieldEntry[], unknownKeys: string[]): Promise<string> => {
    const written: string[] = [];
    const notes: string[] = [];
    const skipped: string[] = [];
    /** 没设进去的字段数：与 skipped 的条目数不同 —— 同一条原因会被合并成一句 */
    let skippedCount = 0;
    const skip = (message: string, count = 1) => {
      skipped.push(message);
      skippedCount += count;
    };

    unknownKeys.forEach((key) => skip(`「${key}」表单里没有这个字段`));

    // 1) 顺序字段：按界面顺序（订单号 → 业务员），它们决定其余字段能不能改
    let unlockPending = false;
    for (const special of sequenced) {
      const hit = entries.find((entry) => entry.field.id === special.id);
      if (!hit) continue;
      const outcome = await setOne(special.id, hit.value);
      if (outcome.ok) {
        written.push(hit.field.label);
        // 完整的回执（检测结果、带出了谁）单独留着：那几句是下一步要用的信息
        notes.push(outcome.message);
        if (special.unlocksOthers) unlockPending = true;
      } else {
        skip(outcome.message);
      }
    }

    // 2) 其余字段：先逐个判断，能写的一次性写进去
    const writable: FieldEntry[] = [];
    entries
      .filter((entry) => !sequenced.some((item) => item.id === entry.field.id))
      .forEach((entry) => {
        if (entry.field.readOnly) {
          skip(
            `「${entry.field.label}」是只读的，${entry.field.readOnlyReason ?? '当前状态下不可修改'}`,
          );
          return;
        }
        writable.push(entry);
      });

    if (writable.length > 0) {
      const unlocked = unlockPending
        ? await waitForUnlock(options, writable, timeoutMs)
        : writable.every((entry) => options.fieldLock(entry.field.id) === null);

      if (!unlocked) {
        // 如实说清卡在哪：模型据此决定「先去设那个能解锁的字段」还是「请用户手动开锁」
        const byReason = new Map<string, string[]>();
        writable.forEach((entry) => {
          const reason = options.fieldLock(entry.field.id) ?? '界面还没解锁';
          const labels = byReason.get(reason) ?? [];
          labels.push(entry.field.label);
          byReason.set(reason, labels);
        });
        byReason.forEach((labels, reason) => {
          skip(`${summarizeLabels(labels)}：${reason}`, labels.length);
        });
      } else {
        const patch: Record<string, unknown> = {};
        writable.forEach((entry) => {
          const normalized = normalizeFieldValue(entry.field, entry.value);
          if (!normalized.ok) {
            skip(`「${entry.field.label}」= ${JSON.stringify(entry.value)}：${normalized.reason}`);
            return;
          }
          patch[entry.field.id] = normalized.value;
          written.push(entry.field.label);
        });
        if (Object.keys(patch).length > 0) options.write(patch);
      }
    }

    const lines: string[] = [];
    if (written.length > 0) {
      lines.push(`已一次设置 ${written.length} 项：${summarizeLabels(written)}`);
    }
    lines.push(...notes);
    if (skippedCount > 0) {
      lines.push(`未设置 ${skippedCount} 项：${skipped.join('；')}`);
    }
    return lines.join('\n') || '没有可设置的字段';
  };

  const setMany = async (params: Record<string, unknown>): Promise<string> => {
    // 模型把 form.set 的写法照搬到批量上（field + value）时也认，只当一项处理
    if (
      params.values === undefined &&
      params.fields === undefined &&
      typeof params.field === 'string' &&
      'value' in params
    ) {
      return (await setOne(params.field, params.value)).message;
    }

    const resolved = resolveFieldEntries(params.values ?? params.fields, options.fields());
    if (!resolved) {
      throw new Error(
        '需要 values：{ 字段id: 新值 }（对象，或它的 JSON 字符串），字段 id 见 form.fields[].id；' +
          '例如 {"YPDate":"2026-11-01","WorkPlace":"越南工厂"}',
      );
    }
    if (resolved.entries.length === 0 && resolved.unknownKeys.length === 0) {
      throw new Error('values 是空的，没有可设置的字段');
    }
    return await writeMany(resolved.entries, resolved.unknownKeys);
  };

  return {fields: options.fields, setOne, setMany};
}

/**
 * 改字段的两条命令。
 *
 * 有批量就不该再有「一次只改一个」的主路径 —— `form.set` 留着是为了两种场景：
 * 先确认订单号能不能用（一次只想动一个），或者只想改一处。
 * 参数声明与写入实现在同一份约定里，页面不用自己写那段 hint。
 */
export function createFormWriteActions(fields: FormFieldSpec[]): UIAction[] {
  const exampleId = fields[0]?.id;
  return [
    {
      id: 'form.setMany',
      label: '一次性设置多个字段',
      group: 'form',
      params: [
        {
          name: 'values',
          type: 'object',
          required: true,
          hint:
            '字段 id → 新值的对象（也接受它的 JSON 字符串），例如 ' +
            '{"YPDate":"2026-11-01","WorkPlace":"越南工厂"}。字段 id 见 form.fields[].id。' +
            '**一次传齐，不要一个字段调一次**；需要检测或带出其它值的字段也可以一起给，' +
            '会先按界面顺序处理它们、再写其余字段',
        },
      ],
    },
    {
      id: 'form.set',
      label: '设置单个字段',
      group: 'form',
      params: [
        {
          name: 'field',
          type: 'text',
          required: true,
          hint: `字段 id，见 form.fields[].id${exampleId ? `，例如 ${exampleId}` : ''}`,
        },
        {name: 'value', type: 'text', hint: '新值；日期用 YYYY-MM-DD'},
      ],
    },
  ];
}

/** 与 `createFormWriteActions` 配套的处理函数：两条命令的参数解析都在这里，页面只接 writer */
export function createFormWriteHandlers(writer: FormWriter): Record<string, UIBridgeHandler> {
  return {
    'form.setMany': (params) => writer.setMany(params),
    'form.set': async (params) => {
      const field = String(params.field ?? '').trim();
      if (!field) {
        throw new Error('需要 field（字段 id，见 form.fields[].id）与 value');
      }
      const outcome = await writer.setOne(field, params.value);
      return outcome.message;
    },
  };
}
