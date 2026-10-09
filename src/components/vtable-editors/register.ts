import {register} from '@visactor/vtable';
import {
    AntdInputEditor,
    AntdInputNumberEditor,
    AntdSelectEditor,
    type AntdInputEditorProps,
    type AntdInputNumberEditorProps,
    type AntdSelectEditorProps,
    type IEditor,
} from './antd-editors.tsx';

/**
 * antd 编辑器的注册入口
 *
 * VTable 的列配置只认「已注册的编辑器名」（字符串），所以任何要用 antd 控件的列，
 * 都必须先在这里 register 一次，再通过 editableFields / 列配置的 editor 引用名字。
 * antd-editors.tsx 只提供控件类，注册与命名放在这一层。
 */

/** 文本：单行输入框（Input） */
export const ANTD_INPUT_EDITOR = 'antd-input';
/** 数值：数字输入框（InputNumber，无步进按钮） */
export const ANTD_NUMBER_EDITOR = 'antd-number';
/** 枚举：下拉选择（Select，支持搜索） */
export const ANTD_SELECT_EDITOR = 'antd-select';

/** 已注册的编辑器名，同名只注册一次，避免重复 register 把带 props 的实例覆盖掉 */
const registered = new Set<string>();

function registerOnce(name: string, editor: IEditor) {
    if (registered.has(name)) return;
    register.editor(name, editor);
    registered.add(name);
}

/**
 * 注册文本编辑器
 * @param name 编辑器名，默认 ANTD_INPUT_EDITOR
 * @param props 透传给 antd Input 的配置（placeholder / maxLength 等）
 */
export function registerAntdInputEditor(
    name: string = ANTD_INPUT_EDITOR,
    props: AntdInputEditorProps = {},
): void {
    registerOnce(name, new AntdInputEditor(props));
}

/**
 * 注册数字编辑器
 * @param name 编辑器名，默认 ANTD_NUMBER_EDITOR
 * @param props 透传给 antd InputNumber 的配置（min / max / precision 等）
 */
export function registerAntdNumberEditor(
    name: string = ANTD_NUMBER_EDITOR,
    props: AntdInputNumberEditorProps = {},
): void {
    registerOnce(name, new AntdInputNumberEditor(props));
}

/**
 * 注册下拉编辑器
 * @param name 编辑器名，默认 ANTD_SELECT_EDITOR
 * @param props 透传给 antd Select 的配置（必须给 options，否则是空下拉）
 */
export function registerAntdSelectEditor(
    name: string = ANTD_SELECT_EDITOR,
    props: AntdSelectEditorProps = {},
): void {
    registerOnce(name, new AntdSelectEditor(props));
}

/** 一次注册三个基础编辑器（默认名字、不带额外约束），幂等 */
export function registerAntdEditors(): void {
    registerAntdInputEditor();
    registerAntdNumberEditor();
    registerAntdSelectEditor();
}
