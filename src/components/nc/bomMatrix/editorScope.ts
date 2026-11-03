/**
 * 表格实例级的编辑器名（每个表格实例一份唯一前缀）。
 *
 * 为什么需要：`@visactor/vtable` 的编辑器注册是**全局表 + 同名先到先得**
 * （`registerAntdInputEditor` 内部 `registerOnce`）。同一种表格在同一个页面同时存在
 * 两个实例时（本工程的典型场景：页面上只读一张、弹窗里可编辑一张），后挂载的那个注册
 * 会被**静默忽略**，它的格子编辑时用的是前一个实例的回调闭包 —— `onStart` 记的是别人家的行、
 * `onSearch` 打开的是别人家的弹窗、`onSelect` 里判断「这是不是末尾行」也拿别人家的 rows。
 *
 * 表现不是报错，而是零散的功能失灵：选了物料底部不补空行、色号选了不落格、
 * 单位弹窗里的候选项对不上……而且**只在同页存在两个实例时出现**，单独测试一切正常。
 *
 * 所以每个表格实例挂载时领一个唯一前缀，注册名与 `editableFields` 都用它。
 *
 * 用模块级自增而不是 `useId`：`useId` 按树位置生成，弹窗卸载重开后位置不变、会拿到
 * 同一个 id，而注册表里那个名字已经属于一个**已卸载**的实例（闭包里的 `setIsOpen`
 * 再也不生效）—— 第二次打开弹窗就点不出选择框了。自增保证每次挂载都是新名字。
 *
 * 代价：注册表里会残留已卸载实例的名字（`registered` 是个只增的 Set）。
 * 一个字符串，忽略不计；别为它做反注册 —— 反注册时机（StrictMode 双跑、卸载顺序）
 * 极易把仍在用的那个删掉，风险远大于这点内存。
 */
import {useMemo} from 'react';

let scopeSeq = 0;

/**
 * 下一个实例前缀。
 *
 * 自增刻意写在模块级函数里（而不是 hook 体内）：hook 体内给外部变量赋值会被
 * React Compiler 的静态检查判成「render 期的副作用」。这里语义就是「领一个新的号」，
 * 放在函数里既表达了这个意思，也让规则看得懂。
 */
function nextScope(): string {
    scopeSeq += 1;
    return `bm${scopeSeq}`;
}

/** 领一个实例前缀：每个组件实例一次，后续渲染保持不变 */
export function useEditorScope(): string {
    return useMemo(() => nextScope(), []);
}

/** 把基础名拼成实例级编辑器名（如 `material-editor-bm7`） */
export const scopedEditorKey = (base: string, scope: string): string => `${base}-${scope}`;
