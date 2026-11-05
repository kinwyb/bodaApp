/**
 * 「可编辑行数据」的通用状态：**有本地改动就用本地那份，否则用从 props 派生出来的那份**。
 *
 * 与 `components/nc/bomMatrix/useEditableRows.ts` 同一套判定（那里是三张表共用），
 * 这里做成了泛型：工艺路线只有一张可编辑表，没必要为它绑死一个行类型。
 *
 * 为什么不直接 `useState(() => derive())`：换一份矩阵（从一份工艺切到另一份）时不会重置，
 * 屏幕上还是上一张的行。为什么不 `useEffect(() => setRows(derive()), [matrix])`：
 * 多渲一轮、吃一条 `set-state-in-effect` 告警，还容易把依赖写错。
 *
 * 这里的做法是「本地改动 + source 引用比对」：`source` 记着这份改动基于哪一份输入，
 * 输入换了引用就对不上，自动回落到新派生出来的行 —— 等价于「props 变了就重置」，
 * 但写成纯派生，渲染期不读 ref、不 setState。
 *
 * | 发生了什么 | 显示哪份 |
 * | --- | --- |
 * | 刚挂载 | `base`：按接口明细铺出来的行 |
 * | 用户改了一格 | 本地那份（改动留下） |
 * | 接口明细换了引用 | 回落新的 `base`（旧矩阵的编辑自动作废） |
 *
 * @param base   从 props 派生出来的行（调用方用 `useMemo` 稳定它）
 * @param source 这份 `base` 的来源（比如 `matrix` 对象）：引用一变，本地改动作废
 * @param initialRows 挂载时的第一份本地改动（可选）：给「懒挂载的迟到者」按当前数据重铺
 */

import {useCallback, useState} from 'react';

export type EditableRowUpdater<T> = (rows: T[]) => T[];

export function useEditableRows<T extends Record<string, unknown>>(
    base: T[],
    source: unknown,
    initialRows?: T[],
): {
    /** 当前该显示的行：本地改动优先，没有改动（或输入换了）就是 base */
    rows: T[];
    /** 改行数据：updater 收到「此刻真正的行」，返回新数组；commit 之后本地改动生效 */
    commit: (updater: EditableRowUpdater<T>) => void;
} {
    const [edit, setEdit] = useState<{source: unknown; rows: T[]} | null>(
        // 初始就当作「已经改过一次」：source 与当前一致，换单时照样会失效
        initialRows ? {source, rows: initialRows} : null,
    );
    const rows = edit && edit.source === source ? edit.rows : base;

    const commit = useCallback((updater: EditableRowUpdater<T>) => {
        setEdit((prev) => {
            // 函数式更新：同一帧里排队的两次编辑不会互相覆盖
            const current = prev && prev.source === source ? prev.rows : base;
            return {source, rows: updater(current)};
        });
    }, [base, source]);

    return {rows, commit};
}
