import {App} from 'antd';
import type {RefObject} from 'react';
import type {CommandItem} from '@/components/CommandBar';
import type {VTableApi} from '@/components/vtable';

/** antd App.useApp() 的返回类型（message / modal / notification） */
type AppApi = ReturnType<typeof App.useApp>;

/**
 * 命令条自带的框架能力：**与具体页面、具体业务无关**，换哪个页面都成立。
 *
 * 这里只放这类字段。页面自己的业务依赖（选中行、当前行、查询条件、打开表单…）一律不进这里 ——
 * 否则通用层会被某一个页面的形状绑死：别的页面接命令条时得为用不上的字段塞假实现
 * （`() => []`、`null`、`false`）。业务依赖由页面自己声明，再经 CommandContext<TExtra> 注入。
 *
 * 判据：加字段前先问「第二个页面是不是也一定会用到」。只服务一个页面的，写进那个页面的 TExtra。
 */
export interface CommandBaseContext {
    /** antd 的 message（轻提示） */
    message: AppApi['message'];
    /** antd 的 modal（确认框等） */
    modal: AppApi['modal'];
    /**
     * 表格实例：命令里要直接操作表格（清空选中、取选中行、重绘）时用。
     *
     * 命令条目前都配着 VTable 页面，所以放在基础能力里；将来真出现「纯按钮页（没有表格）」，
     * 把它挪进页面的 TExtra 即可 —— 命令条本身不关心有没有表格。
     */
    tableRef: RefObject<VTableApi | null>;
}

/**
 * 页面的命令上下文 = 框架能力 + 页面声明的业务依赖。
 *
 * 页面用法（本页要用的依赖写进 TExtra，命令工厂就能解构到它们）：
 *
 * ```ts
 * interface YupaiOrderCommandDeps {
 *     getSelectedRows: () => YupaiOrder[];
 *     activeRow: YupaiOrder | null;
 *     // ...
 * }
 * export type YupaiOrderCommandContext = CommandContext<YupaiOrderCommandDeps>;
 * ```
 */
export type CommandContext<TExtra extends object = object> = CommandBaseContext & TExtra;

/**
 * 命令工厂：接 context 返回命令项；返回数组表示一组（组内顺序保持，如占位命令组）。
 *
 * 泛型是**整个 context 类型**，而不是拆开的 TRecord / TQuery —— 这样页面把 context 扩展出额外字段
 * （`CommandContext<公共依赖 & {openLog}>`）后，只有喂了这份 context 的那组命令能读到它们
 * （分组用法见 useCommandGroups）。
 */
export type CommandFactory<TContext = CommandContext> = (
    context: TContext,
) => CommandItem | CommandItem[];
