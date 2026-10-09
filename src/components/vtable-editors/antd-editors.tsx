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
import { Input, InputNumber, Select } from 'antd';
import { toNumberOrNull } from '@/utils';

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
 * 在注册具名编辑器时传入（见 register.ts），与表格的整行校验共用同一份规则，
 * 避免「编辑器拦一套、保存校验另一套」两边漂移。
 */
export type EditorValidator<V = any> = (value: V) => string | undefined;

export interface IEditor<V = any> {
  onStart: (context: EditContext<V>) => void;
  onEnd: () => void;
  getValue: () => V;
  /**
   * 退出编辑前的校验。VTable 的 edit-manager 在 completeEdit（失焦 / 回车 / 点到别处）时调它，
   * 拿到的就是 getValue() 的值 —— 即「值提交进表格之前」的最后一道闸。
   */
  validateValue?: (
    newValue?: V,
    oldValue?: V,
    position?: unknown,
    table?: unknown,
    isClickOnTable?: boolean,
  ) => ValidateValueResult;
  isEditorElement?: (target: HTMLElement) => boolean;
  getInputElement?: () => HTMLElement;
}

// ─── 工具类型：从 antd 组件 Props 中排除受控属性 ────────────────────────────

type OmitControlled<P> = Omit<P, 'value' | 'onChange' | 'defaultValue'>;

export type AntdInputEditorProps = OmitControlled<ComponentProps<typeof Input>>;
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
  errorRef,
  onRerender,
}: {
  element: ReactElement;
  initialValue: unknown;
  valueRef: { current: unknown };
  /** 校验失败的提示文案（由编辑器类在 validateValue 里写入） */
  errorRef: { current: string | undefined };
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
    (newValue: unknown) => {
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
      forceUpdate((n) => n + 1);
    },
    [valueRef],
  );

  const error = errorRef.current;
  const injectedProps = {
    value: valueRef.current,
    onChange: handleChange,
    autoFocus: true,
    style: { width: '100%', height: '100%', boxSizing: 'border-box' as const },
    // 校验没过时把控件本身也标红（Input / InputNumber / Select 都吃 status）
    ...(error ? { status: 'error' as const } : {}),
  };

  return (
    <>
      {cloneElement(element, injectedProps as Record<string, unknown>)}
      {error ? <div style={ERROR_TIP_STYLE}>{error}</div> : null}
    </>
  );
}

// ─── 校验：三个编辑器共用的部分 ──────────────────────────────────────────────

/**
 * 编辑器通用的校验执行：把结果落到错误态上，并给出 VTable 要的返回值。
 *
 * 不通过时返回 `false` —— 值不写进表格、编辑态也不退出，
 * 用户改对之前点哪都没用（想放弃就按 ESC，见 bindEscapeToCancel）。
 */
function runValidator(
  validator: EditorValidator | undefined,
  value: unknown,
  setError: (message: string | undefined) => void,
): ValidateValueResult {
  const message = validator?.(value);
  setError(message);
  // 有提示文案 = 不通过：拦下这次提交并留在编辑态
  return !message;
}

/**
 * 让 ESC 成为「放弃编辑」的出口。
 *
 * 没有它的话，值校验不过时用户就被困在编辑态了：点哪都会触发一次 completeEdit、
 * 都会被拦下来（edit-manager 自己不看 Escape，扫描过 es/edit 目录，里面没有键盘处理）。
 *
 * 实现上不能直接拿 completeEdit 当取消用 —— context.endEdit 就是 completeEdit，
 * 调它照样会来问 validateValue。所以先置一次「跳过校验」的标记，再让它走完流程。
 */
function bindEscapeToCancel(
  wrapper: HTMLElement,
  skipRef: { current: boolean },
  endEditRef: { current: (() => void) | null },
  /** 本次 ESC 是否真的算「放弃编辑」；不传就一律算（Select 用它挡掉『关下拉』那一下） */
  shouldCancel?: () => boolean,
): void {
  wrapper.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (shouldCancel && !shouldCancel()) return;
    event.stopPropagation();
    skipRef.current = true;
    endEditRef.current?.();
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

// ─── AntdInputEditor ─────────────────────────────────────────────────────────

export class AntdInputEditor implements IEditor<string> {
  private props: AntdInputEditorProps;
  private validator?: EditorValidator<string>;
  private wrapper: HTMLDivElement | null = null;
  private root: Root | null = null;
  private valueRef: { current: string } = { current: '' };
  /** 校验失败的提示文案；undefined 表示通过 */
  private errorRef: { current: string | undefined } = { current: undefined };
  /** 触发一次重渲染（由 EditorShell 注册进来），用来把校验提示刷到界面上 */
  private rerender: (() => void) | null = null;
  /** ESC 放弃编辑时置位，让这一次 completeEdit 跳过校验 */
  private skipNextValidation: { current: boolean } = { current: false };
  private endEditRef: { current: (() => void) | null } = { current: null };

  constructor(props: AntdInputEditorProps = {}, validator?: EditorValidator<string>) {
    this.props = props;
    this.validator = validator;
  }

  private setError = (message: string | undefined): void => {
    this.errorRef.current = message;
    this.rerender?.();
  };

  onStart(context: EditContext<string>): void {
    const { container, referencePosition, value } = context;
    const { wrapper, root } = createWrapper(container, referencePosition.rect);
    this.wrapper = wrapper;
    this.root = root;
    // 每次开始编辑都清掉上一轮的提示，否则会跟着残留下来
    this.errorRef.current = undefined;
    this.skipNextValidation.current = false;
    this.endEditRef.current = context.endEdit;
    bindEscapeToCancel(wrapper, this.skipNextValidation, this.endEditRef);
    root.render(
      <EditorShell
        element={createElement(Input, { ...this.props, allowClear: true })}
        initialValue={ !value ? '' : String(value)}
        valueRef={this.valueRef}
        errorRef={this.errorRef}
        onRerender={(rerender) => {
          this.rerender = rerender;
        }}
      />,
    );
  }

  validateValue(newValue?: string): ValidateValueResult {
    if (this.skipNextValidation.current) {
      this.skipNextValidation.current = false;
      return true;
    }
    return runValidator(this.validator, newValue, this.setError);
  }

  getValue(): string {
    return this.valueRef.current;
  }

  onEnd(): void {
    this.rerender = null;
    this.endEditRef.current = null;
    this.root?.unmount();
    this.root = null;
    this.wrapper?.remove();
    this.wrapper = null;
  }

  isEditorElement(target: HTMLElement): boolean {
    return this.wrapper?.contains(target) ?? false;
  }

  getInputElement(): HTMLElement {
    return this.wrapper!;
  }
}

// ─── AntdInputNumberEditor ───────────────────────────────────────────────────

export class AntdInputNumberEditor implements IEditor<number | null> {
  private props: AntdInputNumberEditorProps;
  private validator?: EditorValidator<number | null>;
  private wrapper: HTMLDivElement | null = null;
  private root: Root | null = null;
  private valueRef: { current: number | null } = { current: null };
  private errorRef: { current: string | undefined } = { current: undefined };
  private rerender: (() => void) | null = null;
  private skipNextValidation: { current: boolean } = { current: false };
  private endEditRef: { current: (() => void) | null } = { current: null };

  constructor(
    props: AntdInputNumberEditorProps = {},
    validator?: EditorValidator<number | null>,
  ) {
    this.props = props;
    this.validator = validator;
  }

  private setError = (message: string | undefined): void => {
    this.errorRef.current = message;
    this.rerender?.();
  };

  onStart(context: EditContext<number | null>): void {
    const { container, referencePosition, value } = context;
    const { wrapper, root } = createWrapper(container, referencePosition.rect);
    this.wrapper = wrapper;
    this.root = root;
    this.errorRef.current = undefined;
    this.skipNextValidation.current = false;
    this.endEditRef.current = context.endEdit;
    bindEscapeToCancel(wrapper, this.skipNextValidation, this.endEditRef);
    root.render(
      <EditorShell
        element={createElement(InputNumber, { ...this.props, controls: false })}
        initialValue={toNumberOrNull(value)}
        valueRef={this.valueRef}
        errorRef={this.errorRef}
        onRerender={(rerender) => {
          this.rerender = rerender;
        }}
      />,
    );
  }

  validateValue(newValue?: number | null): ValidateValueResult {
    if (this.skipNextValidation.current) {
      this.skipNextValidation.current = false;
      return true;
    }
    return runValidator(this.validator, newValue, this.setError);
  }

  getValue(): number | null {
    return this.valueRef.current;
  }

  onEnd(): void {
    this.rerender = null;
    this.endEditRef.current = null;
    this.root?.unmount();
    this.root = null;
    this.wrapper?.remove();
    this.wrapper = null;
  }

  isEditorElement(target: HTMLElement): boolean {
    return this.wrapper?.contains(target) ?? false;
  }

  getInputElement(): HTMLElement {
    return this.wrapper!;
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

// ─── AntdSelectEditor ────────────────────────────────────────────────────────

export class AntdSelectEditor implements IEditor<unknown> {
  private props: AntdSelectEditorProps;
  private validator?: EditorValidator<unknown>;
  private wrapper: HTMLDivElement | null = null;
  private root: Root | null = null;
  private valueRef: { current: unknown } = { current: undefined };
  private errorRef: { current: string | undefined } = { current: undefined };
  private rerender: (() => void) | null = null;
  private skipNextValidation: { current: boolean } = { current: false };
  private endEditRef: { current: (() => void) | null } = { current: null };

  constructor(props: AntdSelectEditorProps = {}, validator?: EditorValidator<unknown>) {
    this.props = props;
    this.validator = validator;
  }

  private setError = (message: string | undefined): void => {
    this.errorRef.current = message;
    this.rerender?.();
  };

  onStart(context: EditContext<unknown>): void {
    const { container, referencePosition, value } = context;
    const { wrapper, root } = createWrapper(container, referencePosition.rect);
    this.wrapper = wrapper;
    this.root = root;
    this.errorRef.current = undefined;
    this.skipNextValidation.current = false;
    this.endEditRef.current = context.endEdit;
    // Select 有自己的 ESC 语义（关闭下拉），这时不能顺带把编辑也取消掉
    bindEscapeToCancel(wrapper, this.skipNextValidation, this.endEditRef, () =>
      wrapper.querySelector('.ant-select-open') == null,
    );
    root.render(
      <EditorShell
        element={createElement(Select, {
          showSearch: true,
          getPopupContainer: (trigger: HTMLElement) =>
            trigger.parentElement || document.body,
          ...this.props,
        })}
        initialValue={alignToOptionValue(value, this.props.options)}
        valueRef={this.valueRef}
        errorRef={this.errorRef}
        onRerender={(rerender) => {
          this.rerender = rerender;
        }}
      />,
    );
  }

  validateValue(newValue?: unknown): ValidateValueResult {
    if (this.skipNextValidation.current) {
      this.skipNextValidation.current = false;
      return true;
    }
    return runValidator(this.validator, newValue, this.setError);
  }

  getValue(): unknown {
    return this.valueRef.current;
  }

  onEnd(): void {
    this.rerender = null;
    this.endEditRef.current = null;
    this.root?.unmount();
    this.root = null;
    this.wrapper?.remove();
    this.wrapper = null;
  }

  isEditorElement(target: HTMLElement): boolean {
    if (this.wrapper?.contains(target)) return true;
    // antd Select 下拉弹层渲染在 wrapper 外，需额外判断
    return target.closest('.ant-select-dropdown') != null;
  }

  getInputElement(): HTMLElement {
    return this.wrapper!;
  }
}
