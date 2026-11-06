/**
 * 工序明细表的编辑器实例前缀（每个表格实例一份唯一名字）。
 *
 * 为什么需要：`@visactor/vtable` 的编辑器注册是**全局表 + 同名先到先得**
 * （`registerAntdInputEditor` 内部 `registerOnce`）。这一页常常同时存在两个工序表实例
 * （页面上只读一张、编辑弹窗里可编辑一张），后挂载的那个注册会被**静默忽略**，
 * 它的格子编辑时用的是前一个实例的回调闭包 —— 选工序回填到别人家的行上。
 *
 * 与 `components/nc/bomMatrix/editorScope.ts` 同一套做法，只是前缀不同（`pr`），
 * 这样两套矩阵在同一个页面里也不会互相顶掉。
 *
 * 用模块级自增而不是 `useId`：`useId` 按树位置生成，弹窗卸载重开后位置不变、会拿到
 * 同一个 id，而注册表里那个名字已经属于一个**已卸载**的实例 —— 第二次打开弹窗就选不出东西。
 *
 * 代价：注册表里会残留已卸载实例的名字（`registered` 是个只增的 Set）。一个字符串，
 * 忽略不计；别为它做反注册 —— 反注册时机（StrictMode 双跑、卸载顺序）极易把仍在用的删掉。
 */
import {useMemo} from 'react';

let scopeSeq = 0;

/**
 * 下一个实例前缀。
 *
 * 自增刻意写在模块级函数里（而不是 hook 体内）：hook 体内给外部变量赋值会被
 * React Compiler 的静态检查判成「render 期的副作用」。
 */
function nextScope(): string {
    scopeSeq += 1;
    return `pr${scopeSeq}`;
}

/** 领一个实例前缀：每个组件实例一次，后续渲染保持不变 */
export function useEditorScope(): string {
    return useMemo(() => nextScope(), []);
}

/** 把基础名拼成实例级编辑器名（如 `workprocess-editor-pr7`） */
export const scopedEditorKey = (base: string, scope: string): string => `${base}-${scope}`;
