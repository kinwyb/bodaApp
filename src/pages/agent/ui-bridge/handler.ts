/**
 * 处理服务端下发的界面请求（ui.request）。
 *
 * 契约：每条请求恰好调用一次 respond。**失败也要回** —— 服务端在同步等待回执，
 * 不回答就是超时，模型只会看到「超时」而不知道「为什么不行」。
 *
 * 三个操作：
 * - observe   合成当前快照：工作台给导航，页面给自己的那一段
 * - act       执行当前页面的命令（必须带 rev）；回什么**由桥比对新旧快照自己定**
 *             （结构变了 full、什么都没变 result、否则 patch），页面的 `returns` 只是覆盖
 * - navigate  打开/切换页面，等目标页就绪再回执；只给 query 则只搜菜单、不导航
 */

import type {
  UIActionReturn,
  UIDataSummary,
  UIField,
  UIFieldPatch,
  UIForm,
  UIFormPatch,
  UINavItem,
  UIRequestPayload,
  UISnapshot,
  UISnapshotData,
  UISnapshotPatch,
  UITablePatch,
} from '../protocol';
import { stableStringify } from '@/utils';
import { UI_SNAPSHOT_VERSION } from '../protocol';
import type { AgentUIRequest } from '../transport';
import {
  anchorOf,
  bumpRev,
  currentRev,
  getDialogHost,
  getPageHost,
  setAnchor,
  getWorkbenchHost,
} from './store';
import type { UIBridgeHost, UIDialogHost, UIWorkbenchHost } from './types';

/** 没有业务页面时快照里的 view 标识（对应 MainLayout 的工作台页签） */
const HOME_VIEW = 'home';

/** 等目标页面就绪的上限：超时必须明确失败，不能让模型一直挂着 */
const NAVIGATE_TIMEOUT_MS = 5000;
/** 操作后等页面就绪的上限：这里等不到不算失败（动作本身已经执行了），只是快照可能不够新 */
const ACT_READY_TIMEOUT_MS = 3000;
/** 就绪轮询间隔 */
const READY_POLL_MS = 50;
/** observe 一次最多带多少条导航：菜单上百项，每次全量下发纯浪费，完整检索走 ui_navigate 的 query */
const NAVIGATION_LIMIT = 50;
/** 菜单搜索结果上限 */
const NAVIGATION_MATCH_LIMIT = 20;

/**
 * 回执的三种形态（见协议的 `UIActionReturn`）：
 * - `result` 只回 result：纯读，或「执行完状态与上次发出去的一模一样」
 * - `patch`  回 result + 变化的那几段（默认档）
 * - `full`   回 result + 整页快照：模型手里那份已经看不懂现在这页了
 *
 * 谁定的：命令自己声明的 `returns` 优先（那是页面作者的明确意图）；
 * 没声明就由 `decideReceipt` 比对新旧快照的指纹得出 —— 页面正常不用写。
 */
type UIActionMode = UIActionReturn;

/** 还没盖结构指纹的快照（composeSnapshot 先拼内容、最后一次性算 fp） */
type SnapshotContent = Omit<UISnapshot, 'fp'>;

/** 创建请求处理器，交给 transport.onUIRequest 订阅 */
export function createUIRequestHandler(): (request: AgentUIRequest) => void {
  return (request) => {
    void answer(request);
  };
}

async function answer(request: AgentUIRequest): Promise<void> {
  const workbench = getWorkbenchHost();
  if (!workbench) {
    request.respond({ ok: false, error: '界面桥没有接入工作台（MainLayout 未注册）' });
    return;
  }

  try {
    if (request.payload.op === 'observe') {
      const view = currentViewOf(workbench);
      const snapshot = composeSnapshot(workbench, view);
      // 整页快照发出去就等于重新锚定：之后所有补丁都以这一份为基准
      rememberFull(view, snapshot);
      request.respond({
        ok: true,
        rev: currentRev(view),
        snapshot,
      });
      return;
    }

    if (request.payload.op === 'navigate') {
      const outcome = await runNavigate(workbench, request.payload);
      const snapshot = composeSnapshot(workbench, outcome.view);
      rememberFull(outcome.view, snapshot);
      request.respond({
        ok: true,
        rev: currentRev(outcome.view),
        result: outcome.result,
        snapshot,
      });
      return;
    }

    const view = currentViewOf(workbench);
    const pageHost = getPageHost(view);
    const dialogHost = getDialogHost(view);
    if (!pageHost && !dialogHost) {
      throw new Error(
        `当前是${view === HOME_VIEW ? '工作台主页' : `页面 ${view}`}，没有可执行的命令；` +
          '请先用 ui_navigate 打开目标页面',
      );
    }
    const outcome = await runAction(view, request.payload);
    /*
     * 命令显式声明了 `returns: 'result'`（纯读）就到此为止：**不推版本、不等落定、不回状态**。
     *
     * 翻页读数据是 agent 最频繁的动作（一次几十上百条），如果每次带一份整页快照：
     * - 上下文被同一份「目录」反复冲刷；
     * - rev 被推进，模型下一次读还得先重新 observe，一条命令变两条。
     * 产出本来就在 result 里，快照帮不上忙。这一档也是唯一值得页面动手声明的：
     * 不声明也行（桥 diff 出来同样是「什么都没变」），但那就白等一趟页面落定。
     */
    if (outcome.declared === 'result') {
      request.respond({ ok: true, rev: currentRev(view), result: outcome.value ?? null });
      return;
    }

    // 命令执行过了就推进版本：回执里带着新 rev，模型下一条命令直接用它
    bumpRev(view);
    /*
     * 等这次操作真正落定再取快照。
     *
     * 很多动作是异步的：打开编辑弹窗要先把订单拉回来、改筛选条件要等接口返回。
     * 不等的话，回执里的快照是「操作刚发出去」的样子 —— 编辑弹窗里字段全空，
     * 模型会以为这单本来就是空白的。等不到不算失败（动作确实执行了），只是快照未必够新。
     */
    await waitForReady(view, ACT_READY_TIMEOUT_MS);
    await settleBeforeSnapshot();
    const base = { ok: true as const, rev: currentRev(view), result: outcome.value ?? null };
    const receipt = decideReceipt(view, composeSnapshot(workbench, view), outcome.declared);

    if (receipt.mode === 'full') {
      request.respond({ ...base, snapshot: receipt.snapshot });
      return;
    }
    if (receipt.mode === 'patch') {
      request.respond({ ...base, patch: receipt.patch });
      return;
    }
    // 执行完状态与上次发出去的那份一模一样：没什么可合并的，只回一句执行结果
    request.respond(base);
  } catch (error) {
    const view = currentViewOf(workbench);
    const patch = buildSnapshotPatch(workbench, view);
    request.respond({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      rev: currentRev(view),
      /*
       * 失败也带上页面此刻的变化：错误往往只存在于状态里（表单红格、明细校验），
       * 不回过去的话模型得再 observe 一次才看得到「到底哪里不对」，中间还会自我怀疑。
       * 但回的是**补丁**：失败时结构不会变（弹窗没开成、页面没切走），
       * 而一份整页快照恰恰是这条回执里最贵、也最没用的部分。
       * 取状态本身失败就省略它 —— 回执必须发出去，不能因为附赠信息再炸一次。
       */
      patch,
    });
  }
}

/** 尽力而为地取快照：任何异常都吞掉，返回 undefined（回执优先） */
function trySnapshot(workbench: UIWorkbenchHost, view: string): UISnapshot | undefined {
  try {
    return composeSnapshot(workbench, view);
  } catch {
    return undefined;
  }
}

/**
 * 回执补丁：**只取快照里真正会变的那几段**。
 *
 * 这里仍然会生成一份完整快照 —— 那是浏览器侧的计算（不占 token），
 * 取值、行数、排序、字段锁、命令可用性都得从它里面取；发给模型的只有变了的那几段。
 */
function buildSnapshotPatch(
  workbench: UIWorkbenchHost,
  view: string,
): UISnapshotPatch | undefined {
  const snapshot = trySnapshot(workbench, view);
  if (!snapshot) return undefined;
  const patch = toSnapshotPatch(snapshot, structureKey(snapshot));
  // 补丁发出去就算重新锚定：模型会把它合并进手里那份，下一次 diff 以这份为准
  setAnchor(view, { structure: patch.basedOn, dynamic: dynamicKey(patch) });
  return patch;
}

/** 完整快照 → 补丁：目录类内容（columns / guide / params / label / type）一概不带 */
function toSnapshotPatch(snapshot: SnapshotContent, structure: string): UISnapshotPatch {
  const patch: UISnapshotPatch = {
    view: snapshot.view,
    // 模型拿它对一下手里那份快照的 fp，对不上就该重新 observe
    basedOn: structure,
    // 命令可用性跟着状态变（选中了才亮），而它比整张动作表小一个数量级
    enabled: snapshot.actions.filter((item) => !item.disabled).map((item) => item.id),
  };
  if (snapshot.mode) patch.mode = snapshot.mode;
  if (snapshot.selection) patch.selection = snapshot.selection;

  /*
   * 弹窗那一层的补丁就是表单本身：字段值、锁、报错。
   * 此时 filters / data 被弹窗挡住（full 快照里也是置空的），补丁不重复表达「看不见」。
   */
  if (snapshot.form) {
    patch.form = toFormPatch(snapshot.form);
    return patch;
  }

  if (snapshot.filters && snapshot.filters.length > 0) {
    patch.filters = snapshot.filters.map(toFieldPatch);
  }
  if (snapshot.data) patch.data = toTablePatch(snapshot.data, snapshot.selection?.activeRowId ?? null);
  if (snapshot.tables && snapshot.tables.length > 0) {
    patch.tables = snapshot.tables.map((table) => toTablePatch(table));
  }
  return patch;
}

/**
 * 一次命令的回执：形态 + 要发出去的那份状态。
 *
 * `declared` 是命令自己声明的 `returns`（覆盖），没有就按下面的规则算。
 */
type Receipt = {
  mode: UIActionMode;
  snapshot?: UISnapshot;
  patch?: UISnapshotPatch;
};

/**
 * **这条命令该回什么，由桥比对新旧快照得出**（页面正常不用声明 `returns`）：
 *
 * 1. 从没给过这一页完整快照（`anchorOf` 为空）→ `full`：模型手里什么都没有。
 * 2. 结构指纹变了（换了视野：开弹窗、切模式、命令表或列目录变了）→ `full`：
 *    模型手里那份已经解释不了现在这页，只给补丁它就照着旧目录推理。
 * 3. 结构没变、而补丁要说的内容与上次发出去的**一字不差** → `result`：没什么可合并的。
 * 4. 其余 → `patch`。
 *
 * 命令显式声明过 `returns` 就以它为准（`result` 还能让桥省掉等页面落定那一趟）。
 * 声明成 `patch` 但其实结构变了也不会有人拦着：那种补丁的 `basedOn` 与模型手里那份的
 * `fp` 对不上，模型自己会去 observe —— 指纹就是给这种误用兜底的。
 */
function decideReceipt(
  view: string,
  snapshot: UISnapshot,
  declared: UIActionReturn | null,
): Receipt {
  const structure = structureKey(snapshot);
  const patch = toSnapshotPatch(snapshot, structure);
  const dynamic = dynamicKey(patch);
  const anchor = anchorOf(view);
  const mode: UIActionMode =
    declared ??
    (anchor === null || anchor.structure !== structure
      ? 'full'
      : anchor.dynamic === dynamic
        ? 'result'
        : 'patch');
  // 无论发的是哪一种，模型合并之后看到的就是这一份（result 时两者本就相同）
  setAnchor(view, { structure, dynamic });
  if (mode === 'full') return { mode, snapshot };
  if (mode === 'patch') return { mode, patch };
  return { mode };
}

/** 发整页快照（observe / navigate）等于重新锚定：之后的补丁都以这一份为基准 */
function rememberFull(view: string, snapshot: UISnapshot): void {
  const structure = structureKey(snapshot);
  setAnchor(view, { structure, dynamic: dynamicKey(toSnapshotPatch(snapshot, structure)) });
}

/**
 * 结构指纹：这份快照里「模型必须先知道、补丁才有意义」的那部分。
 *
 * 只算目录类内容 —— 命令的 `disabled` / 字段的取值 / 行数排序都不在这里，
 * 它们是补丁要表达的东西，进了指纹就等于每条命令都要重发整页快照。
 * `navigation` 也算结构：补丁表达不了菜单变化，菜单一变就得给 full。
 */
function structureKey(snapshot: SnapshotContent): string {
  const tables = [snapshot.data, ...(snapshot.tables ?? [])].filter(
    (table): table is UIDataSummary => table !== null && table !== undefined,
  );
  return hash8(
    stableStringify({
      view: snapshot.view,
      title: snapshot.title,
      mode: snapshot.mode,
      guide: snapshot.guide,
      navigation: snapshot.navigation,
      actions: snapshot.actions.map((item) => ({
        id: item.id,
        label: item.label,
        group: item.group,
        danger: item.danger,
        params: item.params,
      })),
      filterSchema: (snapshot.filters ?? []).map(fieldSchema),
      tableSchema: tables.map((table) => ({
        name: table.name,
        rowKey: table.rowKey,
        columns: table.columns,
      })),
      formSchema: snapshot.form
        ? { id: snapshot.form.id, fields: snapshot.form.fields.map(fieldSchema) }
        : null,
    }),
  );
}

/** 字段的目录类内容（取值、锁、报错属于变化段，不进这里） */
function fieldSchema(field: UIField): Record<string, unknown> {
  return {
    id: field.id,
    label: field.label,
    type: field.type,
    options: field.options,
    required: field.required,
    hint: field.hint,
  };
}

/** 变化段指纹：补丁要发的内容一字不差时，这一档就退化成一句执行结果 */
function dynamicKey(patch: UISnapshotPatch): string {
  const { view: _view, basedOn: _basedOn, ...rest } = patch;
  return hash8(stableStringify(rest));
}

/**
 * FNV-1a（32 位）取 8 位十六进制。
 *
 * 只用于「这两份结构是否相同」，不当校验和用：碰撞的后果是多一次或少一次 full，
 * 而这里比对的输入最多几千字符，8 位 hex 的碰撞概率足够低。
 */
function hash8(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** 表格段里会变的是行数、排序、分组、统计行位置、激活行；列目录不变（它属于 full） */
function toTablePatch(table: UIDataSummary, activeRowId?: string | null): UITablePatch {
  const patch: UITablePatch = {
    name: table.name,
    total: table.total,
    loaded: table.loaded,
    sorts: table.sorts,
    grouped: table.grouped,
  };
  if (table.summaryRow !== undefined) patch.summaryRow = table.summaryRow;
  /*
   * 激活行只给「行号 + 主键」，不给整条记录：一份 active 是 52 个键，
   * 而它变化的那一刻模型往往只想知道「现在选中的是谁」，完整一行用 `<name>.row` 取。
   */
  if (table.activeRowIndex !== undefined) {
    patch.activeRowIndex = table.activeRowIndex;
    if (activeRowId !== undefined) patch.activeRowId = activeRowId;
  }
  return patch;
}

/** 表单段里会变的是模式、脏标记、报错与每个字段的取值 / 锁 / 报错 */
function toFormPatch(form: UIForm): UIFormPatch {
  const patch: UIFormPatch = {
    id: form.id,
    title: form.title,
    mode: form.mode,
    recordId: form.recordId,
    fields: form.fields.map(toFieldPatch),
  };
  if (form.errors.length > 0) patch.errors = form.errors;
  if (form.dirty !== undefined) patch.dirty = form.dirty;
  return patch;
}

/** 字段 → 补丁形状：只留给值、锁与报错（label / type / options 属于目录） */
function toFieldPatch(field: UIField): UIFieldPatch {
  const patch: UIFieldPatch = { id: field.id, value: field.value ?? null };
  if (field.readOnly !== undefined) patch.readOnly = field.readOnly;
  if (field.errors && field.errors.length > 0) patch.errors = field.errors;
  return patch;
}

/** 当前激活页面的 view；停在主页时归一成 HOME_VIEW，便于按 view 取宿主与版本 */
function currentViewOf(workbench: UIWorkbenchHost): string {
  return workbench.currentView() || HOME_VIEW;
}

/**
 * 合成快照：工作台提供导航，业务页面提供自己那一段。
 *
 * 导航只在「没有业务页面」时给：已经在某个业务页里时，模型要的是这页能做什么，
 * 而不是再列一遍菜单（token 花在这上面不值）。
 */
function composeSnapshot(workbench: UIWorkbenchHost, view: string): UISnapshot {
  const base = baseSnapshot(workbench, view);
  const dialog = getDialogHost(view);
  /*
   * `fp` 是结构指纹（发给模型时带上，补丁的 `basedOn` 就是它）。
   * 两个分支各先拼内容再算：指纹只覆盖目录类字段，多算一次不占 token。
   */
  if (!dialog) {
    const content: SnapshotContent = {
      v: UI_SNAPSHOT_VERSION,
      rev: currentRev(base.view),
      ts: Date.now(),
      ...base,
    };
    return { ...content, fp: structureKey(content) };
  }

  /*
   * 弹窗打开时，它才是用户此刻的视野：动作、模式、form 段都换成弹窗自己的，
   * 列表的筛选条件与数据收起（它们被弹窗挡住，发出去只会让模型对着看不见的内容推理）。
   * 这条覆盖规则写在桥里，所以页面和弹窗都不用各自实现一遍。
   */
  const content: SnapshotContent = {
    v: UI_SNAPSHOT_VERSION,
    rev: currentRev(base.view),
    ts: Date.now(),
    view: base.view,
    title: base.title,
    mode: 'form',
    guide: dialog.guide ?? base.guide,
    actions: dialog.actions(),
    filters: [],
    selection: base.selection,
    data: null,
    form: dialog.snapshot(),
  };
  return { ...content, fp: structureKey(content) };
}

/** 页面自己那一段：页面宿主，或工作台主页的两条兜底 */
function baseSnapshot(workbench: UIWorkbenchHost, view: string): UISnapshotData {
  const pageHost = getPageHost(view);
  if (pageHost) return pageHost.snapshot();
  if (view === HOME_VIEW) {
    return {
      view: HOME_VIEW,
      title: '工作台',
      actions: [],
      data: null,
      navigation: workbench.navigation().slice(0, NAVIGATION_LIMIT),
    };
  }
  // 页面存在但没接入界面桥（例如通用列表页）：如实说明，别伪装成主页，
  // 否则排查起来会以为是导航出了问题
  return {
    view,
    title: `${view}（该页面还没接入界面桥）`,
    actions: [],
    data: null,
    navigation: workbench.navigation().slice(0, NAVIGATION_LIMIT),
  };
}

/** 执行一条命令；任何不满足的前置条件都抛成模型可读的原因 */
async function runAction(
  view: string,
  payload: UIRequestPayload,
): Promise<{ declared: UIActionReturn | null; value: unknown }> {
  const cmd = payload.cmd ?? '';
  if (!cmd) {
    throw new Error('缺少命令 ID');
  }
  if (payload.rev !== undefined && payload.rev !== currentRev(view)) {
    throw new Error(
      `页面状态已变化（快照 rev=${payload.rev}，当前 rev=${currentRev(view)}），请重新 ui_observe`,
    );
  }

  const dialog = getDialogHost(view);
  const pageHost = getPageHost(view);
  if (!dialog && !pageHost) {
    throw new Error('当前页面已经切换，请重新 ui_observe');
  }
  // 动作表与处理函数都跟着「此刻是谁的视野」走：弹窗打开时查弹窗，否则查页面
  const actions = dialog ? dialog.actions() : (pageHost?.snapshot().actions ?? []);
  const action = actions.find((item) => item.id === cmd);
  if (!action) {
    throw new Error(`命令不可用：${cmd}。请以最近一次 ui_observe 返回的 actions[].id 为准`);
  }
  if (action.disabled) {
    throw new Error(`命令 ${cmd} 当前不可执行：${action.disabledReason ?? '页面状态不允许'}`);
  }

  const run = dialog?.handlers[cmd] ?? pageHost?.handlers?.[cmd];
  if (!run) {
    throw new Error(`命令 ${cmd} 还没有接入处理函数`);
  }
  const value = await run(payload.params ?? {});
  // 这里只把命令**自己声明的**档位带出去（可能是 undefined = 交给桥 diff），
  // 真正决定回什么在 decideReceipt —— 别在这里补默认值，一补就又把 diff 变成摆设。
  return { declared: action.returns ?? null, value };
}

/** 打开页面（或在只给 query 时搜菜单），返回落点 view 与给模型看的结果 */
async function runNavigate(
  workbench: UIWorkbenchHost,
  payload: UIRequestPayload,
): Promise<{ view: string; result: unknown }> {
  const view = payload.view?.trim() ?? '';
  const query = payload.query?.trim() ?? '';

  if (!view) {
    if (!query) {
      throw new Error('需要提供 view（要打开的页面）或 query（按名称搜索可用页面）');
    }
    const matches = searchNavigation(workbench, query);
    if (matches.length === 0) {
      throw new Error(
        `没有匹配「${query}」的页面（名称不存在、当前账号无权访问，或该页面还没接入界面桥 —— ` +
          '没接入的页面 agent 既看不到内容也执行不了命令，所以不在检索范围里）',
      );
    }
    return {
      view: currentViewOf(workbench),
      result: { matches, hint: '选定后用它对应的 view 打开' },
    };
  }

  const target = workbench.navigation().find((item) => item.view === view);
  if (!target) {
    /*
     * 两种失败原因分开说，排查方向完全不同：
     * 菜单里没有 = 账号没权限 / View 写错；菜单里有 = 这页没接入界面桥。
     * 混成一句话，人会跑去查权限，而真正要做的是给那个目录补 bridged.ts。
     */
    if (workbench.canOpen && !workbench.canOpen(view)) {
      throw new Error(
        `页面不可用：${view}（不在当前账号可见的菜单里）。可以先用 ui_navigate 的 query 搜索页面名`,
      );
    }
    throw new Error(
      `页面 ${view} 还没接入界面桥：agent 既看不到它的内容、也执行不了它的命令，` +
        '所以不会出现在可导航清单里。可以在 ui_navigate 的 query 里搜别的页面名',
    );
  }

  workbench.openView(view);
  if (!(await waitForReady(view, NAVIGATE_TIMEOUT_MS))) {
    throw new Error(
      `打开页面超时（${NAVIGATE_TIMEOUT_MS}ms 内未就绪）：页面可能加载失败，` +
        '或它声明了 bridged.ts 却没有真正注册界面桥（useUIBridgeHost 没执行）',
    );
  }
  return { view, result: `已打开：${target.title}` };
}

/** 按名称模糊搜菜单：菜单大起来之后，这是模型唯一需要的检索入口 */
function searchNavigation(workbench: UIWorkbenchHost, query: string): UINavItem[] {
  const keyword = query.toLowerCase();
  return workbench
    .navigation()
    .filter(
      (item) =>
        item.title.toLowerCase().includes(keyword) ||
        item.view.toLowerCase().includes(keyword) ||
        (item.trail ?? []).some((name) => name.toLowerCase().includes(keyword)),
    )
    .slice(0, NAVIGATION_MATCH_LIMIT);
}

/**
 * 等页面自报就绪（`ready()`），超时返回 false。
 *
 * 页面是懒加载组件、打开后还要拉数据，弹窗打开后也可能在等接口 ——
 * 不等就回执，模型拿到的是「刚发出操作」那一刻的空视图，然后开始怀疑自己。
 * 页面没实现 ready() 视为挂载即就绪。
 */
async function waitForReady(view: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (readyNow(view)) return true;
    if (Date.now() >= deadline) return false;
    await delay(READY_POLL_MS);
  }
}

/** 此刻该等谁就绪：弹窗打开时是弹窗（编辑要先把数据拉回来），否则是页面 */
function readyNow(view: string): boolean {
  const host: UIBridgeHost | UIDialogHost | null = getDialogHost(view) ?? getPageHost(view);
  if (!host) return false;
  return host.ready?.() ?? true;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 让这次操作引起的渲染先落定，再取快照。
 *
 * 尽力而为，不保证 100%：命令可能是异步的（例如改完筛选条件要等接口返回），
 * 只有页面自己知道何时算落定。所以模型要权威状态时，重新 ui_observe 一次总是安全的。
 */
function settleBeforeSnapshot(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') return Promise.resolve();
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
