import {register} from '@visactor/vtable';
import {
    AntdInputEditor,
    AntdInputNumberEditor,
    AntdSelectEditor,
    type AntdInputEditorProps,
    type AntdInputNumberEditorProps,
    type AntdSelectEditorProps,
    type EditorOptions,
    type IEditor,
} from './antd-editors.tsx';

/**
 * 业务侧只从这一层导入就够了：编辑器能力相关的类型都在这里转发，
 * 免得页面同时 import `./register` 与 `./antd-editors` 两个文件。
 * （`EditorOptions` 因为函数签名要用，单独导出本地的这份导入。）
 */
export type {
    EditContext,
    EditorCommitPayload,
    EditorRowAccessor,
    EditorValidator,
} from './antd-editors.tsx';
export type { EditorOptions };

/**
 * antd 编辑器的注册入口
 *
 * VTable 的列配置只认「已注册的编辑器名」（字符串），所以任何要用 antd 控件的列，
 * 都必须先在这里 register 一次，再通过 editableFields / 列配置的 editor 引用名字。
 * antd-editors.tsx 只提供控件类，注册与命名放在这一层。
 *
 * 第三个参数 options 是编辑器的扩展能力（见 antd-editors.tsx 的 EditorOptions）：
 * - `validator`：**提交前校验**。返回提示文案就拦住这次提交 —— 值不会写进表格，
 *   输入框标红并把文案贴在下方，用户改对之前退不出编辑态（想放弃按 ESC）。
 * - `onStart` / `onCommit` / `onEnd`：拿到「正在编辑的那一行」并直接改它。
 *   三个编辑器（Input / InputNumber / Select）**都有**这三个钩子，回调里拿到的是
 *   统一的 EditorRowAccessor —— 所以「选一行数据、把字段填进本行其他列」这套写法
 *   对任何控件都一样，不必各自发明。
 *
 * ⚠️ 注册表是全局的，且**同名幂等、先注册者生效**：要给不同字段配不同校验或不同联动，
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
 * @param props 透传给 antd Input 的配置（placeholder / maxLength / onSearch 等）
 * @param options 校验与行操作钩子；不传即「纯输入框」
 *
 * 场景：回车打开用户列表弹窗，选完把用户信息填回本行。
 * antd Input 自带的 onSearch（回车或点搜索图标触发）留在 props 里，
 * 「本行」从 onStart 拿、onEnd 清：
 *
 *   let activeRow: EditorRowAccessor | null = null;
 *   registerAntdInputEditor(
 *       'preorder-employee',
 *       { onSearch: () => setPickerOpen(true) },
 *       {
 *           onStart: (row) => { activeRow = row; },
 *           onEnd: () => { activeRow = null; },
 *       },
 *   );
 *   // 弹窗里选完人：
 *   activeRow?.setFields({EmployeeName: emp.EmployeeName, DeptName: emp.DeptName});
 *   activeRow?.endEdit();     // 选完就收工，免得编辑态与回填的数据对不上
 *
 * 提示：onStart 拿到的访问器只在编辑期间有效，onEnd 之后写入会被静默忽略。
 */
export function registerAntdInputEditor(
    name: string = ANTD_INPUT_EDITOR,
    props: AntdInputEditorProps = {},
    options: EditorOptions<string> = {},
): void {
    registerOnce(name, new AntdInputEditor(props, options));
}

/**
 * 注册数字编辑器
 * @param name 编辑器名，默认 ANTD_NUMBER_EDITOR
 * @param props 透传给 antd InputNumber 的配置（min / max / precision 等）
 * @param options 校验与行操作钩子；不传即「纯数字框」
 *
 * 场景：填完数量顺手算别的列 —— onCommit 的第一个参数是本次提交的
 * {value, option?}，第二个是行访问器（getField 读到的是编辑前的旧值）：
 *
 *   registerAntdNumberEditor('preorder-size', {min: 0, precision: 0}, {
 *       validator: (value) => (Number(value) > 999 ? '数量过大' : undefined),
 *       onCommit: ({value}, row) => {
 *           row.setFields({Number: toNumberOrZero(value), MSewWt: weightOf(value)});
 *       },
 *   });
 */
export function registerAntdNumberEditor(
    name: string = ANTD_NUMBER_EDITOR,
    props: AntdInputNumberEditorProps = {},
    options: EditorOptions<number | null> = {},
): void {
    registerOnce(name, new AntdInputNumberEditor(props, options));
}

/**
 * 注册下拉编辑器
 * @param name 编辑器名，默认 ANTD_SELECT_EDITOR
 * @param props 透传给 antd Select 的配置（必须给 options，否则是空下拉）
 * @param options 校验与行操作钩子
 *
 * 场景：下拉的选项本身就是一张表的行，选中后把它那几个字段复制到本行其他列 ——
 * 把原始行挂在 option 的 `data` 上，onCommit 的 payload.option 里就能取到，
 * 页面**不需要**维护 value -> 整行 的字典，也不必在下拉里 find：
 *
 *   const employees = await employeeApi.list();
 *   registerAntdSelectEditor(
 *       'preorder-employee',
 *       {
 *           options: employees.map((emp) => ({
 *               value: emp.EmployeeNo,
 *               label: emp.EmployeeName,
 *               data: emp,                        // 整行挂上来
 *           })),
 *       },
 *       {
 *           onCommit: ({option}, row) => {
 *               const emp = option?.data as EmployeeRecord | undefined;
 *               if (emp) row.setFields({EmployeeName: emp.EmployeeName, DeptName: emp.DeptName});
 *           },
 *       },
 *   );
 *
 * 写回走 table.changeCellValueByRecord，会照常派发 change_cell_value，
 * 所以页面 onCellValueChange 那份 records 里这些字段也自动是新的。
 */
export function registerAntdSelectEditor(
    name: string = ANTD_SELECT_EDITOR,
    props: AntdSelectEditorProps = {},
    options: EditorOptions<unknown> = {},
): void {
    registerOnce(name, new AntdSelectEditor(props, options));
}

/** 一次注册三个基础编辑器（默认名字、不带额外约束与校验），幂等 */
export function registerAntdEditors(): void {
    registerAntdInputEditor();
    registerAntdNumberEditor();
    registerAntdSelectEditor();
}
