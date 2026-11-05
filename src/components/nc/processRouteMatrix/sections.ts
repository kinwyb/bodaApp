/**
 * 工艺路线矩阵的页签键。
 *
 * 与包装 BOM 矩阵（三张内置表 + 页面追加的「发布情况」）同一个结构：
 * - `items` 是控件**内置**的那一张（工序明细，也是唯一可编辑的）；
 * - `pushRules` 是**可选**的追加页签，控件不主动渲染 —— 页面要用就在
 *   `<ProcessRouteMatrixView tabs={...}/>` 里传进去（表本身复用 `components/nc/matrixPushView`）。
 *
 * 键名写在这里而不是页面里，是因为它同时是界面桥里那张表的 `name`（取数命令的前缀，
 * 例如 `items.page`）与 Tabs 的 key：两处各写一份，症状是「表明明在、模型却说打不开」，
 * 而且不会报错。
 */

/** 标签页 = 桥里那张表的名字（也是命令前缀） */
export type ProcessRouteSection = 'items' | 'pushRules';

export type ProcessRouteSectionMeta = {
    key: ProcessRouteSection;
    /** 标签页标题 */
    label: string;
    /**
     * 控件是否内置渲染这一页。
     *
     * `false` 的页签由调用方通过 `tabs` 追加（发布情况：数据在页面手上，
     * 控件不应该替它取数）。
     */
    builtin: boolean;
};

export const PROCESS_ROUTE_SECTIONS: ProcessRouteSectionMeta[] = [
    {key: 'items', label: '工序明细', builtin: true},
    {key: 'pushRules', label: '发布情况', builtin: false},
];

/** 默认停在工序明细：那是这份矩阵的主数据，发布情况是它的下游状态 */
export const DEFAULT_PROCESS_ROUTE_SECTION: ProcessRouteSection = 'items';

/** 键 → 标题；认不出就原样返回（宁可显示 `foo` 也不要显示空白） */
export function processRouteSectionLabel(key: string): string {
    return PROCESS_ROUTE_SECTIONS.find((item) => item.key === key)?.label ?? key;
}

/** 是不是一个合法的标签页键（桥的命令要校验参数） */
export function isProcessRouteSection(value: unknown): value is ProcessRouteSection {
    return PROCESS_ROUTE_SECTIONS.some((item) => item.key === value);
}
