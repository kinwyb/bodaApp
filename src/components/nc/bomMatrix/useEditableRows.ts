/**
 * 「可编辑行数据」的通用状态：**有本地改动就用本地那份，否则用从 props 派生出来的那份**。
 *
 * 三张表（子项物料 / 配色 / 配码）都需要同一件事：行数据由外面派生（明细 + 接口里的匹配数据），
 * 但用户一编辑就得留在本地，不能再被派生结果顶掉。常见的两种写法都不合适：
 *
 * - `useEffect(() => setRows(derive()), [matrix])`：多渲一轮，还会吃一条
 *   `set-state-in-effect` 告警，`derive()` 里读最新 props 时更容易写错依赖；
 * - 直接 `useState(() => derive())`：倒是只初始化一次，但**换一份矩阵数据时不会重置**
 *   （同一张单反复刷新、或从一张单切到另一张，屏幕上还是上一张的行）。
 *
 * 这里用「本地改动 + source 引用比对」：`source` 记着这份改动基于哪一份输入，
 * 输入换了引用就对不上，自动回落到新派生出来的行 —— 等价于「props 变了就重置」，
 * 但写成纯派生，渲染期不读 ref、不 setState。
 *
 * 逐帧看是这样（以配码表为例，`base` 来自 `toSizeRows(matrix, items)`、`source` 就是 `matrix`）：
 *
 * | 发生了什么 | `edit` | 显示哪份 |
 * | --- | --- | --- |
 * | 刚挂载 | `null` | `base`：按明细 + SizeMatch 铺出来的行 |
 * | 用户改了一个尺码格子 | `{source: matrixA, rows: 改过的}` | `edit.rows`（改动留下） |
 * | 明细加了一行（`items` 变了） | 同上，`source` 还是 matrixA | 仍是 `edit.rows` → 靠命令 API `addRow` 补进去，**不会重算** |
 * | 换了一张单（`matrix` 变成 matrixB） | `source: matrixA ≠ matrixB` | 回落新的 `base`：旧单的编辑自动作废 |
 *
 * 也就是说：**没有编辑时永远显示最新派生值；一旦有编辑，派生结果就不再顶替它**，
 * 只有在「换了数据源」时才整体让位。两次判定的依据都是同一个 `source` 引用。
 *
 * @param base   从 props 派生出来的行（调用方用 `useMemo` 稳定它）
 * @param source 这份 `base` 的来源（比如 `matrix` 对象）：引用一变，本地改动作废
 */
import {useCallback, useState} from 'react';
import type {BomMatrixRow} from './rows.ts';

export type BomMatrixRowUpdater = (rows: BomMatrixRow[]) => BomMatrixRow[];

export function useEditableRows(
    base: BomMatrixRow[],
    source: unknown,
    /**
     * 挂载时用的行（可选）：给了就作为**第一份本地改动**存下来。
     *
     * 用途是「迟到者对齐」：配码 / 配色是懒挂载的，用户可能已经在子项物料表里增删改过明细，
     * 这张表此时才第一次渲染 —— 它错过的那几次命令补不回来，只能按**当前明细**重新铺一遍。
     * `base` 用的是 props 上的明细（换单时的输入），拿不到子项物料表里未保存的编辑，
     * 所以首帧要单独要一份。
     *
     * 给 `undefined` 就是普通的「首帧用 base」。
     */
    initialRows?: BomMatrixRow[],
): {
    /** 当前该显示的行：本地改动优先，没有改动（或输入换了）就是 base */
    rows: BomMatrixRow[];
    /** 改行数据：updater 收到「此刻真正的行」，返回新数组；commit 之后本地改动生效 */
    commit: (updater: BomMatrixRowUpdater) => void;
} {
    const [edit, setEdit] = useState<{source: unknown; rows: BomMatrixRow[]} | null>(
        // 初始就当作「已经改过一次」：source 与当前一致，换单时照样会失效
        initialRows ? {source, rows: initialRows} : null,
    );
    const rows = edit && edit.source === source ? edit.rows : base;

    const commit = useCallback((updater: BomMatrixRowUpdater) => {
        setEdit((prev) => {
            // 用函数式更新：连续两次编辑（都在同一帧里排队的）不会互相覆盖
            const current = prev && prev.source === source ? prev.rows : base;
            return {source, rows: updater(current)};
        });
    }, [base, source]);

    return {rows, commit};
}
