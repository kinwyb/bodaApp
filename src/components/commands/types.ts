import {App} from 'antd';
import type {RefObject} from 'react';
import type {CommandItem} from '@/components/CommandBar';
import type {VTableApi} from '@/components/VTable';

/** antd App.useApp() 的返回类型（message / modal / notification） */
type AppApi = ReturnType<typeof App.useApp>;

/**
 * 表单弹窗的模式。
 *
 * - `add`：新增，表单是空的；
 * - `edit`：编辑已有数据（提交时保留主键，改的是原来那条）；
 * - `view`：只读查看；
 * - `copy`：以一条已有数据为**底稿新建**（如「已下订单复制」）—— 界面与 add 一样可编辑，
 *   但数据是带出来的；提交时**不保留主键**，落成新记录。
 *
 * 提交时到底带不带主键由页面表单组件决定：通用层只负责把模式传下去，
 * 别在这里塞业务判断（「哪些字段算主键」是业务知识）。
 */
export type FormMode = 'add' | 'edit' | 'view' | 'copy';

/**
 * 命令的公共依赖：页面负责装配状态与服务，命令工厂只管业务动作。
 *
 * 泛型参数：
 * - TRecord：页面的行数据类型（默认 Record<string, unknown>）
 * - TQuery：页面的查询参数类型（默认 unknown）
 */
export interface CommandContext<TRecord = Record<string, unknown>, TQuery = unknown> {
    message: AppApi['message'];
    modal: AppApi['modal'];
    tableRef: RefObject<VTableApi | null>;
    /** 当前选中的业务行（页面负责过滤统计行等非业务数据） */
    getSelectedRows: () => TRecord[];
    /**
     * 当前**激活**的那一行 —— 鼠标最后点选 / 键盘方向键移动到的行（页面负责过滤统计行等非业务数据）。
     * 没有激活行时为 null（Ctrl+A 全选、选中被清空、只点中表头这几种情况）。
     *
     * 与 getSelectedRows 的分工：那个是「选中的集合」（多选时有好几条，看不出用户此刻聚焦的是哪一条），
     * 这个只回答「当前聚焦的是哪一条」。
     *
     * **存成值而不是取值函数**：命令项的 disabled 是渲染时算的，必须跟着激活行一起重算。
     * 页面接表格的 onSelectedChange 写进 state 即可（表格只在「行」变化时回调，同行内换列不触发，
     * 所以不会因为点同行的另一列而白重渲染）。
     */
    activeRow: TRecord | null;
    /** 是否有选中行，驱动按钮 disabled */
    hasSelection: boolean;
    /** 当前查询条件 */
    query: TQuery;
    /** 按当前条件重新加载列表 */
    reload: () => Promise<void>;
    /** 打开表单弹窗（mode 语义见 FormMode：新增 / 编辑 / 查看 / 复制） */
    openForm: (mode: FormMode, record: TRecord | null) => void;
}

/**
 * 命令工厂：接 context 返回命令项；返回数组表示一组（组内顺序保持，如占位命令组）。
 *
 * 泛型是**整个 context 类型**，而不是拆开的 TRecord / TQuery —— 这样页面把 context 扩展出额外字段
 * （`CommandContext<YupaiOrder, YupaiOrderQuery> & {workPlaces: WorkPlace[]}`）之后，
 * 只有喂了这份 context 的那组命令能读到它们（见 useCommandGroups 的分组用法）。
 */
export type CommandFactory<TContext = CommandContext> = (
    context: TContext,
) => CommandItem | CommandItem[];
