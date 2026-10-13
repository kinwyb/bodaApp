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
    /** 是否有选中行，驱动按钮 disabled */
    hasSelection: boolean;
    /** 当前查询条件 */
    query: TQuery;
    /** 按当前条件重新加载列表 */
    reload: () => Promise<void>;
    /** 打开表单弹窗（mode 语义见 FormMode：新增 / 编辑 / 查看 / 复制） */
    openForm: (mode: FormMode, record: TRecord | null) => void;
}

/** 命令工厂：接 context 返回命令项；返回数组表示一组（组内顺序保持，如占位命令组） */
export type CommandFactory<TRecord = Record<string, unknown>, TQuery = unknown> = (
    context: CommandContext<TRecord, TQuery>,
) => CommandItem | CommandItem[];
