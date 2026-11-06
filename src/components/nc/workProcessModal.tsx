import type {AppColumnDef} from "@/components/grid-table";
import type {NCWorkProcess} from "@/api/schemas/nc/NCBase.ts";
import React, {useCallback} from "react";
import {QuickSelectView} from "@/components/QuickSelectModal.tsx";
import {RegisterInputModal, type RegisterModalProps} from "@/components/registerModal.tsx";
import {loadWorkProcesses} from "@/components/nc/workProcessCache.ts";

/**
 * 基本工序编辑器名。
 *
 * ⚠️ 不能与别的编辑器同名（比如供应商的 `productor-editor`）：编辑器注册是**全局同名先到先得**
 * （`editors/register.ts` 的 `registerOnce`），撞名时后注册的那个会被静默忽略 ——
 * 表现是「点搜索按钮弹出的是另一张表的选择框」，而且只在同一个页面同时用到两者时出现。
 */
export const WORKPROCESS_EDITOR = 'workprocess-editor';

/** 基本工序列 */
const WORKPROCESS_COLUMNS: AppColumnDef[] = [
    {field: 'CrcCode', title: '编码', width: 110},
    {field: 'CrcName', title: '名称', width: 140},
];

export interface NCWorkProcessViewProps {
    /** 选择回调 */
    onSelect: (process: NCWorkProcess) => void;
    /**
     * 打开时的初始关键字（本地筛选，立刻生效）。
     *
     * 来源是「用户先在格子里敲了几个字，再点搜索按钮」—— 见 `RegisterInputModal` 的
     * `updateViewProps` 第三个参数。不传就是空列表（全部工序）。
     */
    defaultKeyword?: string;
}

const NCWorkProcessView: React.FC<NCWorkProcessViewProps> = ({onSelect, defaultKeyword}) => {

    const loadData = useCallback(async (): Promise<NCWorkProcess[]> => {
        /*
         * 走 `loadWorkProcesses`（**强制**拉一次并登记）：
         * - 工序没有「按编码 / 名称查一条」的接口，列表只可能是全量；
         * - 打开弹窗时拿最新的档案（档案随时可能被维护），失败让它抛出去 ——
         *   `QuickSelectView` 会提示「加载数据失败」，而不是把失败显示成「暂无基本生产工序」；
         * - 取回来的这份顺手登记到缓存，之后格子里输入回车就能直接筛，不用再等一趟请求。
         */
        return loadWorkProcesses();
    }, []);

    return (
        <QuickSelectView<NCWorkProcess>
            columns={WORKPROCESS_COLUMNS}
            rowKey="CrcID"
            loadData={loadData}
            searchFields={['CrcCode', 'CrcName']}
            searchLabel="快速选择:"
            searchPlaceholder={'关键字'}
            // 格子里的文字带进来，打开就只剩相关的几行
            defaultKeyword={defaultKeyword}
            // 列表是基础档案全量，不依赖别的选择：空就是真的没有档案
            emptyTip={'暂无基本生产工序'}
            autoFillWidth={true}
            onSelect={(row) => row && onSelect(row)}
        />
    );
};


export type NCWorkProcessModalProps = RegisterModalProps<NCWorkProcess, NCWorkProcessViewProps> & {
    /**
     * 编辑器注册名，默认 `WORKPROCESS_EDITOR`。
     *
     * 同一页面有多个表格实例时（页面只读一张 + 弹窗可编辑一张）必须各用各的名字：
     * 注册表全局、同名先到先得，后注册的会被忽略（见 `processRouteMatrix/editorScope.ts`）。
     */
    editorKey?: string;
};

/**
 * 基本工序选择（表格编辑器的弹窗 + 视图）。
 *
 * 三种用法：
 * - `isEditor`：`CrcCode` 列挂这个编辑器名，双击格子时是输入框，点搜索按钮打开本弹窗；
 * - 独立模式（`open` 受控）：表单里的输入控件用它（见 `./workProcessSelect.tsx`）；
 * - 用户不走弹窗、直接在格子里输入回车：走 `onInput`，调用方在**全量列表里本地筛**。
 */
const NCWorkProcessModal: React.FC<NCWorkProcessModalProps> = ({
                                                                   open,
                                                                   onCancel,
                                                                   isEditor,
                                                                   onSelect,
                                                                   onInput,
                                                                   editorKey = WORKPROCESS_EDITOR,
                                                               }) => {
    return (
        <RegisterInputModal<NCWorkProcess, NCWorkProcessViewProps>
            open={open}
            isEditor={isEditor}
            title={'选择基本工序'}
            editorKey={editorKey}
            editorPlaceholder="基本工序"
            onCancel={onCancel}
            onSelect={onSelect}
            // 用户不走弹窗、直接在格子里输入编码/名称回车的那条路：不传下去就永远收不到
            onInput={onInput}
            /*
             * 把「点搜索按钮那一刻输入框里的文字」带进弹窗当初始筛选词；
             * 独立模式下没有这段文字（keyword 为 undefined），保留调用方给的 defaultKeyword。
             */
            updateViewProps={(viewProps, _row, keyword) => ({
                ...viewProps,
                defaultKeyword: keyword ?? viewProps?.defaultKeyword,
            })}
            width={600}
            height={400}
            View={NCWorkProcessView}
        />
    );
}

export default NCWorkProcessModal;
