import {useMemo, type RefObject} from 'react';
import {App} from 'antd';
import {ExportOutlined} from '@ant-design/icons';
import dayjs from 'dayjs';
import type {CommandItem} from '@/components/CommandBar';
import type {GridTableApi} from '@/components/grid-table';
import type {CommandBaseContext, CommandContext, CommandFactory} from './types';
import {toStringOrEmpty} from '@/utils';

type ExportCommandContext = CommandContext<CommandBaseContext>;

/** 命令本体（纯函数：拿到 context / 前缀就产出命令项，不碰 hook） */
function buildExportItem({message, tableRef}: ExportCommandContext, filePrefix?: string): CommandItem {
    return {
        key: 'export',
        label: '导出',
        icon: <ExportOutlined/>,
        onClick: async () => {
            const hide = message.loading('正在导出…', 0);
            try {
                await tableRef.current?.exportExcel(`${toStringOrEmpty(filePrefix)}${dayjs().format('YYYY-MM-DD')}`);
                void message.success('导出成功');
            } catch (error) {
                void message.error(error instanceof Error ? error.message : '导出失败');
            } finally {
                hide();
            }
        },
    };
}

/**
 * 导出命令（**一行搞定，页面首选**）：传 tableRef + 文件名前缀，直接拿到 CommandItem[]。
 *
 * ```tsx
 * const commands = useTableExportCommand(tableRef, '全订单汇总');
 * ```
 *
 * message / modal 由 hook 内部从 antd `<App>` 取，页面不必再拼 context。
 * 它之所以是 hook（而不是普通函数）：返回数组要稳定，否则每次渲染 CommandBar 都重建按钮、
 * 将来给 CommandBar 加 memo 也会直接失效。
 *
 * ⚠️ 只能在**组件顶层**调用；不要塞进页面的 useMemo / useEffect 回调里 —— 那就是
 * 「在 hook 回调里调 hook」，会打乱外层 hook 顺序（详见 createTableExportCommand 的注释）。
 */
export function useTableExportCommand(
    tableRef: RefObject<GridTableApi | null>,
    filePrefix?: string,
): CommandItem[] {
    const {message, modal} = App.useApp();
    return useMemo(
        () => [buildExportItem({message, modal, tableRef}, filePrefix)],
        [message, modal, tableRef, filePrefix],
    );
}

/**
 * 导出命令工厂（**多命令装配时用**）：纯函数，返回 CommandFactory，
 * 交给 `useCommands(context, [createTableExportCommand('前缀'), ...])` /
 * `useCommandGroups` 与其他命令一起排序、分组。
 *
 * **绝对不能在这里或返回的工厂里调用 hook**：工厂是在 useCommands 的 useMemo 回调里被求值的，
 * 再调 hook 就成了「在 hook 回调里调 hook」—— React 会抛
 * `Do not call Hooks inside useEffect(...), useMemo(...)`，并把外层页面的 hook 顺序彻底打乱
 * （紧接着报 `useMemo changed size between renders`，页面渲染异常）。
 *
 * @param filePrefix 导出文件名前缀（不含日期，日期由插件按当天补；也不用带 .xlsx）
 */
export function createTableExportCommand(filePrefix?: string): CommandFactory<ExportCommandContext> {
    return (context) => buildExportItem(context, filePrefix);
}
