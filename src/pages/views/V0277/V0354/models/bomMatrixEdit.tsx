/**
 * 新增 / 编辑 / 复制包装 BOM 矩阵的表单弹窗。
 *
 * **保存**：校验（`./bomMatrixValidation`）→ 查重确认 → 组合完整 `PackBomMatrix`
 * （`./bomMatrixPayload`）→ `packBomMatrixApi.save` 落库 → **按返回的 `PackBomMatrixID`
 * 重新取一遍详情**。重取这一步是关键：接口会补上界面拼不出来的东西（明细主键、矩阵版本…），
 * 重取之后这份记录才有身份，用户可以接着改，也可以点「生成 / 复制」。
 *
 * 字段名按接口 schema 来（`PackBomMatrix`），后端暂时没有的那几个（规格 / 型号 /
 * 产成品的编码名称等）用同名占位一起提交，后端接上就不必回头改这里。
 *
 * 下半部分是**编辑态的矩阵表**（`BomMatrixView isEditMode`）：三张表各自可增删改，
 * 子项物料表的行事件会自动同步到配色 / 配码（那套编排在控件里，弹窗不参与）。
 */

import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {App, Button, Divider, Form, Input, Modal, Spin} from "antd";
import {CopyOutlined, SaveOutlined, ThunderboltOutlined} from "@ant-design/icons";
import {BomMatrixView, type BomMatrixViewApi} from "@/components/nc/bomMatrix";
import {createItemRow} from "@/components/nc/bomMatrix/rows.ts";
import MaterialSelect from "@/components/nc/materialSelect.tsx";
import ProjectSelect from "@/components/nc/projectSelect.tsx";
import ConvertSelect from "@/components/nc/convertSelect.tsx";
import {putConverts} from "@/components/nc/convertCache.ts";
import type {NCMaterial, NCMaterialConvert, NCMaterialVFree} from "@/api/schemas/nc/NCMaterial.ts";
import type {NCProject} from "@/api/schemas/nc/NCBase.ts";
import {type BomMatrixSection, DEFAULT_BOM_MATRIX_SECTION} from "@/components/nc/bomMatrix/sections.ts";
import {BOMMATRIX_COLOR_VFREE_FIELD, BOMMATRIX_SIZE_VFREE_FIELD,} from "@/components/nc/bomMatrix/common.ts";
import {ncMaterialApi} from "@/api/modules/nc/material.ts";
import {packBomMatrixApi} from "@/api/modules/nc/bomMatrix.ts";
import {ErrorMessage} from "@/api/request.ts";
import type {
    PackBomMatrix,
    PackBomMatrixColorMatch,
    PackBomMatrixDetail,
    PackBomMatrixSizeMatch
} from "@/api/schemas/nc/bomMatrix.ts";
import {isBlank, toStringOrEmpty} from "@/utils";
import {buildPackBomMatrix, toSavePayload} from "./bomMatrixPayload.ts";
import {dataSingleCheck, validateBomMatrix} from "./bomMatrixValidation.ts";
import {
    type BomMatrixCellIssue,
    type BomMatrixCellIssueMap,
    cellIssueKey,
    toCellIssueMap,
} from "@/components/nc/bomMatrix/cellIssues.ts";
import {useUIBridgeDialog} from "@/pages/agent/ui-bridge";
import type {FormMode} from "../command";
import {
    type BomMatrixEditBridgeContext,
    type BomMatrixFieldGroup,
    type BomMatrixFormField,
    createBomMatrixEditBridge,
    PACK_FIELDS,
    SEW_FIELDS,
} from "./bomMatrixEditBridge";
import "./bomMatrixEdit.css";
import BomMatrixPush from "./bomMatrixPush";

export type BomMatrixEditProps = {
    open: boolean;
    /**
     * 所属页面的 view（菜单的 View 字段）。
     *
     * 界面桥按 view 找「这一页上打开的是哪个弹窗」，所以弹窗必须知道自己站在哪个页面里 ——
     * 打开期间它顶掉页面的工具栏动作与列表数据，关闭后把视野还给页面。
     */
    view: string;
    /** add / edit / copy；view 也支持（只读预览，复用同一份布局） */
    mode: FormMode;
    /** 编辑 / 复制时的底稿；新增为 null */
    record: PackBomMatrix | null;
    /**
     * 保存成功后的通知（参数是落库后的 `PackBomMatrixID`）。
     *
     * 页面拿它去刷新列表 —— 不刷新的话新存的这份在关掉弹窗后仍然看不见，
     * 用户会以为没存上（弹窗里已经重取过详情，所以这里是「外面那份」的事）。
     */
    onSaved?: (matrixID: string) => void;
    onClose: () => void;
};

/** 标题按模式来：复制与新增是同一套空表单，但用户要知道自己在复制哪一份 */
const MODE_TITLE: Record<FormMode, string> = {
    add: '新增包装 BOM 矩阵',
    edit: '编辑包装 BOM 矩阵',
    copy: '复制包装 BOM 矩阵',
    view: '查看包装 BOM 矩阵',
};

/** 存下来之后统一叫「编辑」：新增 / 复制一旦落库，改的就是已有记录 */
const EDIT_TITLE = '编辑包装 BOM 矩阵';

/**
 * 「按保存」的准备结果。
 *
 * 三态是必要的：校验不过（要列原因）、查重命中（要问用户）、可以保存（要组合出来的那份）。
 * 挤成一个 `ok + message + payload` 会让调用方到处判空。
 */
type SavePreparation =
/** `issues` = 具体到格子的那几条（行内校验）；必填类的没有格子可标，是空数组 */
    | { kind: 'invalid'; messages: string[]; issues: BomMatrixCellIssue[] }
    | { kind: 'duplicate'; payload: PackBomMatrix }
    | { kind: 'ready'; payload: PackBomMatrix };

/** 校验弹窗最多列几条：一屏列表刷到几十条没人看，剩下的交给表格里的红格子 */
const MAX_SHOWN_MESSAGES = 8;

/**
 * 产成品物料 → 「缝制颜色 / 缝制尺码」清单 —— 也就是配色表、配码表的**列**。
 *
 * 字典项取自物料的辅助属性（`vfree6` / `vfree7`，常量在 `components/nc/bomMatrix/common.ts`），
 * 列名用的是**名称**而不是编码：与 `ColorMatch.VFree6Name` / `SizeMatch.VFree7Name`
 * 是同一口径（见 `rows.ts` 的 `colorCells` / `sizeCells`）。
 *
 * 空名要去掉（表格会出现一列没标题的格子），重名也去掉 ——
 * 一张表里两列同名，用户没法指认自己在改哪一列。
 */
function toSortNames(items: NCMaterialVFree[] | undefined): string[] {
    const names: string[] = [];
    (items ?? []).forEach((item) => {
        const name = toStringOrEmpty(item.name).trim();
        if (!name || names.includes(name)) return;
        names.push(name);
    });
    return names;
}

/**
 * 生成尺码匹配规则
 * @param items
 */
function toSizeMatch(materialVID: string, rowNo: string, items: NCMaterialVFree[] | undefined): Record<string, Record<string, PackBomMatrixSizeMatch>> {
    if (!items || !rowNo || !materialVID) return {};
    return items.reduce<Record<string, Record<string, PackBomMatrixSizeMatch>>>((acc, item) => {
        if (!item.name) {
            return acc;
        }
        const rowKey = rowNo + "_" + materialVID;
        acc[item.name] = {
            [rowKey]: {
                Nbfixshrinknum: '',
                VFree7: item.pk_defdoc,
                VFree7Name: item.name,
                Nitemnum: '1',
            },
        }
        return acc;
    }, {})
}

/**
 * 生成颜色匹配规则
 * @param materialVID
 * @param rowNo
 * @param items
 */
function toColorMatch(materialVID: string, rowNo: string, items: NCMaterialVFree[] | undefined): Record<string, Record<string, PackBomMatrixColorMatch>> {
    if (!items || !rowNo || !materialVID) return {};
    return items.reduce<Record<string, Record<string, PackBomMatrixColorMatch>>>((acc, item) => {
        if (!item.name) {
            return acc;
        }
        const rowKey = rowNo + "_" + materialVID;
        acc[item.name] = {
            [rowKey]: {
                VFree6: item.pk_defdoc,
                VFree6Name: item.name,
            },
        }
        return acc;
    }, {})
}

/**
 * 编辑底稿 → 「产成品」那一组表单字段。
 *
 * 详情接口只给 `SewMaterialVID`，编码 / 名称 / 版本 / 规格 / 型号 / 主单位 / 单位 / 换算率
 * 这些展示字段都没有 —— 只认 VID 的话，编辑打开时产成品那组除了编号几乎一片空白，
 * 而且 VID 缺失时 `hasSewMaterial` 为 false，下面三张表整块禁用（等于打不开编辑）。
 *
 * 真正的来源是**明细第一行（行号 10）**：保存时产成品就写在这一行（见 `buildSewRow`），
 * 它的物料就是 3 开头的缝制物料。行号 10 找不到（历史数据行号不规范）时，
 * 退而取明细里第一条 3 开头的物料 —— 反正产成品只能是缝制物料。
 */
function readSewFields(record: PackBomMatrix): Record<string, unknown> {
    const rows = record.Detail ?? [];
    const row = rows.find((item) => toStringOrEmpty(item.VRowNo) === '10')
        ?? rows.find((item) => toStringOrEmpty(item.MaterialCode).startsWith('3'));
    const materialVID = toStringOrEmpty(row?.MaterialVID) || toStringOrEmpty(record.SewMaterialVID);
    if (!row) {
        return materialVID ? {SewMaterialVID: materialVID} : {};
    }
    return {
        SewMaterialVID: materialVID || undefined,
        SewMaterialCode: row.MaterialCode,
        SewMaterialName: row.MaterialName,
        SewMaterialVersion: row.MaterialVersion,
        SewMaterialSpec: row.MaterialSpec,
        SewMaterialModel: row.MaterialType,
        SewCMeasure: row.CMeasure,
        SewCassmeasure: row.Cassmeasure,
        SewVChangerate: row.VChangerate,
    };
}

/**
 * 表单字段描述。
 *
 * 字段表在 `./bomMatrixEditBridge`（`PACK_FIELDS` / `SEW_FIELDS`）——**同一份**既渲染界面、
 * 又交给 agent。写在这里的话界面上加一个字段、agent 那儿就少一个，两边迟早对不上。
 *
 * 每个字段带两类信息：
 * - `readOnly`：只能由物料带出来，不让手填（名称 / 版本 / 规格 / 型号 / 主单位 / 转换率
 *   都是物料的属性，手改会出现「编码是 A、名称却是 B」这种自相矛盾的数据）；
 * - `material` / `convert`：这个字段在界面上是 `MaterialSelect`（输入框 + 物料弹窗 + 输码查库）
 *   还是 `ConvertSelect`（按**这个物料的**换算单位选），`pack` / `sew` 决定回填到哪一组。
 */
const BomMatrixEdit: React.FC<BomMatrixEditProps> = ({open, view, mode, record, onSaved, onClose}) => {
    const {message, modal} = App.useApp();
    const [form] = Form.useForm<Record<string, unknown>>();
    /**
     * 弹窗内的标签页：**受控在这里**。
     * `BomMatrixView` 自己不存 activeKey（它必须如实回答「用户在看哪张表」），所以由调用方持有。
     */
    const [activeKey, setActiveKey] = useState<string>(DEFAULT_BOM_MATRIX_SECTION);

    /**
     * 要打开哪一份矩阵（新增为空）。
     *
     * 传入的 `record` 是**主表那一行**：列表接口只给摘要（包装物料、项目、方式、数量），
     * `Detail` / `ColorMatch` / `SizeMatch` / `ColorSort` / `SizeSort` 全是空的。
     * 直接拿它铺表格，编辑时看到的就是「明细空、配色配码连列都没有」。
     * 所以编辑 / 复制 / 查看都要按这个 ID 单独取一次详情（见 `loadDetail`）。
     */
    const matrixID = mode === 'add' ? '' : toStringOrEmpty(record?.PackBomMatrixID);

    /**
     * 这份矩阵**在库里的主键** —— 「生成」「复制」能不能点看它，不看模式。
     *
     * 两个按钮都是「按一份已经存在的矩阵做事」：生成按它的产成品铺明细，复制是把这一份另存一份。
     * 新增时还没有身份，所以它们是灰的；**保存成功、接口返回 `PackBomMatrixID` 之后**才有得做。
     *
     * 编辑 / 查看 / 复制打开时主键来自详情，直接可用。保存接口接上以后，
     * 把返回值写进 payload（`payload.PackBomMatrixID = result.data?.PackBomMatrixID`）即可 ——
     * `handleSave` 末尾会把组合结果里的主键同步到这里，不用另加一行。
     */
    const [recordID, setRecordID] = useState<string>(matrixID);

    /** 已经落库了吗 —— 「生成」「复制」的可用性只看这一条 */
    const hasRecord = !isBlank(recordID);

    /**
     * 详情（编辑 / 复制 / 查看才有）。
     *
     * `null` = 还没拿到（新增，或请求在路上 / 失败）：此时表单用主表摘要兜着，
     * 表格区显示加载占位 —— **不能先渲染一张空表**，否则详情一到就是整块重铺。
     */
    const [detailRecord, setDetailRecord] = useState<PackBomMatrix | null>(null);
    /**
     * 初值就是「在加载」：编辑 / 复制 / 查看一打开就在等详情。
     *
     * 不能等 effect 里再置 true —— 那样首帧 loading 为 false，会先渲染一张**空表**，
     * 下一帧才换成占位，表格跟着挂载又卸载一次。
     */
    const [loadingDetail, setLoadingDetail] = useState<boolean>(matrixID !== '');
    const [detailFailed, setDetailFailed] = useState<boolean>(false);

    /** 保存进行中（校验要发请求、查重还要等用户确认）：既防连点，也给按钮一个禁用态 */
    const [saving, setSaving] = useState(false);

    /**
     * 单元格问题标记（`section|rowKey|field` → 文案）：交给下面三张表画红底 + 悬停提示。
     *
     * 一次保存校验算一份，整体替换 —— 不做增量，省得「这一格修好了、那一格又漏了」两头对不上。
     * 某一格被用户改过就单独撤掉它（`handleCellChange`），别让红底留到下一轮保存。
     */
    const [cellIssues, setCellIssues] = useState<BomMatrixCellIssueMap>({});

    /** 某一格改过了：撤掉它的标记（键里带表名，改配色不会误清子项物料的同名格） */
    const handleCellChange = useCallback((section: BomMatrixSection, rowKey: string, field: string) => {
        setCellIssues((prev) => {
            const key = cellIssueKey(section, rowKey, field);
            if (!(key in prev)) return prev;
            const next = {...prev};
            delete next[key];
            return next;
        });
    }, []);

    /** 详情请求序号：关闭弹窗 / 重新拉取时让在飞的旧结果作废 */
    const detailSeqRef = useRef(0);

    /**
     * 取详情：**弹窗自己的事**，不复用页面上那份 `bomMatrix`。
     *
     * 页面那份跟着「主表选中行」走，而编辑按钮只看「有没有选中」—— 详情可能还在路上，
     * 也可能还是上一行的。混用两份数据会在弹窗里出现「编码是 A、明细是 B」。
     *
     * @param targetID 要取哪一份。**保存成功后必须按新主键重取**：新增时 props 上的
     *   `matrixID` 还是空串，只有接口返回的 `PackBomMatrixID` 才指向刚落库的那一份。
     * @param quiet 静默刷新（保存后的重取）：不切「加载中」占位。那时屏幕上已经是好数据，
     *   切过去等于把三张表整块卸掉再装回来 —— 行内编辑、滚动位置、选中的标签页全丢。
     */
    const loadDetail = useCallback(async (targetID?: string, quiet = false) => {
        const id = toStringOrEmpty(targetID).trim();
        const seq = ++detailSeqRef.current;
        if (!id) return;
        if (!quiet) setLoadingDetail(true);
        try {
            const result = await packBomMatrixApi.detail(id);
            if (seq !== detailSeqRef.current) return;
            const next = result.data ?? null;
            setDetailRecord(next);
            if (next) {
                /*
                 * 表单初值是主表摘要（只有编码 / 项目那几个字段），详情补齐 VID、主单位、换算率…
                 * 产成品那一组还要按**明细第一行**回填（详情里没有它的编码 / 名称 / 规格）。
                 */
                form.setFieldsValue({...next, ...readSewFields(next)} as Record<string, unknown>);
            }
        } catch (err) {
            if (seq !== detailSeqRef.current) return;
            setDetailFailed(true);
            void message.error(ErrorMessage(err, '矩阵详情加载失败'));
        } finally {
            if (seq === detailSeqRef.current) setLoadingDetail(false);
        }
    }, [form, message]);

    /*
     * 加载放在 effect 里，只有「打开」这一个触发点（弹窗由页面用 key 重挂载，open 恒定）。
     *
     * oxlint 会为 `void loadDetail()` 报一条 `set-state-in-effect`：那是静态分析对
     * 「effect 里调 async 加载函数」的误判 —— 这里的 setState 都在 `await` 之后，
     * 属于请求落地，不是渲染期的级联更新。与页面 `index.tsx` 的 `loadData` 同一情况。
     */
    useEffect(() => {
        if (!open) {
            // 关闭时作废在飞的请求：结果回来也没有地方落（下次打开是新的弹窗实例）
            detailSeqRef.current += 1;
            return;
        }
        // 新增没有详情可拉；编辑 / 复制 / 查看一挂载就去取
        if (!matrixID) return;
        void loadDetail(matrixID);
    }, [open, matrixID, loadDetail]);

    /** 重试：先把状态摆回「在加载」，再发一次请求（首次加载的 loading 由 state 初值负责） */
    const retryDetail = useCallback(() => {
        setDetailFailed(false);
        setLoadingDetail(true);
        // 保存成功后 recordID 会变成本次落库的主键，重试按它取（拿不到才退回打开时那个）
        void loadDetail(recordID || matrixID);
    }, [loadDetail, recordID, matrixID]);

    /**
     * 弹窗里用的底稿：拿到详情就全用详情，没拿到（新增 / 加载中）用主表那一行兜着。
     *
     * 加载中表单要能看出「这是哪一份」（编码 / 项目），所以这里不回退成空对象。
     */
    const baseRecord = detailRecord ?? record;

    /**
     * 自动铺进子项明细的那一行（缝制物料）；`null` = 还没选产成品。
     *
     * **数据源是矩阵本身，不是子项明细表**：配色 / 配码是 `toColorRows` / `toSizeRows`
     * 按 `Detail` + `ColorMatch` / `SizeMatch` 派生的 —— 只往 items 表塞一行，
     * 另两张表根本不知道有这一行，颜色、尺码也就无从按这个物料定制。
     * 所以这里存成「矩阵的一行」，由 `matrix` 派生下去，三张表一起变。
     */
    const [sewRow, setSewRow] = useState<PackBomMatrixDetail | null>(null);

    /**
     * 用户已经在表格里编辑过、且**不属于缝制物料**的那些明细行。
     *
     * 为什么要单独存：行数据活在子项物料表自己的 state 里，而换产成品会让 `matrix` 换一个引用
     * （`Detail` 变了 → 表格按新输入重新派生），那些未落库的编辑会被顶掉。
     * 所以换产成品之前先 `readRows('items')` 把它们捞出来存这里，再连同新第一行一起交给表格 ——
     * 换产成品只该换第一行，用户选的其它物料得原样在。
     *
     * 配色 / 配码的本地编辑**不回收**：颜色、尺码是产成品物料的属性，换物料本来就该按新物料重算。
     */
    const [detailRows, setDetailRows] = useState<PackBomMatrixDetail[] | null>(null);

    /**
     * 产成品带出来的颜色 / 尺码清单 —— 配色表、配码表的**列**。
     *
     * 为什么必须单独存：那两张表的列是按 `ColorSort` / `SizeSort` 生成的，
     * 而这两份清单只由**详情接口**给出。新增时底稿是空对象，选了产成品却没人去取，
     * 两张表就只剩「物料」那几列 —— 屏幕上表现为「有行、但颜色/尺码区一片空白」。
     *
     * `null` = 还没有按产成品算过（用底稿自带的那份）；非空 = 以它为准，
     * 所以清空产成品要一起置回 `null`（回到底稿那副样子）。
     */
    const [sewSort, setSewSort] = useState<{
        colors: string[];
        sizes: string[],
        /**
         * 字典原项（名称 + 编码），`colors` / `sizes` 只是它的名称那一列。
         *
         * 界面桥要用它：配色 / 配码表里可编辑的是**名称列**（`红` / `260`），
         * 而保存时 `ColorMatch.VFree6` / `SizeMatch.VFree7` 要的是**编码**（存在 `{列名}_val`）。
         * agent 只知道名称，得由这里按名查出编码一起写进去，否则保存时色号编码是空的。
         */
        colorItems: NCMaterialVFree[],
        sizeItems: NCMaterialVFree[],
        colorMatch: Record<string, Record<string, PackBomMatrixColorMatch>>,
        sizeMatch: Record<string, Record<string, PackBomMatrixSizeMatch>>,
    } | null>(null);

    /** 只读子项明细表：换产成品前用它把用户编辑过的行捞回来 */
    const matrixRef = useRef<BomMatrixViewApi | null>(null);

    /**
     * 颜色 / 尺码字典的请求序号：连着选两个产成品时**只认最后一次**的结果。
     *
     * 两个物料的请求会各自在路上，谁先回来不确定；没有这道闸，先选的物料
     * 晚上一步就会把后选的那份列覆盖掉（列和产成品对不上，且用户看不出来）。
     */
    const sewSortSeqRef = useRef(0);

    /**
     * 明细 = 底稿 + 回收的明细行 + 自动第一行。
     *
     * **只随「行内容」变化**，刻意不带颜色 / 尺码列 —— 两者是不同维度的事：
     * 三张表都拿 `bomMatrix.Detail` 当派生源（`useEditableRows` 按引用判「换没换数据」），
     * 列清单一变就把 Detail 重造一次，等于告诉表格「换了一份数据」，
     * 它会把本地改动整体作废 —— 表现就是「选了产成品、底部那行待输入的空行闪一下就没了」
     * （空行是选定产成品那一刻补的，颜色字典稍后异步回来正好赶上）。
     */
    const detail = useMemo<PackBomMatrixDetail[]>(() => {
        const source = detailRows ?? baseRecord?.Detail ?? [];
        if (!sewRow) return source;
        const index = source.findIndex((row) => toStringOrEmpty(row.VRowNo) === '10');
        const next = [...source];
        if (index >= 0) {
            // 底稿里已经有第 10 行：只覆盖物料相关字段，用户填过的损耗 / 数量保留
            next[index] = {...next[index], ...sewRow};
        } else {
            next.unshift(sewRow);
        }
        return next;
    }, [baseRecord, detailRows, sewRow]);

    /**
     * 交给下方表格的矩阵 = 明细 + 产成品带出的颜色 / 尺码列。
     *
     * 派生而不是把行写进底稿：底稿是外面传进来的，弹窗没有权力改它；
     * 派生也保证「清空产成品」= 把几个 state 置空，底稿立刻回到原样
     * （`sewRow` / `detailRows` 都空时直接返回底稿本身，连 `Detail` 都不重造）。
     */
    const matrix = useMemo<PackBomMatrix>(() => {
        const base = baseRecord ?? {};
        /*
         * 颜色列 / 尺码列跟着产成品走：选了产成品就按它的辅助属性字典重算
         * （换物料本来就该换一批颜色、尺码），没选就是底稿带进来的那一份。
         */
        const scoped = sewSort ? {
            ...base,
            ColorSort: sewSort.colors,
            SizeSort: sewSort.sizes,
            ColorMatch: sewSort.colorMatch,
            SizeMatch: sewSort.sizeMatch
        } : base;
        if (!sewRow && !detailRows) return scoped;
        return {...scoped, Detail: detail};
    }, [baseRecord, detail, detailRows, sewRow, sewSort]);

    /**
     * 两个分组各自的物料 —— 单位选择要按它取可选列表，所以都盯着。
     *
     * 优先 `VID`（接口里真正的关联键）；产成品还看 `Code`，因为它是界面上的选料入口。
     */
    const packMaterialVID = Form.useWatch('PackMaterialVID', form);
    const sewMaterialVID = Form.useWatch('SewMaterialVID', form);
    const sewMaterialCode = Form.useWatch('SewMaterialCode', form);

    /** 产成品到底选了没有 —— **子项明细能不能编就看它** */
    const hasSewMaterial = !isBlank(sewMaterialVID) || !isBlank(sewMaterialCode);

    /** 表格能不能编：查看模式恒不能；其余模式要求先选了产成品 */
    const canEditMatrix = mode !== 'view' && hasSewMaterial;

    /**
     * 「生成」= 打开「包装BOM矩阵明细」发布弹窗（与页面命令条的「发布」同一个界面）。
     *
     * 原系统里这一步是按当前矩阵生成 BOM 并推给下游：规则怎么推、推哪几条，
     * 都在那个弹窗里决定，这里只负责把它打开 —— 不要在这里再实现一遍发布逻辑。
     */
    const [pushOpen, setPushOpen] = useState(false);

    const handleGenerate = useCallback(() => {
        if (!recordID) {
            void message.warning('保存成功（拿到矩阵主键）后才能生成');
            return;
        }
        setPushOpen(true);
    }, [message, recordID]);

    const handleClosePush = useCallback(() => setPushOpen(false), []);

    /** 复制：把当前这份内容复制成新的（不改原记录） */
    const handleCopy = useCallback(() => {
        void message.info('复制：复制为新矩阵的功能还没接入');
    }, [message]);

    /**
     * 包装成品选中物料：把物料属性一次带出来。
     *
     * 口径与 BOM 矩阵里格子的「选物料」一致（见 `components/nc/bomMatrix/itemView.tsx` 的 `applyMaterial`）：
     * 单位取第一个换算单位，没有就退回物料主单位；换算率没有时给 `1/1`（后端按「单位 + 换算率」
     * 还原子项数量，留空会算不出来）。
     *
     * `PackMaterialCode` 也一起写：界面上选物料时编码由 `MaterialSelect` 的 onChange 负责，
     * 而编辑打开时是**按底稿里的 VID 回查档案**（见 `loadPackArchive`），没有 onChange 这一下，
     * 编码那一格就还是底稿里那串（可能为空）—— 两处写同一个值不会打架。
     *
     * @param options.keepUnits 保留表单里已有的「单位 + 换算率」。
     *   编辑打开时用：库里存的是用户当时选的单位，物料档案里第一个换算单位不一定是它，
     *   无声替换等于替用户改了单据。
     */
    const applyPackMaterial = useCallback((material: NCMaterial, options?: { keepUnits?: boolean }) => {
        const convert = material.materialconvert?.[0];
        /*
         * 单位列表当场登记进缓存（与 itemView 的 `applyMaterial` 同一做法）：
         * 单位弹窗一打开就是满的，不用再回查一次接口。
         */
        putConverts(toStringOrEmpty(material.pk_material), material.materialconvert);
        const fields: Record<string, unknown> = {
            PackMaterialVID: material.pk_material,
            PackMaterialCode: material.code,
            PackMaterialName: material.name,
            PackMaterialSpec: material.materialspec,
            PackMaterialModel: material.materialtype,
            PackMaterialVersion: material.version,
            CMeasure: material.measdoc,
            // 主单位的主键：矩阵头上与明细行一样要带（保存时后端按它认单位）
            CMeasureid: material.pk_measdoc,
        };
        if (!options?.keepUnits) {
            fields.Cassmeasure = convert?.measdoc ?? material.measdoc;
            fields.Cassmeasureid = convert?.pk_measdoc ?? material.pk_measdoc;
            fields.VChangerate = convert?.measrate ?? '1/1';
        } else if (isBlank(form.getFieldValue('Cassmeasureid'))) {
            // 详情没带单位主键（历史数据）：按库里存的单位名，在物料档案里对上一条
            const kept = toStringOrEmpty(form.getFieldValue('Cassmeasure')).trim();
            const matched = (material.materialconvert ?? []).find(
                (item) => toStringOrEmpty(item.measdoc).trim() === kept,
            );
            if (!isBlank(matched?.pk_measdoc)) fields.Cassmeasureid = matched?.pk_measdoc;
        }
        form.setFieldsValue(fields);
    }, [form]);

    /** 包装物料档案回查的请求序号：重试 / 换底稿时只认最后一次的结果 */
    const packArchiveSeqRef = useRef(0);

    /**
     * 按底稿里的包装物料回查一次物料档案（编辑 / 复制 / 查看打开时）。
     *
     * 为什么要查：详情接口只给 `PackMaterialVID` / `PackMaterialCode` / `PackMaterialName` / 换算率，
     * **没有版本、规格、型号、主单位** —— 不查的话编辑一打开这几个格子全是空的，看着像数据丢了；
     * 顺便把换算单位登记进缓存，点「单位」不用再等一次接口。
     *
     * 查不到不算失败：档案里没有这个物料（历史脏数据）时只说一句，表单照样能看能改。
     */
    const loadPackArchive = useCallback(async (packVID: string, packCode: string, keepUnits: boolean) => {
        const seq = ++packArchiveSeqRef.current;
        try {
            // 优先按主键查（同编码可能有多个版本）；只拿到编码时才按编码查
            const result = await ncMaterialApi.query(packVID ? {materialPK: packVID} : {code: packCode});
            if (seq !== packArchiveSeqRef.current) return;
            const list = result.data ?? [];
            const material =
                list.find((item) => toStringOrEmpty(item.pk_material) === packVID)
                ?? list.find((item) => toStringOrEmpty(item.code) === packCode)
                ?? list[0];
            if (!material) {
                void message.warning(
                    `没查到包装物料「${packCode || packVID}」的档案：版本 / 规格 / 型号显示不出来（不影响改单，保存时以编码为准）`,
                );
                return;
            }
            applyPackMaterial(material, {keepUnits});
        } catch (err) {
            if (seq !== packArchiveSeqRef.current) return;
            // 只是补展示字段：失败不拦编辑，也不把已经显示出来的值清掉
            void message.warning(ErrorMessage(err, '包装物料档案查询失败：版本 / 规格 / 型号显示不全'));
        }
    }, [applyPackMaterial, message]);

    /*
     * 详情一到就按它回查包装物料（新增没有底稿，不走这条）。
     *
     * 依赖 `detailRecord` 而不是 `open`：详情是异步来的，第一帧只有主表摘要。
     * 清理时作废在飞的请求 —— 弹窗销毁后表单实例已经摘下来，结果回来没有地方落。
     */
    useEffect(() => {
        if (!open || !detailRecord) return;
        const packVID = toStringOrEmpty(detailRecord.PackMaterialVID).trim();
        const packCode = toStringOrEmpty(detailRecord.PackMaterialCode).trim();
        if (!packVID && !packCode) return;
        // 库里存过单位就留着它（见 applyPackMaterial 的 keepUnits）
        void loadPackArchive(packVID, packCode, !isBlank(detailRecord.Cassmeasure));
        return () => {
            packArchiveSeqRef.current += 1;
        };
    }, [open, detailRecord, loadPackArchive]);

    /**
     * 把产成品物料铺成子项明细的一行（**行号固定 10**）。
     *
     * 为什么要有这一行：缝制物料本身就是包装 BOM 的一条明细 —— 选了产成品却在明细里看不到它，
     * 用户会以为没选上。写进 `sewRow`（而不是往子项物料表塞一行），是因为配色 / 配码
     * 都按矩阵的 `Detail` 派生，走派生这条路三张表才会一起认下这一行。
     *
     * 再次选物料时只改**同一行**（主键沿用第一次的 `draft-N`），不会再追加。
     */
    const buildSewRow = useCallback((material: NCMaterial): PackBomMatrixDetail => {
        const convert = material.materialconvert?.[0];
        const row = {
            ...createItemRow('10'),
            VRowNo: '10',
            MaterialVID: material.pk_material,
            MaterialCode: material.code,
            MaterialName: material.name,
            MaterialVersion: material.version,
            MaterialSpec: material.materialspec,
            MaterialType: material.materialtype,
            CMeasureid: material.pk_measdoc,
            CMeasure: material.measdoc,
            Cassmeasure: convert?.measdoc ?? material.measdoc,
            Cassmeasureid: convert?.pk_measdoc ?? material.pk_measdoc,
            VChangerate: convert?.measrate ?? '1/1',
        };
        return row as PackBomMatrixDetail;
    }, []);

    /**
     * 按产成品取「缝制颜色 / 缝制尺码」清单（`ColorSort` / `SizeSort`）。
     *
     * 这两份清单就是配色表、配码表的列 —— 不取，那两张表选了产成品也只有「物料」列，
     * 看着就是「有行没数据」。
     *
     * 两个字典都空时说一句：那是产成品物料档案没维护 `vfree6` / `vfree7`，
     * 不是表格坏了；不说的话用户只会反复点产成品。
     */
    const loadSewSort = useCallback(async (materialVID: string) => {
        const seq = ++sewSortSeqRef.current;
        if (!materialVID) {
            setSewSort(null);
            return;
        }
        try {
            const [colors, sizes] = await Promise.all([
                ncMaterialApi.vfree({fieldName: BOMMATRIX_COLOR_VFREE_FIELD, pkMaterial: materialVID}),
                ncMaterialApi.vfree({fieldName: BOMMATRIX_SIZE_VFREE_FIELD, pkMaterial: materialVID}),
            ]);
            // 期间又换了产成品：这份结果已经作废，落地就会把界面上的列换成上一个物料的
            if (seq !== sewSortSeqRef.current) return;
            /*
             * `colorMatch` / `sizeMatch` 目前留空 = **不按字典预填格子的色号 / 尺码系数**，
             * 由用户在两张表里逐格选。字段留着是为了「按产成品带一份默认匹配」时直接填这里，
             * 不必再改 state 的形状。
             */
            const next = {
                colors: toSortNames(colors.data),
                sizes: toSortNames(sizes.data),
                // 字典原项留着：界面桥写色号 / 尺码系数时要按名查出编码（见 state 上的注释）
                colorItems: colors.data ?? [],
                sizeItems: sizes.data ?? [],
                colorMatch: toColorMatch(materialVID, '10', colors.data),
                sizeMatch: toSizeMatch(materialVID, '10', sizes.data),
            };
            setSewSort(next);
            if (next.colors.length === 0 && next.sizes.length === 0) {
                void message.warning('这个产成品没有维护颜色（vfree6）/ 尺码（vfree7）辅助属性，配色 / 配码没有列可铺');
            }
        } catch (err) {
            if (seq !== sewSortSeqRef.current) return;
            /*
             * 取不到就按「没有列」处理，**不要**保留底稿那份：那是上一个产成品的颜色 / 尺码，
             * 留在屏幕上会让人以为新物料也是这些颜色。
             */
            setSewSort({colors: [], sizes: [], colorItems: [], sizeItems: [], colorMatch: {}, sizeMatch: {}});
            void message.error(ErrorMessage(err, '产成品的颜色 / 尺码清单加载失败'));
        }
    }, [message]);

    /** 产成品同理；另外把 `SewMaterialVID` 填上 —— 它是「子项明细能不能编」的判据 */
    const applySewMaterial = useCallback((material: NCMaterial) => {
        const materialVID = toStringOrEmpty(material.pk_material);
        /*
         * 选中的还是当前这个产成品 → **什么都不用重做**。
         *
         * 重建第一行会让 `matrix.Detail` 换引用、下面三张表整体重铺：用户刚在子项物料里填的
         * 那几行（内容一样）会重来一遍，底部那行空行也跟着闪没了。放放大镜里又点回同一个物料
         * 是很常见的动作（误点、想确认一下），不该有副作用。
         */
        if (materialVID && materialVID === toStringOrEmpty(form.getFieldValue('SewMaterialVID'))) {
            return;
        }
        const convert = material.materialconvert?.[0];
        putConverts(materialVID, material.materialconvert);
        form.setFieldsValue({
            SewMaterialVID: material.pk_material,
            SewMaterialCode: material.code,
            SewMaterialName: material.name,
            SewMaterialVersion: material.version,
            SewMaterialSpec: material.materialspec,
            SewMaterialModel: material.materialtype,
            SewCMeasure: material.measdoc,
            SewCassmeasure: convert?.measdoc ?? material.measdoc,
            SewVChangerate: convert?.measrate ?? '1/1',
        });
        /*
         * 换产成品 = 换第一行，**其它行必须原样留着**。
         *
         * 行数据活在子项物料表自己的 state 里（用户在里面增删改），而下面 `setSewRow` 会换掉
         * `matrix.Detail` 的引用、让表格按新输入重新派生 —— 不先把它们捞出来，用户刚选的物料就没了。
         * 读的是 `readRows('items')`（含未保存的编辑），不是 `matrix.Detail`（那是上一次派生的结果）。
         */
        const currentRows = (matrixRef.current?.readRows('items') ?? matrix.Detail ?? []) as PackBomMatrixDetail[];
        const existedSewRow = currentRows.find((row) => toStringOrEmpty(row.VRowNo) === '10');
        setDetailRows(currentRows.filter((row) => toStringOrEmpty(row.VRowNo) !== '10'));
        // 换物料时沿用第一次的临时主键，表格不会把它当成「删一行又加一行」
        const nextRow = buildSewRow(material);
        /*
         * 编辑态：明细里第 10 行是**已落库**的，沿用它自己的主键。
         *
         * 不沿用的话这一行会变成 `draft-N` 的新行、原来那行被过滤掉，
         * 保存时就是「删一行再加一行」—— 那一行上的历史字段（转换率、发料方式、批号…）也跟着换身份。
         */
        if (existedSewRow) {
            nextRow.PackBomMatrixDetailID =
                toStringOrEmpty(existedSewRow.PackBomMatrixDetailID) || nextRow.PackBomMatrixDetailID;
        }
        setSewRow((prev) => (prev ? {...prev, ...nextRow} : nextRow));
        /*
         * 颜色列 / 尺码列按新产成品重取：这两份清单是物料的辅助属性字典，
         * 只有**这个产成品**身上才有 —— 从底稿或上一个物料那儿继承都是错的。
         */
        void loadSewSort(materialVID);
    }, [form, buildSewRow, matrix, loadSewSort]);

    /**
     * 物料被清空：把**由物料带出来的字段一起清掉**。
     *
     * 与 `applyPackMaterial` 是同一张字段表的两个方向 —— 以后加字段时两边都要看一眼，
     * 否则会留下「编码空了、名称还挂着上一个物料」的假数据，看着像还在编辑那一份。
     */
    const clearPackMaterial = useCallback(() => {
        // 在飞的档案回查一并作废：它回来时物料已经被清掉，不该再把属性填回去
        packArchiveSeqRef.current += 1;
        form.setFieldsValue({
            PackMaterialVID: undefined,
            PackMaterialName: undefined,
            PackMaterialVersion: undefined,
            PackMaterialSpec: undefined,
            PackMaterialModel: undefined,
            CMeasure: undefined,
            CMeasureid: undefined,
            Cassmeasure: undefined,
            Cassmeasureid: undefined,
            VChangerate: undefined,
        });
    }, [form]);

    /**
     * 定下一个项目：**编码与主键是一组**（后端 `ProjectID` / `ProjectCode` 都要）。
     *
     * 两条路都落到这里：界面上选中项目（`ProjectSelect` 的 onSelect）、
     * agent 写项目号查库命中（桥经 `ctx.applyProject` 调它）——
     * 只留编码不写主键，保存时会被「请选择订单号」挡下（原系统就是这么判的）。
     */
    const applyProject = useCallback((project: NCProject) => {
        form.setFieldsValue({
            ProjectID: project.pk_project,
            ProjectCode: project.project_name,
        });
    }, [form]);

    /**
     * 项目被清空：主键一并清掉。
     * 编码空了、主键还指着上一个项目，保存时后端会按旧项目入库 —— 那是最难查的一类脏数据。
     */
    const clearProject = useCallback(() => {
        form.setFieldsValue({ProjectID: undefined, ProjectCode: undefined});
    }, [form]);

    /**
     * 选中单位：单位名、单位主键与换算率是**一组**（后端按「单位 + 换算率」还原子项数量），
     * 只改单位名会留下上一个单位的比率 —— 与 itemView 的 `applyConvert` 同一口径。
     */
    const applyPackConvert = useCallback((convert: NCMaterialConvert) => {
        form.setFieldsValue({
            Cassmeasure: convert.measdoc,
            Cassmeasureid: convert.pk_measdoc,
            VChangerate: convert.measrate,
        });
    }, [form]);

    const applySewConvert = useCallback((convert: NCMaterialConvert) => {
        form.setFieldsValue({SewCassmeasure: convert.measdoc, SewVChangerate: convert.measrate});
    }, [form]);

    /** 产成品物料被清空：`SewMaterialVID` 一并清掉 —— 它是「子项明细能不能编」的判据，清空即禁用 */
    const clearSewMaterial = useCallback(() => {
        form.setFieldsValue({
            SewMaterialVID: undefined,
            SewMaterialName: undefined,
            SewMaterialVersion: undefined,
            SewMaterialSpec: undefined,
            SewMaterialModel: undefined,
            SewCMeasure: undefined,
            SewCassmeasure: undefined,
            SewVChangerate: undefined,
        });
        /*
         * 清空产成品 = 这次换物料带来的东西全部回退：自动第一行、「回收的明细快照」、
         * 以及按它取的颜色 / 尺码清单都清掉，回到底稿那副样子。只清 `sewRow` 是不够的 ——
         * 回收快照里已经不含第 10 行，留着它会让底稿原有的第 10 行也跟着消失。
         */
        // 在飞的字典请求一并作废：它回来时已经把产成品清掉了，不该再往表里塞列
        sewSortSeqRef.current += 1;
        setSewSort(null);
        setSewRow(null);
        setDetailRows(null);
    }, [form]);

    /**
     * 详情就绪没有：编辑 / 复制 / 查看要先等详情，新增天生就绪。
     *
     * 界面桥的 `ready` 与「三张表能不能读」都问它 —— 详情没到之前字段是空的、表格也没渲染，
     * 那时看快照的模型会以为「这份矩阵本来就这么空」。
     */
    const detailReady = useCallback(
        () => !loadingDetail && !detailFailed,
        [loadingDetail, detailFailed],
    );

    /**
     * 某个字段此刻为什么改不了（null = 可以改）。
     *
     * **锁的唯一真相在这里**：界面上的 `disabled`（只读字段）与界面桥的 `fieldLock` 读同一份判断。
     * 桥那边再推一遍「查看模式只读 / 详情没到别改」必然与界面漂移 —— 界面上能改、agent 那儿说不能。
     */
    const fieldLock = useCallback((_fieldId: string): string | null => {
        if (mode === 'view') return '当前是查看模式：整张表单只读';
        if (loadingDetail) return '矩阵详情还在加载：加载完会整体覆盖一次，改了也留不住';
        if (detailFailed) return '矩阵详情没加载出来：先点表格位置的「重试」，否则改了会被覆盖';
        return null;
    }, [mode, loadingDetail, detailFailed]);

    /**
     * 按分组把物料属性带出来（界面桥的 form.set 写物料编码时走这里）。
     *
     * 就是用户在选择器里选中物料的同一条路 —— 产成品还会重铺明细第一行、按新物料重取颜色 / 尺码列，
     * 桥要是自己回填那几个字段，产成品那一整套副作用就漏了。
     */
    const applyMaterialByGroup = useCallback((group: BomMatrixFieldGroup, material: NCMaterial) => {
        if (group === 'sew') applySewMaterial(material);
        else applyPackMaterial(material);
    }, [applySewMaterial, applyPackMaterial]);

    /** 按分组写「单位 + 换算率」（与界面上选单位同一条路） */
    const applyConvertByGroup = useCallback((group: BomMatrixFieldGroup, convert: NCMaterialConvert) => {
        if (group === 'sew') applySewConvert(convert);
        else applyPackConvert(convert);
    }, [applySewConvert, applyPackConvert]);

    /**
     * 某张矩阵表的当前行（含未保存的编辑）。
     *
     * 走控件的 `readRows` 而不是 `readTable`：面板是懒挂载的，没切过去的那两张读不到实例，
     * 但它们的行数据可以按当前明细现算 —— 与第一次打开时看到的一致。
     */
    const readMatrixRows = useCallback(
        (section: BomMatrixSection) => matrixRef.current?.readRows(section) ?? [],
        [],
    );

    /**
     * 某张矩阵表的**行级写能力**（`addRow` / `removeRow` / `updateRow`）。
     *
     * 界面桥的写命令走它而不是直接改行数组：子项物料表的行事件就是在这里发出的，
     * 父级据此让配色 / 配码各改各的行 —— 绕过它改，三张表当场就对不上了。
     * 面板没渲染过时是 null（写必须落到真实的表上）。
     */
    const readMatrixGrid = useCallback(
        (section: BomMatrixSection) => matrixRef.current?.readGrid(section) ?? null,
        [],
    );

    /**
     * 下方三张表此刻为什么不能编（null = 能编）。
     *
     * 判据与界面上的「蒙层」同一条（`canEditMatrix`）：查看模式恒不能；其余模式要求先选产成品。
     * 桥若自己另算一遍，就会出现「界面上蒙着、agent 却能改」。
     */
    const matrixEditLock = useCallback((): string | null => {
        if (mode === 'view') return '当前是查看模式：下方三张表只读';
        if (!hasSewMaterial) {
            return '还没选产成品物料：先 form.set SewMaterialCode（它决定下方三张表能不能编）';
        }
        return null;
    }, [mode, hasSewMaterial]);

    /**
     * 保存前的全部准备：**校验 → 查重 → 组合**（顺序照原系统 `btnSave_Click`）。
     *
     * 取值全走「此刻能读到的最新状态」：表单是 `form.getFieldsValue()`（含刚写的值），
     * 表格是 `readRows`（含未保存的增删改，且懒挂载的那两张会按当前明细现算）。
     * 规则分两处：校验与查重在 `./bomMatrixValidation`，装配在 `./bomMatrixPayload`。
     * 界面上的「保存」与 agent 的 `form.submit` 都走这一条路 —— 两边各写一份迟早对不上。
     *
     * 详情还在路上 / 加载失败 / 查看模式一律不往下走：那时表单只有主表摘要、三张表是空的，
     * 拿它去校验只会报一堆「没填」，组合出来的也是一份空矩阵。
     */
    const prepareSave = useCallback(async (): Promise<SavePreparation> => {
        const blocked = fieldLock('form.submit');
        if (blocked) return {kind: 'invalid', messages: [blocked], issues: []};

        const values = form.getFieldsValue();
        const detailRows = readMatrixRows('items');
        const colorRows = readMatrixRows('colors');
        const sizeRows = readMatrixRows('sizes');
        const checkInput = {
            mode,
            // 用 recordID 而不是打开时的 matrixID：新增保存成功后会拿到主键，再保存就是改这一份
            matrixID: recordID,
            values,
            detail: detailRows,
            colorRows,
            sizeRows,
            colorSort: matrix.ColorSort,
            sizeSort: matrix.SizeSort,
        };

        const check = await validateBomMatrix(checkInput);
        if (!check.ok) {
            /*
             * 校验不过：把结构化的那份（哪张表、哪一行、哪一列）交给下面三张表标红，
             * 人话的那份留在弹窗里逐条列。两份同源，指哪打哪。
             */
            setCellIssues(toCellIssueMap(check.issues));
            // 被拦下时也打一份：不然只能靠猜「界面此刻到底是什么样」
            console.log('[包装BOM矩阵] 保存校验没通过', {
                mode,
                matrixID: recordID || '(新增)',
                原因: check.messages,
                问题单元格: check.issues,
                表单值: values,
                明细行: detailRows,
                配色行: colorRows,
                配码行: sizeRows,
            });
            return {kind: 'invalid', messages: check.messages, issues: check.issues};
        }

        // 校验过了：上一轮留下的红格子该收了
        setCellIssues({});
        const payload = buildPackBomMatrix({...checkInput, base: matrix});
        // 查重（`dataSingleCheck` 现在恒 false，具体检测逻辑在那边补）
        const duplicate = await dataSingleCheck(checkInput);

        /*
         * 打一份到控制台：接保存接口前要拿「组合结果」跟「原始编辑对象」逐字段对，
         * 界面上只看得到 JSON、没法展开对比。分组打印，需要哪块展开哪块。
         */
        console.log('[包装BOM矩阵] 保存组合', {
            mode,
            matrixID: recordID || '(新增)',
            查重命中: duplicate,
            原始编辑对象: detailRecord ?? record,
            基底矩阵: matrix,
            表单值: values,
            明细行: detailRows,
            配色行: colorRows,
            配码行: sizeRows,
            组合结果: payload,
        });

        return duplicate ? {kind: 'duplicate', payload} : {kind: 'ready', payload};
    }, [fieldLock, form, readMatrixRows, mode, matrix, recordID, detailRecord, record]);

    /**
     * 真正落库：把组合结果转成接口形态提交，拿回 `PackBomMatrixID`。
     *
     * 失败原样回原因（不抛）：保存按钮要把这句话弹成 toast，桥的 `form.submit` 要把它塞进回执，
     * 两边都要「能读懂的一句话」，所以在这一层收敛成 `{ok, message}`。
     */
    const persist = useCallback(async (
        prepared: { payload: PackBomMatrix },
    ): Promise<{ ok: true; id: string } | { ok: false; message: string }> => {
        const body = toSavePayload(prepared.payload);
        console.log('[包装BOM矩阵] 提交保存', body);
        try {
            const result = await packBomMatrixApi.save(body);
            const saved = result.data;
            console.log('[包装BOM矩阵] 保存返回', saved);
            const id = toStringOrEmpty(saved?.PackBomMatrixID).trim();
            if (!id) {
                // 存进去了却没回主键：没法重取、没法继续编辑/生成，如实说，别当成功
                return {
                    ok: false,
                    message: '保存已提交，但接口没有返回 PackBomMatrixID，无法重新载入这份矩阵（请刷新列表确认）'
                };
            }
            return {ok: true, id};
        } catch (err) {
            return {ok: false, message: ErrorMessage(err, '保存失败')};
        }
    }, []);

    /**
     * 保存成功之后：记主键 → 丢掉本地派生 → **按新主键重取一遍完整数据**。
     *
     * 为什么要重取：接口落库时会补一堆界面上没有的东西（明细主键、矩阵版本、审计字段、颜色/尺码
     * 匹配的真实键），不重取的话用户接着改的是「自己拼的那一份」—— 再保存一次就成了另一次新增。
     * 重取也是「生成 / 复制」能用的前提：它们要按库里的那份记录做事。
     */
    const acceptSaved = useCallback(async (id: string) => {
        setRecordID(id);
        // 上一轮的校验标记作废（新数据可能已经合规）
        setCellIssues({});
        /*
         * 三个本地派生全部清掉：`matrix` 的 memo 优先用它们（换产成品时的第一行快照、
         * 回收的明细、按产成品算的颜色尺码列），留着就会把刚取回来的明细盖住 ——
         * 屏幕上还是保存前那份，用户以为没存上。
         */
        setSewRow(null);
        setDetailRows(null);
        setSewSort(null);
        await loadDetail(id, true);
        onSaved?.(id);
    }, [loadDetail, onSaved]);

    /**
     * 保存：**校验 →（查重确认）→ 落库 → 按新主键重取**。
     *
     * 校验不过一次列全（`modal.warning`），别一条条弹；查重命中就问一次
     * 「是否重复添加」（原系统 `Common.ShowQuestion` 的口径），选「否」直接中止。
     * 存成功后弹窗**不关**：表单换成库里那一份，「生成 / 复制」当场可用。
     *
     * `saving` 既当重入闸也当按钮态：校验要查 `useVFree`（网络请求）、查重还要等用户点确认，
     * 期间连点两下会叠出两个确认框、两次提交。
     */
    const handleSave = useCallback(async () => {
        if (saving) return;
        setSaving(true);
        try {
            const prepared = await prepareSave();
            if (prepared.kind === 'invalid') {
                const rest = prepared.messages.length - MAX_SHOWN_MESSAGES;
                modal.warning({
                    title: '保存校验没通过',
                    width: 560,
                    okText: '知道了',
                    content: (
                        <div>
                            <ul className="bom-matrix-edit-errors">
                                {prepared.messages
                                    .slice(0, MAX_SHOWN_MESSAGES)
                                    .map((item) => <li key={item}>{item}</li>)}
                            </ul>
                            {rest > 0 && (
                                <div className="bom-matrix-edit-errors-more">
                                    还有 {rest} 处没列出来，见表格里标红的格子
                                </div>
                            )}
                            {prepared.issues.length > 0 && (
                                <div className="bom-matrix-edit-errors-more">
                                    不通过的格子已在下方表格里标红（共 {prepared.issues.length} 处），
                                    鼠标移上去能看到原因
                                </div>
                            )}
                        </div>
                    ),
                });
                return;
            }
            if (prepared.kind === 'duplicate') {
                /*
                 * 原系统：`Common.ShowQuestion(...，是否重复添加？)` —— 只问、不阻止。
                 *
                 * 用自己的 Promise 包一层：`modal.confirm` 返回的是关闭句柄，拿不到用户点了哪个。
                 * `afterClose` 也 resolve(false)：点遮罩 / 按 ESC 关闭等于「不重复添加」，不能让调用挂着。
                 */
                const confirmed = await new Promise<boolean>((resolve) => {
                    modal.confirm({
                        title: '确认',
                        content: '该订单当前包装物料存在相同的包装方法及数量数据，是否重复添加？',
                        okText: '是',
                        cancelText: '否',
                        onOk: () => resolve(true),
                        onCancel: () => resolve(false),
                        afterClose: () => resolve(false),
                    });
                });
                if (!confirmed) return;
            }
            const saved = await persist(prepared);
            if (!saved.ok) {
                void message.error(saved.message);
                return;
            }
            await acceptSaved(saved.id);
            void message.success(mode === 'edit' ? '已保存' : '已保存，可以接着编辑或生成');
        } finally {
            setSaving(false);
        }
    }, [saving, prepareSave, modal, persist, acceptSaved, message, mode]);

    /**
     * 色号 / 尺码系数的字典（名称 → 编码）。
     *
     * 配色 / 配码表里可编辑的是**名称列**（`红` / `260`），而保存时 `ColorMatch.VFree6`、
     * `SizeMatch.VFree7` 要的是**编码**（存在 `{列名}_val`）。agent 只知道名称，
     * 所以桥写这两列时得由这里按名查出编码一起写 —— 否则保存时色号 / 系数编码是空的。
     *
     * 两个来源按顺序取：
     * - `sewSort` 里的字典原项：刚按产成品取过，最全；
     * - 底稿已有的匹配（`ColorMatch` / `SizeMatch`）：编辑已有矩阵、还没换过产成品时只有这一份
     *   （它只含「已经填过的那些」，全新的色号在这里查不到，桥会如实拒绝）。
     */
    const readValueOptions = useCallback((kind: 'color' | 'size'): Array<{ name: string, id: string }> => {
        const dict = new Map<string, string>();
        const items = kind === 'color' ? sewSort?.colorItems : sewSort?.sizeItems;
        (items ?? []).forEach((item) => {
            const name = toStringOrEmpty(item.name).trim();
            if (name) dict.set(name, toStringOrEmpty(item.pk_defdoc));
        });
        if (dict.size === 0) {
            const matches = kind === 'color' ? matrix.ColorMatch : matrix.SizeMatch;
            Object.values(matches ?? {}).forEach((cells) => {
                Object.values(cells ?? {}).forEach((cell) => {
                    const name = toStringOrEmpty(kind === 'color'
                        ? (cell as PackBomMatrixColorMatch).VFree6Name
                        : (cell as PackBomMatrixSizeMatch).VFree7Name).trim();
                    if (!name) return;
                    dict.set(name, toStringOrEmpty(kind === 'color'
                        ? (cell as PackBomMatrixColorMatch).VFree6
                        : (cell as PackBomMatrixSizeMatch).VFree7));
                });
            });
        }
        return [...dict.entries()].map(([name, id]) => ({name, id}));
    }, [sewSort, matrix]);

    /** 表单级提示：详情加载失败不属于任何一个字段，界面只画在表格位置 */
    const formErrors = useCallback(
        () => (detailFailed ? ['矩阵详情没加载出来，下方三张表当前不可用（让用户点「重试」）'] : []),
        [detailFailed],
    );

    /**
     * 保存（界面桥的 form.submit 走这里）。
     *
     * 与界面上的「保存」同一条路（`prepareSave` 校验+查重 → `persist` 落库 → `acceptSaved` 重取），
     * 只是**不弹确认框** —— 模型看不见弹窗，它要的是回执：
     * - 校验不过 → 原因原样回（它能据此改字段，或如实转告用户）；
     * - 查重命中 → 要**用户**在界面上点「是 / 否」，模型不能替人决定，所以只如实说；
     * - 存成功 → 返回新主键 + 规模（模型接下来要核对/继续编辑就靠这个 ID）。
     */
    const submit = useCallback(async (): Promise<{ ok: boolean; message: string }> => {
        const prepared = await prepareSave();
        if (prepared.kind === 'invalid') {
            return {ok: false, message: prepared.messages.join('；')};
        }
        if (prepared.kind === 'duplicate') {
            return {
                ok: false,
                message: '该订单当前包装物料存在相同的包装方法及数量数据：这一步要**用户在界面上确认**「是否重复添加」，'
                    + '确认后才会保存。别替用户决定，把这句话原样转告他',
            };
        }
        const saved = await persist(prepared);
        if (!saved.ok) return {ok: false, message: saved.message};
        await acceptSaved(saved.id);
        const {payload} = prepared;
        const rowCount = payload.Detail?.length ?? 0;
        const colorCount = Object.keys(payload.ColorMatch ?? {}).length;
        const sizeCount = Object.keys(payload.SizeMatch ?? {}).length;
        return {
            ok: true,
            message: `已保存（PackBomMatrixID ${saved.id}；明细 ${rowCount} 行、颜色 ${colorCount} 个、尺码 ${sizeCount} 个），`
                + '弹窗已按新主键重新载入，可以继续改，也可以点「生成」/「复制」',
        };
    }, [prepareSave, persist, acceptSaved]);

    /**
     * 交给弹窗桥的状态与能力：字段表、动作表、提交语义都在 `./bomMatrixEditBridge`。
     *
     * 传取值函数而不是对象本身 —— 桥在 snapshot / 命令执行的那一刻才读，
     * 所以宿主不必跟着每次渲染重建。
     */
    const bridgeContext = useMemo<BomMatrixEditBridgeContext>(() => ({
        title: hasRecord && (mode === 'add' || mode === 'copy') ? EDIT_TITLE : MODE_TITLE[mode],
        mode,
        recordId: recordID || null,
        form,
        isReady: detailReady,
        fieldLock,
        applyMaterial: applyMaterialByGroup,
        applyConvert: applyConvertByGroup,
        applyProject,
        matrixReadable: detailReady,
        matrix,
        activeKey,
        setActiveKey,
        readRows: readMatrixRows,
        readGrid: readMatrixGrid,
        matrixEditLock,
        readValueOptions,
        formErrors,
        submit,
        close: onClose,
    }), [
        mode, recordID, hasRecord, form, detailReady, fieldLock, applyMaterialByGroup, applyConvertByGroup,
        applyProject,
        matrix, activeKey, readMatrixRows, readMatrixGrid, matrixEditLock, readValueOptions,
        formErrors, submit, onClose,
    ]);

    const dialogBridge = useMemo(
        () => createBomMatrixEditBridge(() => bridgeContext),
        [bridgeContext],
    );
    /*
     * 弹窗自己注册到界面桥：打开期间顶掉页面的工具栏动作、查询条件与列表数据，guide 也换成表单那份；
     * 关闭后自动让位 —— 覆盖规则由桥统一实现，见 ui-bridge/handler.ts 的 composeSnapshot。
     */
    useUIBridgeDialog(view, dialogBridge, open);

    /**
     * 渲染一个字段的控件。
     *
     * - 物料编码：`MaterialSelect`（输入框 + 弹窗 + 输入编码查库，组件自己管这几个交互）；
     * - 单位：`ConvertSelect`（按**这个物料的**换算单位选，选完带出换算率）；
     * - 项目：`ProjectSelect`（输入项目号查库 / 分类树里挑，选完带出项目主键）；
     * - 其余：普通输入框，`readOnly` 的禁用（值由物料带出）。
     */
    const renderControl = useCallback((field: BomMatrixFormField) => {
        if (field.material) {
            const isSew = field.material === 'sew';
            return (
                <MaterialSelect
                    onSelect={isSew ? applySewMaterial : applyPackMaterial}
                    // 清空物料时把名称 / 版本 / 单位这些一起清掉，别留下半截数据
                    onClear={isSew ? clearSewMaterial : clearPackMaterial}
                    filter={isSew ? ['3'] : ['4']}
                />
            );
        }
        if (field.convert) {
            const isSew = field.convert === 'sew';
            return (
                <ConvertSelect
                    materialVID={toStringOrEmpty(isSew ? sewMaterialVID : packMaterialVID)}
                    onSelect={isSew ? applySewConvert : applyPackConvert}
                />
            );
        }
        if (field.project) {
            return <ProjectSelect onSelect={applyProject} onClear={clearProject}/>;
        }
        return <Input disabled={field.readOnly}/>;
    }, [
        applyPackMaterial, applySewMaterial, applyPackConvert, applySewConvert,
        applyProject, clearProject, clearPackMaterial, clearSewMaterial, packMaterialVID, sewMaterialVID,
    ]);

    return (
        <>
        <Modal
            open={open}
            /*
             * 保存成功后这份矩阵已经有身份了，标题跟着改成「编辑」——
             * 否则用户明明在改一份已落库的记录，标题却还写着「新增」。
             */
            title={hasRecord && (mode === 'add' || mode === 'copy') ? EDIT_TITLE : MODE_TITLE[mode]}
            width={'80%'}
            onCancel={onClose}
            // 没有底部按钮：保存 / 生成 / 复制在顶部工具栏（与原界面一致）
            footer={null}
            // 关闭即销毁：换一份记录再打开时表单与表格都从干净的实例开始（否则会带着上一次的编辑）
            destroyOnHidden
            className="bom-matrix-edit"
            mask={{
                closable: false,
                blur: true,
            }}
        >
            <div className="bom-matrix-edit-toolbar">
                <Button type="text" className="bom-matrix-edit-action" icon={<SaveOutlined/>}
                        loading={saving} disabled={saving}
                        onClick={() => void handleSave()}>保存</Button>
                {/*
                 * 分割线：「保存」是对这一份的直接操作；「生成」「复制」要按**已落库**的记录做事，
                 * 线一划，两组的分界就看得出来了（不用靠按钮灰不灰去猜）。
                 */}
                <Divider orientation="vertical" className="bom-matrix-edit-divider"/>
                {/*
                 * 「生成」与「复制」的可用性看**有没有主键**（`recordID`），不看模式：
                 * 生成要按已存在的产成品铺明细，复制是把当前这份内容另存一份 ——
                 * 新增时还没有身份，保存成功拿到 `PackBomMatrixID` 之后才点得动
                 * （编辑 / 查看 / 复制打开时主键来自详情，直接可用）。
                 */}
                <Button type="text" className="bom-matrix-edit-action" icon={<ThunderboltOutlined/>}
                        disabled={!hasRecord}
                        title={hasRecord ? undefined : '保存成功后（拿到矩阵主键）才可用'}
                        onClick={handleGenerate}>生成</Button>
                <Button type="text" className="bom-matrix-edit-action" icon={<CopyOutlined/>}
                        disabled={!hasRecord}
                        title={hasRecord ? undefined : '保存成功后（拿到矩阵主键）才可用'}
                        onClick={handleCopy}>复制</Button>
            </div>

            <Form
                form={form}
                // 新增是空表单；编辑 / 复制把底稿带出来（复制也带，只是保存时不带主键）。
                // 底稿先给主表摘要那几个字段，详情到达后由 `loadDetail` 补齐（initialValues 只管首帧）
                initialValues={(baseRecord ?? {}) as Record<string, unknown>}
                layout="horizontal"
                labelCol={{flex: '72px'}}
                colon={false}
                size="small"
                className="bom-matrix-edit-form"
            >
                <section className="bom-matrix-group">
                    <div className="bom-matrix-group-title">包装成品</div>
                    <div className="bom-matrix-fields">
                        {/*
                         * 隐藏字段：包装物料的关联键 —— 「单位」的可选列表按它取换算单位。
                         *
                         * 必须注册成 Form.Item，不能只靠 `setFieldsValue` 往 store 里塞：
                         * `Form.useWatch` 读的是 `getFieldsValue()`（**只含已注册字段**），
                         * 没注册时 watch 永远拿到 undefined，于是编辑打开后点「单位」只会提示
                         * 「先选物料」—— 明明编码那一格是有值的。
                         */}
                        <Form.Item name="PackMaterialVID" hidden>
                            <Input/>
                        </Form.Item>
                        {/*
                         * 两个单位主键同样只靠物料带出（界面上没有入口）：
                         * 矩阵头上存的是「单位名 + 单位主键 + 换算率」一组，少一个保存时后端认不出单位。
                         */}
                        <Form.Item name="CMeasureid" hidden>
                            <Input/>
                        </Form.Item>
                        <Form.Item name="Cassmeasureid" hidden>
                            <Input/>
                        </Form.Item>
                        {/*
                         * 项目主键：只由「项目」选择器带出（界面上没有单独的入口）。
                         * 必须注册：`form.getFieldsValue()` 只含已注册字段 —— 不注册的话
                         * `setFieldsValue` 写得进去、保存装配时却读不到，主键会静默丢失。
                         */}
                        <Form.Item name="ProjectID" hidden>
                            <Input/>
                        </Form.Item>
                        {PACK_FIELDS.map((field) => (
                            <Form.Item key={field.id} name={field.id} label={field.label}>
                                {renderControl(field)}
                            </Form.Item>
                        ))}
                    </div>
                </section>

                <section className="bom-matrix-group">
                    <div className="bom-matrix-group-title">产成品</div>
                    <div className="bom-matrix-fields">
                        {/* 隐藏字段：接口里真正的关联键，决定子项明细能不能编 */}
                        <Form.Item name="SewMaterialVID" hidden>
                            <Input/>
                        </Form.Item>
                        {SEW_FIELDS.map((field) => (
                            <Form.Item key={field.id} name={field.id} label={field.label}>
                                {renderControl(field)}
                            </Form.Item>
                        ))}
                    </div>
                </section>
            </Form>

            {/*
             * 下半部分：编辑态的矩阵表。
             * `matrix` 是「详情 + 本次编辑」派生出来的：三张表按它的 Detail 铺行，
             * 编辑结果留在各自表里。
             *
             * 产成品没选时整块禁用：子项明细是「这个产成品的包装明细」，没有产成品就没有归属，
             * 让人先录明细再选产成品，等于把行列挂到空气上。
             *
             * 详情没到之前**不渲染表格**：拿主表摘要（没有 Detail）铺出来是一张空表，
             * 详情一到整块重铺 —— 空行、选中、滚动全部闪一遍。占位块与表格同高，弹窗不会跳。
             */}
            <div className="bom-matrix-edit-table">
                {loadingDetail ? (
                    <div className="bom-matrix-edit-loading">
                        <Spin/>
                        <span>正在加载矩阵详情…</span>
                    </div>
                ) : detailFailed ? (
                    <div className="bom-matrix-edit-loading">
                        <span>矩阵详情没加载出来，表格暂时不可用</span>
                        <Button size="small" onClick={retryDetail}>重试</Button>
                    </div>
                ) : (
                    <>
                        <BomMatrixView
                            ref={matrixRef}
                            bomMatrix={matrix}
                            isEditMode={canEditMatrix}
                            activeKey={activeKey}
                            onActiveKeyChange={setActiveKey}
                            cellIssues={cellIssues}
                            onCellChange={handleCellChange}
                        />
                        {!canEditMatrix && (
                            <div className="bom-matrix-edit-mask">
                                {mode === 'view' ? '只读查看' : '请先选择产成品的物料，再编辑子项明细'}
                            </div>
                        )}
                    </>
                )}
            </div>

        </Modal>
            {/*
             * 生成：打开「包装BOM矩阵明细」发布弹窗（与原系统同一个窗体）。
             * 嵌套在编辑弹窗里由 antd 自己管层级；`destroyOnHidden` 保证每次打开都是新会话。
             */}
            <BomMatrixPush open={pushOpen}
                           matrixID={recordID}
                           matrixLabel={[toStringOrEmpty(baseRecord?.PackMaterialCode), toStringOrEmpty(baseRecord?.PackMaterialName)]
                               .filter((text) => text !== '').join(' ')}
                           onClose={handleClosePush}/>
        </>
    );
};

export default BomMatrixEdit;
