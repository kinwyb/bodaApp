/**
 * 新增 / 编辑 / 复制包装 BOM 矩阵的表单弹窗。
 *
 * 只有界面：**保存不接后端**（这个模块还没有保存接口），点保存只回一句提示。
 * 字段名尽量按接口 schema 来（`PackBomMatrix`），后端暂时没有的那几个（规格 / 型号 /
 * 产成品的编码名称等）用同名占位，接上以后把值一起提交即可。
 *
 * 下半部分是**编辑态的矩阵表**（`BomMatrixView isEditMode`）：三张表各自可增删改，
 * 子项物料表的行事件会自动同步到配色 / 配码（那套编排在控件里，弹窗不参与）。
 */

import React, {useCallback, useMemo, useRef, useState} from "react";
import {App, Button, Form, Input, Modal} from "antd";
import {CopyOutlined, SaveOutlined, ThunderboltOutlined} from "@ant-design/icons";
import {BomMatrixView, type BomMatrixViewApi} from "@/components/nc/bomMatrix";
import {createItemRow} from "@/components/nc/bomMatrix/rows.ts";
import MaterialSelect from "@/components/nc/materialSelect.tsx";
import ConvertSelect from "@/components/nc/convertSelect.tsx";
import {putConverts} from "@/components/nc/convertCache.ts";
import type {NCMaterial, NCMaterialConvert, NCMaterialVFree} from "@/api/schemas/nc/NCMaterial.ts";
import {DEFAULT_BOM_MATRIX_SECTION} from "@/components/nc/bomMatrix/sections.ts";
import {BOMMATRIX_COLOR_VFREE_FIELD, BOMMATRIX_SIZE_VFREE_FIELD,} from "@/components/nc/bomMatrix/common.ts";
import {ncMaterialApi} from "@/api/modules/nc/material.ts";
import {ErrorMessage} from "@/api/request.ts";
import type {
    PackBomMatrix,
    PackBomMatrixColorMatch,
    PackBomMatrixDetail,
    PackBomMatrixSizeMatch
} from "@/api/schemas/nc/bomMatrix.ts";
import {isBlank, toStringOrEmpty} from "@/utils";
import type {FormMode} from "../command";
import "./bomMatrixEdit.css";

export type BomMatrixEditProps = {
    open: boolean;
    /** add / edit / copy；view 也支持（只读预览，复用同一份布局） */
    mode: FormMode;
    /** 编辑 / 复制时的底稿；新增为 null */
    record: PackBomMatrix | null;
    onClose: () => void;
};

/** 标题按模式来：复制与新增是同一套空表单，但用户要知道自己在复制哪一份 */
const MODE_TITLE: Record<FormMode, string> = {
    add: '新增包装 BOM 矩阵',
    edit: '编辑包装 BOM 矩阵',
    copy: '复制包装 BOM 矩阵',
    view: '查看包装 BOM 矩阵',
};

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
 * 表单字段描述。
 *
 * - `readOnly`：只能由物料带出来，不让手填（名称 / 版本 / 规格 / 型号 / 主单位 / 转换率
 *   都是物料的属性，手改会出现「编码是 A、名称却是 B」这种自相矛盾的数据）；
 * - `material`：物料编码 —— 用 `MaterialSelect`（输入框 + 物料弹窗 + 输入编码查库三合一），
 *   `pack` / `sew` 决定选中后回填到哪一组字段；
 * - `convert`：单位 —— 用 `ConvertSelect`，可选单位是**这个物料的换算单位**
 *   （`NCMaterial.materialconvert`），`pack` / `sew` 决定去哪一组取物料。
 */
type BomMatrixField = {
    name: string;
    label: string;
    readOnly?: boolean;
    material?: 'pack' | 'sew';
    convert?: 'pack' | 'sew';
};

/**
 * 表单字段（包装成品那一组）。
 *
 * `PackMaterialVID` 在接口里是版本 ID，界面上按「物料版本」展示 —— 接保存时要么换成
 * 物料选择器回填，要么由后端按 VID 补齐，别在这里手填名字。
 */
const PACK_FIELDS: BomMatrixField[] = [
    {name: 'PackMaterialCode', label: '物料编码', material: 'pack'},
    {name: 'PackMaterialName', label: '物料名称', readOnly: true},
    {name: 'PackMaterialVID', label: '物料版本', readOnly: true},
    {name: 'PackMaterialSpec', label: '物料规格', readOnly: true},
    {name: 'PackMaterialModel', label: '物料型号', readOnly: true},
    {name: 'CMeasure', label: '主单位', readOnly: true},
    {name: 'VChangerate', label: '转换率', readOnly: true},
    {name: 'Cassmeasure', label: '单位', convert: 'pack'},
    {name: 'PackMethod', label: '包装方法'},
    {name: 'PackNum', label: '包装数量'},
    {name: 'ProjectCode', label: '项目'},
];

/**
 * 产成品那一组。
 *
 * 接口目前只存 `SewMaterialVID`（缝制物料 ID），编码 / 名称 / 单位这些都是按 VID 带出来的，
 * 所以这里用 `Sew` 前缀占位：接保存时由物料选择器回填，或让后端补齐，别直接提交这些字段。
 *
 * 「物料编码」是这一组唯一的编辑入口 —— **它决定下面子项明细能不能编**（见 `canEditMatrix`）。
 */
const SEW_FIELDS: BomMatrixField[] = [
    {name: 'SewMaterialCode', label: '物料编码', material: 'sew'},
    {name: 'SewMaterialName', label: '物料名称', readOnly: true},
    {name: 'SewMaterialVersion', label: '物料版本', readOnly: true},
    {name: 'SewMaterialSpec', label: '物料规格', readOnly: true},
    {name: 'SewMaterialModel', label: '物料型号', readOnly: true},
    {name: 'SewCMeasure', label: '主单位', readOnly: true},
    {name: 'SewVChangerate', label: '转换率', readOnly: true},
    {name: 'SewCassmeasure', label: '单位', convert: 'sew'},
];

const BomMatrixEdit: React.FC<BomMatrixEditProps> = ({open, mode, record, onClose}) => {
    const {message} = App.useApp();
    const [form] = Form.useForm<Record<string, unknown>>();
    /**
     * 弹窗内的标签页：**受控在这里**。
     * `BomMatrixView` 自己不存 activeKey（它必须如实回答「用户在看哪张表」），所以由调用方持有。
     */
    const [activeKey, setActiveKey] = useState<string>(DEFAULT_BOM_MATRIX_SECTION);

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
        const source = detailRows ?? record?.Detail ?? [];
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
    }, [record, detailRows, sewRow]);

    /**
     * 交给下方表格的矩阵 = 明细 + 产成品带出的颜色 / 尺码列。
     *
     * 派生而不是把行写进 `record`：`record` 是外面传进来的底稿，弹窗没有权力改它；
     * 派生也保证「清空产成品」= 把几个 state 置空，底稿立刻回到原样
     * （`sewRow` / `detailRows` 都空时直接返回底稿本身，连 `Detail` 都不重造）。
     */
    const matrix = useMemo<PackBomMatrix>(() => {
        const base = record ?? {};
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
    }, [record, detail, detailRows, sewRow, sewSort]);

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
     * 保存：**接口没接**。
     *
     * 不假装成功 —— 用户会以为已经存进库了。接上以后这里是：
     * 校验 → `form.validateFields()` → 组装 `{...values, Detail: readRows('items'), ...}` → 调 api。
     */
    const handleSave = useCallback(() => {
        void message.info('保存：矩阵保存接口还没接入（当前只做了界面）');
    }, [message]);

    /** 生成：按「产成品」把子项物料铺出来（原系统语义），同理先占位 */
    const handleGenerate = useCallback(() => {
        void message.info('生成：按产成品生成子项明细的功能还没接入');
    }, [message]);

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
     */
    const applyPackMaterial = useCallback((material: NCMaterial) => {
        const convert = material.materialconvert?.[0];
        /*
         * 单位列表当场登记进缓存（与 itemView 的 `applyMaterial` 同一做法）：
         * 单位弹窗一打开就是满的，不用再回查一次接口。
         */
        putConverts(toStringOrEmpty(material.pk_material), material.materialconvert);
        form.setFieldsValue({
            PackMaterialVID: material.pk_material,
            PackMaterialName: material.name,
            PackMaterialSpec: material.materialspec,
            PackMaterialModel: material.materialtype,
            CMeasure: material.measdoc,
            Cassmeasure: convert?.measdoc ?? material.measdoc,
            VChangerate: convert?.measrate ?? '1/1',
        });
    }, [form]);

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
            setSewSort({colors: [], sizes: [], colorMatch: {}, sizeMatch: {}});
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
        setDetailRows(currentRows.filter((row) => toStringOrEmpty(row.VRowNo) !== '10'));
        // 换物料时沿用第一次的临时主键，表格不会把它当成「删一行又加一行」
        const nextRow = buildSewRow(material);
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
        form.setFieldsValue({
            PackMaterialVID: undefined,
            PackMaterialName: undefined,
            PackMaterialSpec: undefined,
            PackMaterialModel: undefined,
            CMeasure: undefined,
            Cassmeasure: undefined,
            VChangerate: undefined,
        });
    }, [form]);

    /**
     * 选中单位：单位名与换算率是**一组**（后端按「单位 + 换算率」还原子项数量），
     * 只改单位名会留下上一个单位的比率 —— 与 itemView 的 `applyConvert` 同一口径。
     */
    const applyPackConvert = useCallback((convert: NCMaterialConvert) => {
        form.setFieldsValue({Cassmeasure: convert.measdoc, VChangerate: convert.measrate});
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
     * 渲染一个字段的控件。
     *
     * - 物料编码：`MaterialSelect`（输入框 + 弹窗 + 输入编码查库，组件自己管这几个交互）；
     * - 单位：`ConvertSelect`（按**这个物料的**换算单位选，选完带出换算率）；
     * - 其余：普通输入框，`readOnly` 的禁用（值由物料带出）。
     */
    const renderControl = useCallback((field: BomMatrixField) => {
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
        return <Input disabled={field.readOnly}/>;
    }, [
        applyPackMaterial, applySewMaterial, applyPackConvert, applySewConvert,
        clearPackMaterial, clearSewMaterial, packMaterialVID, sewMaterialVID,
    ]);

    return (
        <Modal
            open={open}
            title={MODE_TITLE[mode]}
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
                        onClick={handleSave}>保存</Button>
                {/*
                 * 「生成」与「复制」都只在**编辑**时可用：
                 * 生成要按已存在的产成品铺明细，复制是把当前这份内容另存一份 ——
                 * 新增（还没存过）时两者都无从下手，点下去只会让人以为坏了。
                 */}
                <Button type="text" className="bom-matrix-edit-action" icon={<ThunderboltOutlined/>}
                        disabled={mode !== 'edit'}
                        title={mode === 'edit' ? undefined : '仅编辑已有矩阵时可用'}
                        onClick={handleGenerate}>生成</Button>
                <Button type="text" className="bom-matrix-edit-action" icon={<CopyOutlined/>}
                        disabled={mode !== 'edit'}
                        title={mode === 'edit' ? undefined : '仅编辑已有矩阵时可用'}
                        onClick={handleCopy}>复制</Button>
            </div>

            <Form
                form={form}
                // 新增是空表单；编辑 / 复制把底稿带出来（复制也带，只是保存时不带主键）
                initialValues={(record ?? {}) as Record<string, unknown>}
                layout="horizontal"
                labelCol={{flex: '72px'}}
                colon={false}
                size="small"
                className="bom-matrix-edit-form"
            >
                <section className="bom-matrix-group">
                    <div className="bom-matrix-group-title">包装成品</div>
                    <div className="bom-matrix-fields">
                        {PACK_FIELDS.map((field) => (
                            <Form.Item key={field.name} name={field.name} label={field.label}>
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
                            <Form.Item key={field.name} name={field.name} label={field.label}>
                                {renderControl(field)}
                            </Form.Item>
                        ))}
                    </div>
                </section>
            </Form>

            {/*
             * 下半部分：编辑态的矩阵表。
             * `bomMatrix` 就是底稿（新增时是空对象）：三张表按它的 Detail 铺行，编辑结果留在各自表里。
             *
             * 产成品没选时整块禁用：子项明细是「这个产成品的包装明细」，没有产成品就没有归属，
             * 让人先录明细再选产成品，等于把行列挂到空气上。
             */}
            <div className="bom-matrix-edit-table">
                <BomMatrixView
                    ref={matrixRef}
                    bomMatrix={matrix}
                    isEditMode={canEditMatrix}
                    activeKey={activeKey}
                    onActiveKeyChange={setActiveKey}
                />
                {!canEditMatrix && (
                    <div className="bom-matrix-edit-mask">
                        {mode === 'view' ? '只读查看' : '请先选择产成品的物料，再编辑子项明细'}
                    </div>
                )}
            </div>
        </Modal>
    );
};

export default BomMatrixEdit;
