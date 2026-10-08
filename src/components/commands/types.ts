import {App} from 'antd';
import type {RefObject} from 'react';
import type {CommandItem} from '@/components/CommandBar';
import type {VTableApi} from '@/components/VTable';

/** antd App.useApp() 的返回类型（message / modal / notification） */
type AppApi = ReturnType<typeof App.useApp>;

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
    /** 打开表单弹窗（mode 语义与页面表单组件对齐：新增 / 编辑 / 查看） */
    openForm: (mode: 'add' | 'edit' | 'view', record: TRecord | null) => void;
}

/** 命令工厂：接 context 返回命令项；返回数组表示一组（组内顺序保持，如占位命令组） */
export type CommandFactory<TRecord = Record<string, unknown>, TQuery = unknown> = (
    context: CommandContext<TRecord, TQuery>,
) => CommandItem | CommandItem[];
