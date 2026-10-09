import {
  cloneElement,
  createElement,
  useCallback,
  useRef,
  useState,
  type ComponentProps,
  type ReactElement,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Input, InputNumber, Select } from 'antd';

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

export interface IEditor<V = any> {
  onStart: (context: EditContext<V>) => void;
  onEnd: () => void;
  getValue: () => V;
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
 * 将 antd 组件包装为受控组件：
 * - 首次渲染时将 initialValue 写入 valueRef
 * - onChange 统一处理 Input（ChangeEvent）和 InputNumber/Select（直接值）两种签名
 * - 通过 forceUpdate 触发重渲染，保持组件受控且不丢失焦点
 */
function EditorShell({
  element,
  initialValue,
  valueRef,
}: {
  element: ReactElement;
  initialValue: unknown;
  valueRef: { current: unknown };
}) {
  const [, forceUpdate] = useState(0);
  const mounted = useRef(false);

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

  const injectedProps = {
    value: valueRef.current,
    onChange: handleChange,
    autoFocus: true,
    style: { width: '100%', height: '100%', boxSizing: 'border-box' as const },
  };

  return cloneElement(element, injectedProps as Record<string, unknown>);
}

/** 单元格里的数值可能是 ''、NaN 等非数值，统一归一化成 number | null 再交给 antd */
function toNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
  private wrapper: HTMLDivElement | null = null;
  private root: Root | null = null;
  private valueRef: { current: string } = { current: '' };

  constructor(props: AntdInputEditorProps = {}) {
    this.props = props;
  }

  onStart(context: EditContext<string>): void {
    const { container, referencePosition, value } = context;
    const { wrapper, root } = createWrapper(container, referencePosition.rect);
    this.wrapper = wrapper;
    this.root = root;
    root.render(
      <EditorShell
        element={createElement(Input, { ...this.props, allowClear: true })}
        initialValue={ !value ? '' : String(value)}
        valueRef={this.valueRef}
      />,
    );
  }

  getValue(): string {
    return this.valueRef.current;
  }

  onEnd(): void {
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
  private wrapper: HTMLDivElement | null = null;
  private root: Root | null = null;
  private valueRef: { current: number | null } = { current: null };

  constructor(props: AntdInputNumberEditorProps = {}) {
    this.props = props;
  }

  onStart(context: EditContext<number | null>): void {
    const { container, referencePosition, value } = context;
    const { wrapper, root } = createWrapper(container, referencePosition.rect);
    this.wrapper = wrapper;
    this.root = root;
    root.render(
      <EditorShell
        element={createElement(InputNumber, { ...this.props, controls: false })}
        initialValue={toNumberOrNull(value)}
        valueRef={this.valueRef}
      />,
    );
  }

  getValue(): number | null {
    return this.valueRef.current;
  }

  onEnd(): void {
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
  private wrapper: HTMLDivElement | null = null;
  private root: Root | null = null;
  private valueRef: { current: unknown } = { current: undefined };

  constructor(props: AntdSelectEditorProps = {}) {
    this.props = props;
  }

  onStart(context: EditContext<unknown>): void {
    const { container, referencePosition, value } = context;
    const { wrapper, root } = createWrapper(container, referencePosition.rect);
    this.wrapper = wrapper;
    this.root = root;
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
      />,
    );
  }

  getValue(): unknown {
    return this.valueRef.current;
  }

  onEnd(): void {
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
