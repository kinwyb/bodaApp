import {
  cloneElement,
  createElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactElement,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DatePicker, Input, InputNumber, Select } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { DATE_FORMAT, toDayjs, toNumberOrNull } from '@/utils';

// ─── VTable IEditor 接口（与 @visactor/vtable-editors 保持兼容） ──────────────

export interface EditContext<V = any> {
  container: HTMLElement;
  referencePosition: {
    rect: { left: number; top: number; width: number; height: number };
  };
  value: V;
  endEdit: () => void;
  table: any;
  col: number;
  row: number;
}

/**
 * validateValue 的返回值：`true` = 放行（值提交进表格并退出编辑），
 * `false` = 拦下并**留在编辑态**（值不写进表格，用户改对才能出去）。
 *
 * 没有用 VTable 那套 `'validate-not-exit'` 字符串枚举：它以 enum 声明，是标称类型，
 * 字符串字面量赋不进去（`register.editor` 会报 TS2345）。而运行时 `false` 与它走的是
 * 同一个分支 —— 见 `es/edit/edit-manager.js` 的 `dealWithValidateValue`：
 * `false` 落到最后那个兜底分支、`'validate-not-exit'` 走它自己的分支，两者都是
 * `resolve(false)` 且返回 false，即**都不退出编辑**。
 *
 * 用 `false` 还省掉一个依赖：`ValidateEnum` 只在 `@visactor/vtable-editors` 里，
 * 而那是 vtable 自己的依赖，不属于本项目的直接依赖。
 */
export type ValidateValueResult = boolean;

/**
 * 编辑器值校验：返回提示文案表示**不通过**（会拦住这次提交），返回 undefined 表示通过。
 *
 * 与表格的整行校验共用同一份规则，避免「编辑器拦一套、保存校验另一套」两边漂移。
 *
 * 第二个参数是**当前编辑行**的访问器 —— 与 onStart / onCommit / onEnd 拿到的是同一个口，
 * 所以规则里可以读本行其他字段，例如「某列填了，这一列就必填」：
 *
 * ```ts
 * validator: (value, row) =>
 *     isBlank(value) && !isBlank(row.getField('StyleCode')) ? '款式编码填了，描述也要填' : undefined
 * ```
 *
 * ⚠️ 它只看得到**本行**：
 * - `row.getField()` 读的是**编辑前**的值（本次的新值在第一个参数 `value` 里）；
 * - 查重、尺码合计这类**跨行 / 跨字段**规则在这里判不了，放整表校验
 *   （`services/yupai.ts` 的 `validateYupaiOrderDetailRows`），别两处各写一份。
 *
 * 也可以返回 **Promise**（异步校验，例如要去后端查这个值是否已被占用）：
 *
 * ```ts
 * validator: async (value) => (await api.exists(value) ? '该编码已被占用' : undefined)
 * ```
 *
 * vtable 原生支持（`IEditor.validateValue` 的类型就是
 * `boolean | ValidateEnum | Promise<boolean | ValidateEnum>`，`completeEdit` 里有 `isPromise` 分支）：
 * 等待期间它会用 `isValidatingValue` 挡住重复触发，所以**用户等结果时反复点别处不会重复调接口**；
 * 结果回来后才决定提交还是留在编辑态 —— 不会出现「值先写进去、后来才发现不合法」。
 * 等待期间界面上显示「校验中…」（`setPending`）。
 */
export type EditorValidator<V = any> = (
  value: V,
  row: EditorRowAccessor,
) => string | undefined | Promise<string | undefined>;

export interface IEditor<V = any> {
  onStart: (context: EditContext<V>) => void;
  onEnd: () => void;
  getValue: () => V;
  /**
   * 退出编辑前的校验。VTable 的 edit-manager 在 completeEdit（失焦 / 回车 / 点到别处）时调它，
   * 拿到的就是 getValue() 的值 —— 即「值提交进表格之前」的最后一道闸。
   *
   * 可以返回 Promise（异步校验）：edit-manager 的 completeEdit 里有 `isPromise` 分支，
   * 会等它 resolve 再决定退出还是留在编辑态，等待期间用 `isValidatingValue` 挡重复触发。
   */
  validateValue?: (
    newValue?: V,
    oldValue?: V,
    position?: unknown,
    table?: unknown,
    isClickOnTable?: boolean,
  ) => ValidateValueResult | Promise<ValidateValueResult>;
  isEditorElement?: (target: HTMLElement) => boolean;
  getInputElement?: () => HTMLElement;
}

// ─── 编辑器行访问：所有编辑器共享的「当前行」读写口 ──────────────────────────

/**
 * 正在编辑的那一行的读写口 —— 注册编辑器时通过 validator / onStart / onCommit / onEnd 拿到，
 * 四个钩子拿到的都是这一个口。
 *
 * 这是本项目所有 antd 编辑器共用的能力（Input / InputNumber / Select / DatePicker 都一样），
 * 用来解决两类需求：
 *
 * - 读：校验规则要参考本行其他字段（`validator` 的第二个参数）；
 * - 写：「选一行数据、把它的字段填进本行其他列」——
 *   Input + onSearch 打开用户列表弹窗，选完把姓名/部门填回本行；
 *   Select 的选项本身是一张表的行，选中后带出款式名称、面料等字段。
 *
 * 不需要在页面里另外维护 `value -> 整行` 的字典，也不需要自己查表格坐标。
 *
 * ⚠️ 只在**编辑期间**有效：编辑器 onEnd 之后（用户提交或按 ESC 放弃）访问器失效，
 * 写入会被静默忽略，拿 `record` 会得到 undefined。弹窗这类异步流程要在 onStart 里
 * 存下访问器、onEnd 里清掉，别长期持有。
 */
export interface EditorRowAccessor {
  /** 当前编辑行的原始记录（就是表格数据源里那一个对象，VTable 编辑时也改它） */
  readonly record: Record<string, unknown> | undefined;
  /** 数据行下标（不含表头）；拿不到时为 null，此时写入不生效 */
  readonly recordIndex: number | null;
  /**
   * 读本行某一列。
   *
   * 读的是**编辑前**的值 —— 这一格的新值还没写进表格，它在 validator 的第一个参数 /
   * onCommit 的 `payload.value` 里。别拿它跟当前输入比对，会永远差一格。
   */
  getField: (field: string) => unknown;
  /** 写本行某一列 */
  setField: (field: string, value: unknown) => void;
  /** 一次写本行多列；值为 undefined 的字段跳过（不拿它把本行冲成空） */
  setFields: (fields: Record<string, unknown>) => void;
  /**
   * 结束本次编辑 —— 等价于用户点到别处（照样会走 validateValue）。
   * 「弹窗选完就收工」的场景用它，免得编辑态与回填的数据对不上。
   */
  endEdit: () => void;
}

/** 提交时回传给业务的上下文（各控件给的东西不一样） */
export interface EditorCommitPayload<V = unknown> {
  /** 本次提交的值 */
  value: V;
  /** 只有 Select 类控件有：被选中的那个 option 对象本身（原始行挂在上面即可取到） */
  option?: Record<string, unknown>;
}

/**
 * 编辑器的扩展能力，注册时一次性给定（编辑器实例是全局共享的，同名幂等）。
 *
 * 三个钩子拿到的都是 EditorRowAccessor，可以在里面直接改本行其他列 ——
 * 写回走的是表格的 changeCellValueByRecord，**会照常派发 change_cell_value**，
 * 所以页面 onCellValueChange 那份 records 会自动跟着更新，页面侧不用改任何东西。
 */
export interface EditorOptions<V = unknown> {
  /**
   * 提交前校验，返回文案即拦住提交；不传则不做校验。
   *
   * 签名 `(value, row)` —— `value` 是本次要提交的值，`row` 是当前编辑行（只能读本行，
   * 跨行规则请放整表校验）。
   */
  validator?: EditorValidator<V>;
  /**
   * 进入编辑、拿到本行之后调用。
   * 需要「编辑期间异步回填」的场景（如 Input 的 onSearch 打开弹窗），
   * 在这里把访问器存到页面闭包里，等用户选完再写回。
   */
  onStart?: (row: EditorRowAccessor) => void;
  /** 提交时（校验通过后）调用 */
  onCommit?: (payload: EditorCommitPayload<V>, row: EditorRowAccessor) => void;
  /** 编辑结束时调用，含按 ESC 放弃的那种（此时 onCommit 不会走） */
  onEnd?: (row: EditorRowAccessor) => void;
}

// ─── 工具类型：从 antd 组件 Props 中排除受控属性 ────────────────────────────

type OmitControlled<P> = Omit<P, 'value' | 'onChange' | 'defaultValue'>;

/**
 * Input 编辑器的 props。
 *
 * 在 antd `Input` 的基础上多了一个 `onSearch`：antd 只有 `Input.Search` 才有这个事件，
 * 普通 `Input` 是没有的。传了它就渲染成 `Input.Search`（自带搜索按钮），
 * 用来做「回车 / 点搜索图标 → 打开选择弹窗」这类交互。
 *
 * 只想要回车触发、不希望多一个搜索按钮的话，用 antd 原生的 `onPressEnter` 即可
 * （那是普通 Input 的能力，照常透传）。
 */
export type AntdInputEditorProps = OmitControlled<
  ComponentProps<typeof Input>
> & {
  /** 回车或点搜索图标时触发；**传了它就渲染 `Input.Search`** */
  onSearch?: (value: string) => void;
};

export type AntdInputNumberEditorProps = OmitControlled<
  ComponentProps<typeof InputNumber>
>;
export type AntdSelectEditorProps = OmitControlled<ComponentProps<typeof Select>>;

// ─── 内部：受控包装组件 ──────────────────────────────────────────────────────

/**
 * 校验提示条：贴在输入框下方，允许溢出单元格。
 *
 * wrapper 没有设 overflow，所以能显示到格子外面；pointerEvents 关掉是为了不挡住
 * 表格的双击 / 右键（提示只看不点）。
 */
const ERROR_TIP_STYLE: CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  marginTop: 2,
  padding: '2px 6px',
  background: '#fff2f0',
  border: '1px solid #ffccc7',
  borderRadius: 4,
  color: '#cf1322',
  fontSize: 12,
  lineHeight: '18px',
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
};

/**
 * 异步校验进行中的提示条：**中性配色**（不是错误）。
 *
 * 去后端查一次可能几百毫秒到几秒，不给反馈用户会以为「点了没反应」；
 * 用错误红又像是已经判错了，所以灰底灰字。
 */
const PENDING_TIP_STYLE: CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  marginTop: 2,
  padding: '2px 6px',
  background: '#fafafa',
  border: '1px solid #f0f0f0',
  borderRadius: 4,
  color: '#8c8c8c',
  fontSize: 12,
  lineHeight: '18px',
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
};

/**
 * 将 antd 组件包装为受控组件：
 * - 首次渲染时将 initialValue 写入 valueRef
 * - onChange 统一处理 Input（ChangeEvent）和 InputNumber/Select（直接值）两种签名
 * - 通过 forceUpdate 触发重渲染，保持组件受控且不丢失焦点
 * - 额外承载校验提示：errorRef 里有文案时把控件标红并显示提示条
 */
function EditorShell({
  element,
  initialValue,
  valueRef,
  optionRef,
  errorRef,
  pendingRef,
  onRerender,
}: {
  element: ReactElement;
  initialValue: unknown;
  valueRef: { current: unknown };
  /**
   * 受控控件 onChange 的**第二个**参数（Select 才会给，就是被选中的那个 option 本身）。
   * 只在需要「选中项带出其他字段」的编辑器上传，其余不传。
   */
  optionRef?: { current: unknown };
  /** 校验失败的提示文案（由编辑器类在 validateValue 里写入） */
  errorRef: { current: string | undefined };
  /** 异步校验进行中（显示「校验中…」） */
  pendingRef?: { current: boolean };
  /** 把「触发重渲染」的出口交给编辑器类，用于把校验结果刷到界面上 */
  onRerender?: (rerender: () => void) => void;
}) {
  const [, forceUpdate] = useState(0);
  const mounted = useRef(false);

  useEffect(() => {
    onRerender?.(() => forceUpdate((n) => n + 1));
  }, [onRerender]);

  if (!mounted.current) {
    valueRef.current = initialValue;
    mounted.current = true;
  }

  const handleChange = useCallback(
    (newValue: unknown, extra?: unknown) => {
      // Input 的 onChange 传 ChangeEvent，取 target.value
      // InputNumber / Select 的 onChange 直接传值
      const isChangeEvent =
        newValue !== null &&
        typeof newValue === 'object' &&
        'target' in newValue;
      const resolved = isChangeEvent
        ? (newValue as { target: { value: unknown } }).target.value
        : newValue;
      valueRef.current = resolved;
      // Select 会多给一个「选中的 option」，联动要用它带出的原始行
      if (optionRef) optionRef.current = extra;
      forceUpdate((n) => n + 1);
    },
    [valueRef, optionRef],
  );

  const error = errorRef.current;
  const pending = pendingRef?.current === true;
  const injectedProps = {
    value: valueRef.current,
    onChange: handleChange,
    autoFocus: true,
    style: { width: '100%', height: '100%', boxSizing: 'border-box' as const },
    // 校验没过时把控件本身也标红（Input / InputNumber / Select 都吃 status）；
    // 「校验中」不标红，等结果回来再说
    ...(error ? { status: 'error' as const } : {}),
  };

  return (
    <>
      {cloneElement(element, injectedProps as Record<string, unknown>)}
      {error ? (
        <div style={ERROR_TIP_STYLE}>{error}</div>
      ) : pending ? (
        <div style={PENDING_TIP_STYLE}>校验中…</div>
      ) : null}
    </>
  );
}

// ─── 校验：三个编辑器共用的部分 ──────────────────────────────────────────────

/**
 * 与 vtable 的 `isPromise`（`es/tools/helper.js`）同款判断：有 `then` 就当 Promise。
 * 不用 `instanceof Promise` —— 业务可能返回别的 thenable（或跨 realm 的 Promise）。
 */
function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return Boolean(
    value != null && typeof (value as { then?: unknown }).then === 'function',
  );
}

/**
 * 编辑器通用的校验执行：把结果落到错误态上，并给出 VTable 要的返回值。
 *
 * 不通过时返回 `false` —— 值不写进表格、编辑态也不退出，
 * 用户改对之前点哪都没用（想放弃就按 ESC，见 bindEscapeToCancel）。
 *
 * `row` 是当前编辑行的访问器，会一起交给业务的 validator ——
 * 这样规则除了拿到 `value`，还能读本行其他字段。
 *
 * 业务返回 Promise 时**原样把它交给 VTable**：edit-manager 的 completeEdit 有 `isPromise`
 * 分支，会等它 resolve 再 `dealWithValidateValue`，等待期间 `isValidatingValue` 为真、
 * 重复的 completeEdit 直接被挡掉（省得我们自己做防重入）。我们只负责两件事：
 * - 等待期间挂上 `pending`（界面上显示「校验中…」）；
 * - **永不 reject** —— reject 会让 vtable 把异常抛给 completeEdit 的调用方，
 *   所以失败一律按「校验不通过」处理（留在编辑态 + 提示）。
 */
function runValidator(
  validator: EditorValidator | undefined,
  value: unknown,
  row: EditorRowAccessor,
  setError: (message: string | undefined) => void,
  setPending: (pending: boolean) => void,
): ValidateValueResult | Promise<ValidateValueResult> {
  const result = validator?.(value, row);

  if (!isPromiseLike(result)) {
    setError(result);
    // 有提示文案 = 不通过：拦下这次提交并留在编辑态
    return !result;
  }

  // 新一轮校验：先把上一轮的结论清掉，否则会顶着上一条错误文案等结果（用户以为又错了）
  setError(undefined);
  setPending(true);
  return Promise.resolve(result).then(
    (message) => {
      setPending(false);
      setError(message);
      return !message;
    },
    (error: unknown) => {
      setPending(false);
      setError(error instanceof Error ? error.message : '校验失败，请重试');
      return false;
    },
  );
}

/**
 * 让 ESC 成为「放弃编辑」的出口。
 *
 * 没有它的话，值校验不过时用户就被困在编辑态了：点哪都会触发一次 completeEdit、
 * 都会被拦下来（edit-manager 自己不看 Escape，扫描过 es/edit 目录，里面没有键盘处理）。
 *
 * 「怎么放弃」交给调用方在 `onCancel` 里做（见 `BaseAntdEditor.cancelEdit`）——
 * 关键是**光置一次「跳过校验」不够**：completeEdit 走完流程照样会把 `getValue()`
 * 写进单元格（实测过：输入非法值按 ESC，非法值真的进了表格）。
 */
function bindEscapeToCancel(
  wrapper: HTMLElement,
  onCancel: () => void,
  /** 本次 ESC 是否真的算「放弃编辑」；不传就一律算（Select 用它挡掉『关下拉』那一下） */
  shouldCancel?: () => boolean,
): void {
  wrapper.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (shouldCancel && !shouldCancel()) return;
    event.stopPropagation();
    onCancel();
  });
}

// ─── 定位容器 ────────────────────────────────────────────────────────────────

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function createWrapper(
  container: HTMLElement,
  rect: Rect,
): { wrapper: HTMLDivElement; root: Root } {
  const wrapper = document.createElement('div');
  wrapper.style.cssText =
    `position:absolute;` +
    `left:${rect.left}px;top:${rect.top}px;` +
    `width:${rect.width}px;height:${rect.height}px;` +
    `z-index:10000;background:#fff;padding:0;box-sizing:border-box;`;
  container.appendChild(wrapper);
  return { wrapper, root: createRoot(wrapper) };
}

// ─── 从编辑上下文里解析「本行」 ──────────────────────────────────────────────

/**
 * 当前编辑单元格对应的**数据行下标**（不含表头）。
 *
 * 编辑器 context 里的 col/row 是 VTable 坐标（含表头行），不能直接当 recordIndex 用；
 * 交给表格自己换算，合并单元格时它是数组，取第一个。
 * 拿不到（坐标异常 / 表格不支持）返回 null，调用方据此放弃写回。
 */
function resolveRecordIndex(context: EditContext<unknown>): number | null {
  const table = context.table;
  if (!table || typeof table.getRecordIndexByCell !== 'function') return null;
  const index = table.getRecordIndexByCell(context.col, context.row);
  const recordIndex = Array.isArray(index) ? index[0] : index;
  return typeof recordIndex === 'number' && recordIndex >= 0 ? recordIndex : null;
}

/**
 * 当前编辑行对应的原始记录对象。
 *
 * 用的就是 edit-manager 自己取行数据的那个方法（见 `es/edit/edit-manager.js` 的
 * startEditCell：`this.table.getCellRawRecord(col, row)`），拿到的正是数据源里的
 * record 对象 —— 也就是页面 records 数组里那一个，改它等于改页面的数据。
 *
 * 数据源异步时这个方法可能返回 Promise，那种情况当作拿不到（返回 undefined）。
 */
function resolveRecord(
  context: EditContext<unknown>,
): Record<string, unknown> | undefined {
  const table = context.table;
  if (!table || typeof table.getCellRawRecord !== 'function') return undefined;
  const record = table.getCellRawRecord(context.col, context.row);
  if (!record || typeof record !== 'object') return undefined;
  if (typeof (record as { then?: unknown }).then === 'function') return undefined;
  return record as Record<string, unknown>;
}

// ─── 基础编辑器：三个 antd 编辑器共用的骨架 ──────────────────────────────────

/**
 * antd 编辑器基类：把 onStart / onEnd / 校验 / ESC / 行访问这些**与控件无关**的流程
 * 收在一处，子类只需要回答三件事 —— 用什么控件、初始值怎么归一化、
 * ESC 算不算放弃（Select 需要挡掉「关下拉」那一下）。
 *
 * 四个钩子（validator / onStart / onCommit / onEnd）拿到的都是 EditorRowAccessor，
 * 所以校验规则能读本行其他字段，提交与收尾时能 setField / setFields 改本行其他列。
 */
export abstract class BaseAntdEditor<V = unknown> implements IEditor<V> {
  /** 注册时给定的扩展能力（校验 + 生命周期钩子），全局共享 */
  protected readonly options: EditorOptions<V>;
  /** 受控值：控件 onChange 后写它，VTable 提交时由 getValue 读走 */
  protected readonly valueRef: { current: unknown } = { current: undefined };
  /** Select 类控件 onChange 的第二个参数（选中的 option），只有 acceptsOption 为真时收集 */
  protected readonly optionRef: { current: unknown } = { current: undefined };
  /** 校验失败的提示文案；undefined 表示通过 */
  private readonly errorRef: { current: string | undefined } = { current: undefined };
  /** 异步校验进行中（界面上显示「校验中…」） */
  private readonly pendingRef: { current: boolean } = { current: false };
  /** 触发一次重渲染（由 EditorShell 注册进来），用来把校验提示刷到界面上 */
  private rerender: (() => void) | null = null;
  /** ESC 放弃编辑时置位，让这一次 completeEdit 跳过校验（见 cancelEdit） */
  private readonly skipNextValidation: { current: boolean } = { current: false };
  /** 进入编辑时的原值：ESC 放弃时用它还原，别让当前值被写进表格 */
  private readonly initialValueRef: { current: unknown } = { current: undefined };
  private readonly endEditRef: { current: (() => void) | null } = { current: null };
  /** 以下三样只在编辑期间有效，onEnd 里一并清掉 */
  private readonly tableRef: { current: any } = { current: null };
  private readonly recordIndexRef: { current: number | null } = { current: null };
  private readonly recordRef: { current: Record<string, unknown> | undefined } = {
    current: undefined,
  };
  protected wrapper: HTMLDivElement | null = null;
  private root: Root | null = null;

  constructor(options: EditorOptions<V> = {}) {
    this.options = options;
  }

  /** 子类：创建受控的 antd 控件（不要自己接 value/onChange，由 EditorShell 注入） */
  protected abstract createControl(): ReactElement;

  /** 子类：把单元格原值归一化成控件的初始值 */
  protected abstract toInitialValue(value: unknown): unknown;

  /** 子类：ESC 是否算「放弃编辑」，默认算 */
  protected shouldCancelOnEscape(_wrapper: HTMLElement): boolean {
    return true;
  }

  /** 子类：是否需要收下 onChange 的第二个参数（只有 Select 有这个概念） */
  protected acceptsOption(): boolean {
    return false;
  }

  private setError = (message: string | undefined): void => {
    this.errorRef.current = message;
    this.rerender?.();
  };

  private setPending = (pending: boolean): void => {
    this.pendingRef.current = pending;
    this.rerender?.();
  };

  /**
   * 放弃本次编辑（ESC）：把值还原成进入编辑时的原值，再跳过校验走完 completeEdit。
   *
   * 为什么不能只「跳过校验」：completeEdit 走完流程后照样会 `getValue()` 并写进单元格，
   * 那样 ESC 实际是「绕过校验强行提交」（实测过：输入非法值按 ESC，非法值真的进了表格）。
   * 还原成原值之后 doExit 写回的就是原值，而且 `oldValue === changedValue`，
   * vtable 不会派发 `change_cell_value` —— 页面 state 天然不受影响。
   */
  private cancelEdit(): void {
    // 校验等待期间按 ESC 也算放弃：pending 一并清掉
    this.setPending(false);
    this.valueRef.current = this.initialValueRef.current;
    this.skipNextValidation.current = true;
    this.rerender?.();
    this.endEditRef.current?.();
  }

  onStart(context: EditContext<V>): void {
    const { container, referencePosition, value } = context;
    const { wrapper, root } = createWrapper(container, referencePosition.rect);
    this.wrapper = wrapper;
    this.root = root;
    // 每次开始编辑都清掉上一轮的状态，否则会跟着残留下来
    this.errorRef.current = undefined;
    this.pendingRef.current = false;
    this.skipNextValidation.current = false;
    this.optionRef.current = undefined;
    // 记下原值：ESC 放弃时还原用它（见 cancelEdit）
    this.initialValueRef.current = value;
    this.endEditRef.current = context.endEdit;
    this.tableRef.current = context.table;
    this.recordIndexRef.current = resolveRecordIndex(context);
    this.recordRef.current = resolveRecord(context);
    bindEscapeToCancel(
      wrapper,
      () => this.cancelEdit(),
      () => this.shouldCancelOnEscape(wrapper),
    );
    root.render(
      <EditorShell
        element={this.createControl()}
        initialValue={this.toInitialValue(value)}
        valueRef={this.valueRef}
        optionRef={this.acceptsOption() ? this.optionRef : undefined}
        errorRef={this.errorRef}
        pendingRef={this.pendingRef}
        onRerender={(rerender) => {
          this.rerender = rerender;
        }}
      />,
    );
    this.options.onStart?.(this.createRow());
  }

  validateValue(newValue?: V): ValidateValueResult | Promise<ValidateValueResult> {
    if (this.skipNextValidation.current) {
      this.skipNextValidation.current = false;
      return true;
    }
    const validated = runValidator(
      this.options.validator,
      newValue,
      this.createRow(),
      this.setError,
      this.setPending,
    );
    if (isPromiseLike(validated)) {
      // 异步校验：把 Promise 交给 vtable（它会等结果再决定退出还是留在编辑态，
      // 等待期间挡住重复触发）。业务回调也跟着延后到结果回来之后。
      return validated.then((passed) => {
        if (passed) this.commit(newValue);
        return passed;
      });
    }
    // 校验通过才回调：ESC 与校验失败都提前 return 了，业务不会拿到「半截」的提交
    if (validated) this.commit(newValue);
    return validated;
  }

  /** 校验通过后回调业务（异步校验时等结果回来才走） */
  private commit(value: V | undefined): void {
    this.options.onCommit?.(
      {
        value: value as V,
        option: this.optionRef.current as Record<string, unknown> | undefined,
      },
      this.createRow(),
    );
  }

  getValue(): V {
    return this.valueRef.current as V;
  }

  onEnd(): void {
    // 先把收尾钩子给业务（此时表格与行下标还都在）
    this.options.onEnd?.(this.createRow());
    this.rerender = null;
    // 异步校验可能还在飞：结果回来时编辑器已经收工，写回会被下面的清空挡掉，
    // 这里把「校验中」一并复位，免得下次进来带着上一轮的提示
    this.pendingRef.current = false;
    this.endEditRef.current = null;
    this.tableRef.current = null;
    this.recordIndexRef.current = null;
    this.recordRef.current = undefined;
    this.optionRef.current = undefined;

    // ⚠️ wrapper / root 不能在这里同步清理。
    //
    // 表格卸载时 React 清理 effect → `table.release()`，而 BaseTable.release() 的最后
    // 会调 `editorManager.editingEditor.onEnd()`（见 `es/core/BaseTable.js:1060`）——
    // 整条链都在 React 的渲染 / 提交过程中。此刻再同步 unmount 另一个 root，React 会报
    // 「Attempted to synchronously unmount a root while React was already rendering」。
    //
    // 推到微任务里做：那时当前这次渲染已经结束（执行上下文已出 Render/Commit 阶段），
    // 卸载就不会跟 React 打架。闭包里拿的是这一轮的实例，用户很快再次编辑也不会误删新的。
    const root = this.root;
    const wrapper = this.wrapper;
    this.root = null;
    this.wrapper = null;
    queueMicrotask(() => {
      root?.unmount();
      wrapper?.remove();
    });
  }

  isEditorElement(target: HTMLElement): boolean {
    return this.wrapper?.contains(target) ?? false;
  }

  getInputElement(): HTMLElement {
    return this.wrapper!;
  }

  /**
   * 本行访问器。每次调用都新造一个，但内部读的始终是编辑期间那几份引用，
   * 所以业务可以放心把它存起来（存到 onEnd 为止）。
   */
  protected createRow(): EditorRowAccessor {
    const record = this.recordRef.current;
    return {
      record,
      recordIndex: this.recordIndexRef.current,
      getField: (field: string) => record?.[field],
      setField: (field: string, value: unknown) => this.writeRow([[field, value]]),
      setFields: (fields: Record<string, unknown>) =>
        this.writeRow(Object.entries(fields).filter(([, value]) => value !== undefined)),
      endEdit: () => this.endEditRef.current?.(),
    };
  }

  /**
   * 把字段写回本行。
   *
   * 走 `table.changeCellValueByRecord` 而不是直接改 record 对象：它会照常派发
   * `change_cell_value`，页面 onCellValueChange 因此能拿到并同步自己的 records
   * （见 VTable.tsx 的 change_cell_value 处理）—— 直接改对象的话，数组引用没变，
   * 页面不会重渲染，改完只有表格自己知道。
   *
   * 逐列写时不刷新（autoRefresh: false），全部写完统一 refreshAfterSourceChange 一次：
   * 每次写都刷会把整表重绘好几遍。
   */
  private writeRow(entries: Array<[string, unknown]>): void {
    const table = this.tableRef.current;
    const recordIndex = this.recordIndexRef.current;
    if (!table || recordIndex === null || entries.length === 0) return;
    entries.forEach(([field, value]) => {
      table.changeCellValueByRecord(
        recordIndex,
        field,
        (value ?? null) as string | number | null,
        { autoRefresh: false },
      );
    });
    table.refreshAfterSourceChange?.();
  }
}

// ─── AntdInputEditor ─────────────────────────────────────────────────────────

export class AntdInputEditor extends BaseAntdEditor<string> {
  private props: AntdInputEditorProps;

  constructor(props: AntdInputEditorProps = {}, options: EditorOptions<string> = {}) {
    super(options);
    this.props = props;
  }

  protected createControl(): ReactElement {
    const { onSearch, ...inputProps } = this.props;
    // 传了 onSearch 就换成 antd 的 Input.Search —— 普通 Input 没有 onSearch 事件，
    // 直接透传只会得到一个「永远不触发」的属性
    if (onSearch) {
      return createElement(Input.Search, {
        ...inputProps,
        allowClear: true,
        onSearch: (value: string) => onSearch(value),
      } as ComponentProps<typeof Input.Search>) as ReactElement;
    }
    return createElement(Input, { ...this.props, allowClear: true }) as ReactElement;
  }

  protected toInitialValue(value: unknown): unknown {
    return !value ? '' : String(value);
  }
}

// ─── AntdInputNumberEditor ───────────────────────────────────────────────────

export class AntdInputNumberEditor extends BaseAntdEditor<number | null> {
  private props: AntdInputNumberEditorProps;

  constructor(
    props: AntdInputNumberEditorProps = {},
    options: EditorOptions<number | null> = {},
  ) {
    super(options);
    this.props = props;
  }

  protected createControl(): ReactElement {
    return createElement(InputNumber, {
      ...this.props,
      controls: false,
    }) as ReactElement;
  }

  protected toInitialValue(value: unknown): unknown {
    return toNumberOrNull(value);
  }
}

// ─── AntdSelectEditor：把数据值对齐到 options 的 value 类型 ──────────────────

/** 从 antd Select 的 options（含分组）里收集所有 value */
function collectOptionValues(options: unknown): unknown[] {
  if (!Array.isArray(options)) return [];
  const values: unknown[] = [];
  const walk = (list: unknown[]) => {
    list.forEach((item) => {
      if (!item || typeof item !== 'object') return;
      const option = item as { value?: unknown; options?: unknown };
      if (option.value !== undefined) values.push(option.value);
      if (Array.isArray(option.options)) walk(option.options);
    });
  };
  walk(options);
  return values;
}

/**
 * 把数据里的值对齐到 options 的 value 类型，业务侧不必关心两边类型是否一致：
 * 先全等匹配，再按字符串比较（数据可能是 '2'，而 options 里写的是 2，或反之）。
 * 找不到匹配、或 options 尚未加载时原样返回（antd 会退回显示原值本身）。
 */
function alignToOptionValue(value: unknown, options: unknown): unknown {
  const values = collectOptionValues(options);
  if (values.length > 0) {
    const exact = values.find((item) => item === value);
    if (exact !== undefined) return exact;
    const loose =
      value === null || value === undefined || value === ''
        ? undefined
        : values.find((item) => String(item) === String(value));
    if (loose !== undefined) return loose;
  }
  // 空值交给 antd 显示 placeholder；不在候选项里的值原样返回，不做类型转换
  if (value === null || value === undefined || value === '') return undefined;
  return value;
}

export class AntdSelectEditor extends BaseAntdEditor<unknown> {
  private props: AntdSelectEditorProps;

  constructor(props: AntdSelectEditorProps = {}, options: EditorOptions<unknown> = {}) {
    super(options);
    this.props = props;
  }

  protected createControl(): ReactElement {
    return createElement(Select, {
      showSearch: true,
      getPopupContainer: (trigger: HTMLElement) =>
        trigger.parentElement || document.body,
      ...this.props,
    }) as ReactElement;
  }

  protected toInitialValue(value: unknown): unknown {
    return alignToOptionValue(value, this.props.options);
  }

  /** Select 才有「选中的 option」这个概念，onCommit 拿它带出整行 */
  protected acceptsOption(): boolean {
    return true;
  }

  /** ESC 在下拉展开时是「关下拉」，不该顺带把编辑也取消掉 */
  protected shouldCancelOnEscape(wrapper: HTMLElement): boolean {
    return wrapper.querySelector('.ant-select-open') == null;
  }

  isEditorElement(target: HTMLElement): boolean {
    // antd Select 下拉弹层渲染在 wrapper 外，需额外判断
    return super.isEditorElement(target) || target.closest('.ant-select-dropdown') != null;
  }
}

// ─── AntdDatePickerEditor：日期值在「字符串」与「dayjs」之间转换 ──────────────

/**
 * 日期编辑器的 props。
 *
 * 在 antd `DatePicker` 的基础上多了一个 `valueFormat`。
 *
 * **表格里存的是日期字符串，控件要的是 dayjs**，两边转换由编辑器负责（业务不用管）：
 * - 进编辑：`toDayjs(单元格值)` —— 空值 / 后端的 `0001-01-01` 占位都会变成「没选」；
 * - 提交时：把 dayjs 按 `valueFormat`（默认 `DATE_FORMAT`）格式化成字符串，空则给空串。
 *
 * 要「日期 + 时间」就同时给 `showTime` 和 `valueFormat`（如 `'YYYY-MM-DD HH:mm:ss'`）——
 * 只给 `showTime` 的话写回表格的值会被截到日（默认格式只到天）。
 */
export type AntdDatePickerEditorProps = OmitControlled<
  ComponentProps<typeof DatePicker>
> & {
  /** 写回表格的日期格式，默认 `DATE_FORMAT`（YYYY-MM-DD） */
  valueFormat?: string;
};

export class AntdDatePickerEditor extends BaseAntdEditor<string> {
  private props: AntdDatePickerEditorProps;
  /** 面板是否展开：展开时 ESC 只该关面板，别顺带把编辑也取消掉 */
  private panelOpenRef: { current: boolean } = { current: false };

  constructor(
    props: AntdDatePickerEditorProps = {},
    options: EditorOptions<string> = {},
  ) {
    super(options);
    this.props = props;
  }

  protected createControl(): ReactElement {
    const { onOpenChange, valueFormat, ...dateProps } = this.props;
    // valueFormat 是本编辑器自己的参数（提交时格式化用），别透传给 antd
    void valueFormat;
    // 每次开始编辑都重置：上一次编辑结束时面板要是没关干净，别把状态带进来
    this.panelOpenRef.current = false;
    return createElement(DatePicker, {
      // 面板挂在单元格里（与 Select 一致），点面板不会被当成「点到别处」
      getPopupContainer: (trigger: HTMLElement) =>
        trigger.parentElement || document.body,
      ...dateProps,
      // 面板开合自己也要知道：ESC 在面板展开时是「关面板」
      onOpenChange: (open: boolean) => {
        this.panelOpenRef.current = open;
        onOpenChange?.(open);
      },
    }) as ReactElement;
  }

  protected toInitialValue(value: unknown): unknown {
    return toDayjs(value);
  }

  /**
   * 覆盖基类的 getValue：控件里是 dayjs，表格里要字符串。
   *
   * 这个返回值就是「写进单元格的值」—— edit-manager 在 completeEdit 里取它当
   * changedValue，也把它传给 validateValue，所以校验规则拿到的也是字符串。
   */
  getValue(): string {
    // 直接读 valueRef：基类 getValue 的返回类型是 V（这里即 string），
    // 而控件里存的其实是 dayjs，类型对不上，不能走 super.getValue()
    const value = this.valueRef.current as Dayjs | null | undefined;
    if (!value || !dayjs.isDayjs(value)) return '';
    return value.format(this.props.valueFormat ?? DATE_FORMAT);
  }

  /** 面板展开时 ESC 是「关面板」，不该顺带把编辑也取消掉 */
  protected shouldCancelOnEscape(): boolean {
    return !this.panelOpenRef.current;
  }

  isEditorElement(target: HTMLElement): boolean {
    // 面板默认挂在单元格内（见 getPopupContainer）；业务把它改挂到 body 时靠这个兜底
    return super.isEditorElement(target) || target.closest('.ant-picker-dropdown') != null;
  }
}
