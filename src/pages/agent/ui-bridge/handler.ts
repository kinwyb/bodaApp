/**
 * 处理服务端下发的界面请求（ui.request）。
 *
 * 契约：每条请求恰好调用一次 respond。**失败也要回** —— 服务端在同步等待回执，
 * 不回答就是超时，模型只会看到「超时」而不知道「为什么不行」。
 *
 * 三个操作：
 * - observe   合成当前快照：工作台给导航，页面给自己的那一段
 * - act       执行当前页面的命令（必须带 rev）
 * - navigate  打开/切换页面，等目标页就绪再回执；只给 query 则只搜菜单、不导航
 */

import type { UINavItem, UIRequestPayload, UISnapshot, UISnapshotData } from '../protocol';
import { UI_SNAPSHOT_VERSION } from '../protocol';
import type { AgentUIRequest } from '../transport';
import { bumpRev, currentRev, getDialogHost, getPageHost, getWorkbenchHost } from './store';
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
      request.respond({
        ok: true,
        rev: currentRev(view),
        snapshot: composeSnapshot(workbench, view),
      });
      return;
    }

    if (request.payload.op === 'navigate') {
      const outcome = await runNavigate(workbench, request.payload);
      request.respond({
        ok: true,
        rev: currentRev(outcome.view),
        result: outcome.result,
        snapshot: composeSnapshot(workbench, outcome.view),
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
    const result = await runAction(view, request.payload);
    // 成功操作推进版本：下一次 observe 拿到新 rev，旧快照再拿来操作会被拒
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
    request.respond({
      ok: true,
      rev: currentRev(view),
      result: result ?? null,
      snapshot: composeSnapshot(workbench, view),
    });
  } catch (error) {
    const view = currentViewOf(workbench);
    request.respond({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      rev: currentRev(view),
      /*
       * 失败也带一份快照：错误往往只存在于页面状态里（表单红格、明细校验），
       * 不回快照的话模型得再 observe 一次才看得到「到底哪里不对」，中间还会自我怀疑。
       * 取快照本身失败就省略它 —— 回执必须发出去，不能因为附赠信息再炸一次。
       */
      snapshot: trySnapshot(workbench, view),
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
  if (!dialog) {
    return { v: UI_SNAPSHOT_VERSION, rev: currentRev(base.view), ts: Date.now(), ...base };
  }

  /*
   * 弹窗打开时，它才是用户此刻的视野：动作、模式、form 段都换成弹窗自己的，
   * 列表的筛选条件与数据收起（它们被弹窗挡住，发出去只会让模型对着看不见的内容推理）。
   * 这条覆盖规则写在桥里，所以页面和弹窗都不用各自实现一遍。
   */
  return {
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
async function runAction(view: string, payload: UIRequestPayload): Promise<unknown> {
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
  return await run(payload.params ?? {});
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
