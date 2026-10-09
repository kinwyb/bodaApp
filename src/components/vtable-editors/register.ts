import {register} from '@visactor/vtable';
import {
    AntdInputEditor,
    AntdInputNumberEditor,
    AntdSelectEditor,
    type AntdInputEditorProps,
    type AntdInputNumberEditorProps,
    type AntdSelectEditorProps,
    type EditorValidator,
    type IEditor,
} from './antd-editors.tsx';

/**
 * antd 编辑器的注册入口
 *
 * VTable 的列配置只认「已注册的编辑器名」（字符串），所以任何要用 antd 控件的列，
 * 都必须先在这里 register 一次，再通过 editableFields / 列配置的 editor 引用名字。
 * antd-editors.tsx 只提供控件类，注册与命名放在这一层。
 *
 * 第三个参数 validator 是**提交前校验**：返回提示文案就拦住这次提交 —— 值不会写进表格，
 * 输入框标红并把文案贴在下方，用户改对之前退不出编辑态（想放弃按 ESC）。
 *
 * ⚠️ 注册表是全局的，且**同名幂等、先注册者生效**：要给不同字段配不同校验，
 * 必须各自注册一个具名实例（参考 V0280 的 `preorder-detail-<字段名>`），
 * 别复用 ANTD_INPUT_EDITOR 这类公共名 —— 否则带校验的那次注册会被静默忽略。
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
 * @param validator 提交前校验，返回文案即拦住提交；不传则不做校验
 */
export function registerAntdInputEditor(
    name: string = ANTD_INPUT_EDITOR,
    props: AntdInputEditorProps = {},
    validator?: EditorValidator<string>,
): void {
    registerOnce(name, new AntdInputEditor(props, validator));
}

/**
 * 注册数字编辑器
 * @param name 编辑器名，默认 ANTD_NUMBER_EDITOR
 * @param props 透传给 antd InputNumber 的配置（min / max / precision 等）
 * @param validator 提交前校验，返回文案即拦住提交；不传则不做校验
 */
export function registerAntdNumberEditor(
    name: string = ANTD_NUMBER_EDITOR,
    props: AntdInputNumberEditorProps = {},
    validator?: EditorValidator<number | null>,
): void {
    registerOnce(name, new AntdInputNumberEditor(props, validator));
}

/**
 * 注册下拉编辑器
 * @param name 编辑器名，默认 ANTD_SELECT_EDITOR
 * @param props 透传给 antd Select 的配置（必须给 options，否则是空下拉）
 * @param validator 提交前校验，返回文案即拦住提交；不传则不做校验
 */
export function registerAntdSelectEditor(
    name: string = ANTD_SELECT_EDITOR,
    props: AntdSelectEditorProps = {},
    validator?: EditorValidator<unknown>,
): void {
    registerOnce(name, new AntdSelectEditor(props, validator));
}

/** 一次注册三个基础编辑器（默认名字、不带额外约束与校验），幂等 */
export function registerAntdEditors(): void {
    registerAntdInputEditor();
    registerAntdNumberEditor();
    registerAntdSelectEditor();
}
