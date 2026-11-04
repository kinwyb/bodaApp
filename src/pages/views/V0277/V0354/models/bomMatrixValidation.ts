/**
 * 保存前的校验 —— 逐条对齐原系统（C# WinForms）`btnSave_Click` 里那一段：
 *
 * ```
 * if (bomMatrix.PackMaterial == null)      → 请选择包装物料
 * if (bomMatrix.SewMaterial == null)       → 请选择产成品
 * if (packMethod.Text.IsNullOrEmpty())     → 请填写包装方法
 * if (packNum.Text.IsNullOrEmpty())        → 请填写包装数量
 * if (ProjectID/ProjectCode 任一为空)      → 请选择订单号
 * if (dataSingleCheck(false))              → 问「是否重复添加」
 * ```
 *
 * 另外补了原系统在别处做的一件事：**明细 / 配色 / 配码要按每行物料的 `useVFree` 逐项填全**
 * （款号 / 批号 / 季度号 / 特性 / 色纱色，以及色号 vfree6、尺码系数 vfree7）。
 * 原系统是选物料时就把这些格子带出来的，网页这边是用户自己填，所以保存时必须回头核一遍。
 *
 * 三件注意：
 * - 判据与装配**同一份**（`rows.ts` 的 `rowHasMaterial`）：末尾那行「等输入」的空行既不入库也不校验；
 * - 必填不过就**不再查辅助属性**：物料都没选，后面的字典根本没得查，报一串「第 3 行没物料」只会吵；
 * - 这里不改任何数据、不弹窗：只回「哪里不对」，弹什么、怎么问由调用方决定
 *   （界面用 `modal.warning` / `modal.confirm`，界面桥用回执里的 `message`）。
 */

import {isBlank, toStringOrEmpty} from '@/utils';
import {BOMMATRIX_COLOR_VFREE_FIELD, BOMMATRIX_SIZE_VFREE_FIELD,} from '@/components/nc/bomMatrix/common.ts';
import {colorCells, rowHasMaterial, rowKeyOf, sizeCells} from '@/components/nc/bomMatrix/rows.ts';
import {ensureUseVFrees, readUseVFrees} from '@/components/nc/bomMatrix/vfreeCache.ts';
import type {BomMatrixCellIssue} from '@/components/nc/bomMatrix/cellIssues.ts';
import type {FormMode} from '../command/types.ts';
import {packBomMatrixApi} from "@/api/modules/nc/bomMatrix.ts";

/** 校验要看的东西：与装配的入参几乎一样（少一个 `base`，多一个模式） */
export type BomMatrixCheckInput = {
    mode: FormMode;
    /** 编辑态的主键：查重时要把自己排除掉；新增 / 复制传空 */
    matrixID?: string;
    /** 表单值（两组字段，`form.getFieldsValue()`） */
    values: Record<string, unknown>;
    /** 子项物料表的当前行（含未保存的增删改，含末尾空行） */
    detail: Array<Record<string, unknown>>;
    /** 配色表的当前行 */
    colorRows: Array<Record<string, unknown>>;
    /** 配码表的当前行 */
    sizeRows: Array<Record<string, unknown>>;
    /** 颜色列 / 尺码列（`matrix.ColorSort` / `SizeSort`） */
    colorSort?: Array<string | null | undefined> | null;
    sizeSort?: Array<string | null | undefined> | null;
};

/**
 * 校验结论：要么过，要么给一批**人话**原因（一次说全，别让人一条条试）。
 *
 * `issues` 是**结构化**的那一份：哪张表、哪一行、哪一列不对 —— 调用方把它交给
 * `BomMatrixView` 就能把格子标红（见 `components/nc/bomMatrix/cellIssues.ts`）。
 * 表单级的老问题（没选物料 / 没填包装方法）没有格子可标，只出现在 `messages` 里。
 */
export type BomMatrixCheckResult =
    | { ok: true }
    | { ok: false; messages: string[]; issues: BomMatrixCellIssue[] };

/** `vfree{n}` → 界面上的列名，报错时说清「哪一项没填」 */
const VFREE_LABELS: Record<string, string> = {
    vfree1: '款号',
    vfree4: '批号',
    vfree5: '季度号/通用',
    vfree8: '特性',
    vfree9: '色纱色',
};

/**
 * 头部必填（顺序照原系统，报错也按这个顺序读）。
 *
 * 「订单号」= 项目：`ProjectID` 与 `ProjectCode` **缺一不可**（与原系统一致）。
 * 界面上「项目」已经是项目选择器，选中时两个一起写；只在文本框里手打过编码的（历史数据 /
 * 底稿带来的）会只有编码没有主键，那种情况也如实报出来 —— 让用户重选一个，别拿空主键去保存。
 */
export function checkRequiredFields(input: BomMatrixCheckInput): string[] {
    const values = input.values;
    const messages: string[] = [];
    if (isBlank(values.PackMaterialCode) && isBlank(values.PackMaterialVID)) {
        messages.push('请选择包装物料');
    }
    if (isBlank(values.SewMaterialCode) && isBlank(values.SewMaterialVID)) {
        messages.push('请选择产成品');
    }
    if (isBlank(values.PackMethod)) messages.push('请填写包装方法');
    if (isBlank(values.PackNum)) messages.push('请填写包装数量');
    if (isBlank(values.ProjectID) || isBlank(values.ProjectCode)) messages.push('请选择订单号');
    return messages;
}

/** 行标签：`第 2 行（行号 20，物料 4001）` —— 让人一眼在表里找到它 */
function rowLabel(row: Record<string, unknown>, index: number): string {
    const rowNo = toStringOrEmpty(row.VRowNo) || '空';
    const code = toStringOrEmpty(row.MaterialCode) || toStringOrEmpty(row.MaterialVID) || '无物料';
    return `第 ${index + 1} 行（行号 ${rowNo}，物料 ${code}）`;
}

/** 取一组列的字符串值（nullish 全滤掉） */
function columnNames(columns: Array<string | null | undefined> | null | undefined): string[] {
    return (columns ?? []).map((item) => toStringOrEmpty(item)).filter((item) => item !== '');
}

/**
 * 明细 / 配色 / 配码按 `useVFree` 逐项校验是否都有值。
 *
 * 口径：
 * - **明细行**：这个物料启用的每个 `vfree`（1/4/5/8/9…）对应的列都要有值
 *   （`VFree{n}Name` 与 `VFree{n}` 有一个就够 —— 界面上是名称，接口要的是编码，两条路都写过）；
 * - **配色行**：物料启用 `vfree6` 的，这一行每个颜色格（`{颜色}` / `{颜色}_val`）都要有值；
 * - **配码行**：物料启用 `vfree7` 的，这一行每个尺码的系数（`S{尺码}` / `S{尺码}_val`）都要有值。
 *
 * 为什么按**每行自己的物料**判断，而不是「矩阵有颜色列就全要填」：
 * 颜色列是按产成品取的，但一行子物料未必用得上 vfree6；一刀切会逼用户给用不上的格子
 * 硬塞值（塞进去的就是脏数据）。
 *
 * 返回值是**两份**：`issues` 给表格标红（一格一条），`messages` 给人看（一行一条，读完就知道改哪）。
 * 两份同源，不会出现「对话框说第 3 行、屏幕上红的是第 4 行」。
 */
export async function checkVFreeComplete(
    input: BomMatrixCheckInput,
): Promise<{ messages: string[]; issues: BomMatrixCellIssue[] }> {
    const messages: string[] = [];
    const issues: BomMatrixCellIssue[] = [];
    const detailRows = input.detail.filter(rowHasMaterial);
    if (detailRows.length === 0) {
        return {messages: ['子项明细是空的：至少要有一行（产成品那一行也不能少）'], issues};
    }

    /*
     * 一次把要用到的物料字典查全（`ensureUseVFrees` 自带去重与失败冷却），
     * 三张表共用这一份：逐行查会重复发请求，还容易出现「明细查到了、配色没查到」。
     */
    const vids = [...new Set(detailRows
        .map((row) => toStringOrEmpty(row.MaterialVID).trim())
        .filter((vid) => vid !== ''))];
    const loaded = await Promise.all(vids.map(async (vid) => {
        const cached = readUseVFrees(vid);
        return [vid, cached ?? await ensureUseVFrees(vid)] as const;
    }));
    const useVFreeByVID = new Map<string, string[] | null>(loaded);

    /** 行 → 「这个物料启用哪些 vfree」；取不到给 null（= 不知道，得如实说） */
    const useVFreeOf = (row: Record<string, unknown>): { known: true; fields: string[] } | { known: false } => {
        const vid = toStringOrEmpty(row.MaterialVID).trim();
        if (!vid) return {known: false};
        const fields = useVFreeByVID.get(vid);
        return fields ? {known: true, fields} : {known: false};
    };

    // ① 明细行自己的辅助属性
    detailRows.forEach((row, index) => {
        const label = rowLabel(row, index);
        const rowKey = rowKeyOf(row);
        if (toStringOrEmpty(row.MaterialVID).trim() === '') {
            messages.push(`${label}：这一行没有物料`);
            return;
        }
        const dict = useVFreeOf(row);
        if (!dict.known) {
            messages.push(`${label}：物料的辅助属性没取到，无法校验是否填全，请重试`);
            return;
        }
        const missing = dict.fields
            // 色号 / 尺码系数在下面两张表里校验，不在这里算「明细行没填」
            .filter((field) => field !== BOMMATRIX_COLOR_VFREE_FIELD && field !== BOMMATRIX_SIZE_VFREE_FIELD)
            .filter((field) => {
                const key = field.replace('vfree', 'VFree');
                return isBlank(row[key]) && isBlank(row[`${key}Name`]);
            });
        if (missing.length === 0) return;
        messages.push(`${label}：${missing.map((field) => VFREE_LABELS[field] ?? field).join('、')} 没填`);
        missing.forEach((field) => {
            const key = field.replace('vfree', 'VFree');
            issues.push({
                section: 'items',
                rowKey,
                // 标在**名称列**上（界面上看得见的就是它）
                field: `${key}Name`,
                message: `请填「${VFREE_LABELS[field] ?? field}」`,
            });
        });
    });

    /*
     * 后面两张表要按「明细第几行」报位置：用行标识回查序号（表格行的顺序与明细一致，
     * 但配色 / 配码是各自的 state，不能拿自己的下标当明细下标）。
     */
    const indexByRowKey = new Map<string, number>();
    detailRows.forEach((row, index) => {
        const key = rowKeyOf(row);
        if (key) indexByRowKey.set(key, index);
    });
    const labelByRow = (row: Record<string, unknown>): string | null => {
        const index = indexByRowKey.get(rowKeyOf(row));
        return index === undefined ? null : rowLabel(detailRows[index], index);
    };

    // ② 配色：物料启用 vfree6 的行，每个颜色格都要有值
    const colors = columnNames(input.colorSort);
    input.colorRows.filter(rowHasMaterial).forEach((row) => {
        const dict = useVFreeOf(row);
        if (!dict.known || !dict.fields.includes(BOMMATRIX_COLOR_VFREE_FIELD)) return;
        const missing = colors.filter((color) => {
            const fields = colorCells(color);
            return isBlank(row[fields.name]) && isBlank(row[fields.value]);
        });
        if (missing.length === 0) return;
        const rowKey = rowKeyOf(row);
        messages.push(`${labelByRow(row) ?? '配色表某一行'}：色号没填 —— ${missing.join('、')}`);
        missing.forEach((color) => {
            issues.push({
                section: 'colors',
                rowKey,
                // 配色表可编辑的是**名称列**（颜色名本身就是列名），编码在 `{颜色}_val`
                field: color,
                message: `请选「${color}」的色号`,
            });
        });
    });

    // ③ 配码：物料启用 vfree7 的行，每个尺码的系数都要有值（损耗 / 用量是数量，不在这条里）
    const sizes = columnNames(input.sizeSort);
    input.sizeRows.filter(rowHasMaterial).forEach((row) => {
        const dict = useVFreeOf(row);
        if (!dict.known || !dict.fields.includes(BOMMATRIX_SIZE_VFREE_FIELD)) return;
        const missing = sizes.filter((size) => {
            const fields = sizeCells(size);
            return isBlank(row[fields.name]) && isBlank(row[fields.value]);
        });
        if (missing.length === 0) return;
        const rowKey = rowKeyOf(row);
        messages.push(`${labelByRow(row) ?? '配码表某一行'}：尺码系数没填 —— ${missing.join('、')}`);
        missing.forEach((size) => {
            issues.push({
                section: 'sizes',
                rowKey,
                // 配码表可编辑的是尺码系数（`S{尺码}`），损耗 / 用量是数量，不在这条规则里
                field: sizeCells(size).name,
                message: `请选「${size}」的尺码系数`,
            });
        });
    });

    return {messages, issues};
}

/**
 * 整套保存校验：必填 → 辅助属性填全。必填不过就不再往下查（见文件头）。
 */
export async function validateBomMatrix(input: BomMatrixCheckInput): Promise<BomMatrixCheckResult> {
    const required = checkRequiredFields(input);
    // 必填不过就先打住：物料都没选，行内那几条查出来全是「没物料」，只会吵
    if (required.length > 0) return {ok: false, messages: required, issues: []};
    const cells = await checkVFreeComplete(input);
    if (cells.messages.length > 0 || cells.issues.length > 0) {
        return {ok: false, messages: cells.messages, issues: cells.issues};
    }
    return {ok: true};
}

/**
 * 是否与已有数据重复 —— 对应原系统的 `dataSingleCheck(false)`。
 *
 * **现在恒返回 `false`（= 不重复）**：具体检测逻辑（项目 + 包装物料 + 包装方法与数量）还没写，
 * 具体规则自己往里加。故意留成 `async`：真查的时候必然要调列表接口，
 * 调用方已经 `await` 了，改成实现不用再动调用点。
 *
 * 返回值语义（与 C# 一致）：
 * - `true`  = 命中重复 → 保存前**先要问用户**「该订单当前包装物料存在相同的包装方法及数量数据，是否重复添加？」
 * - `false` = 不重复 → 直接保存。
 *
 * @param input.matrixID 编辑态要把自己排除掉（否则每次改都会「和自己重复」）
 */
export async function dataSingleCheck(input: BomMatrixCheckInput): Promise<boolean> {
    const mid = input.matrixID ?? '';
    const materialCode = toStringOrEmpty(input.values.PackMaterialCode);
    const packMethod = toStringOrEmpty(input.values.PackMethod);
    const packNum = toStringOrEmpty(input.values.PackNum);
    const projectCode = toStringOrEmpty(input.values.ProjectCode);
    return packBomMatrixApi.duplicate(mid, materialCode, projectCode, packMethod, packNum);
}
