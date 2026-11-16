import type {TreeDataNode} from 'antd';
import type {Department} from '@/api/schemas/config/department';
import type {
    GridTableDisplayInfo,
    GridTableRowInfo,
    GridTableSelectedRowChangeInfo,
    GridTableSelection,
} from '@/components/grid-table';
import type {TableReadApi} from '@/pages/agent/ui-bridge';
import {toNumberOrNull, toStringOrEmpty} from '@/utils';

/**
 * 树根「所有部门」的 key。
 *
 * 旧客户端 `loadData` 里 `new Department()` 造了一个虚拟根把接口返回的顶层部门挂上去，
 * 它没有 ID、不能保存也不能删除，只用来「在顶级新增一个部门」。这里保留同一个节点，
 * 但给它一个固定 key，免得与真实部门的主键混在一起。
 */
export const ROOT_KEY = '__all_departments__';
export const ROOT_NAME = '所有部门';

/** 摊平后的一行（界面桥读的就是它）；字段名与接口 DTO 一致，Level 是界面派生列 */
export type DepartmentRow = {
    ID: string;
    No: string;
    Name: string;
    ParentID: string;
    ParentName: string;
    Attribute: string;
    ContactUser: string;
    Code: string;
    Visible: boolean;
    Level: number;
};

/** antd Tree 的节点：把原始部门挂在节点上，titleRender 与选中回调都从它取值 */
export type DepartmentTreeNode = TreeDataNode & {
    department: Department;
};

/** 节点 key：优先业务主键，缺主键时退回编码（虚拟根用 ROOT_KEY） */
export function departmentKey(node: Department): string {
    return toStringOrEmpty(node.ID).trim() || toStringOrEmpty(node.No).trim();
}

/** 虚拟根节点（每次按当前数据现造，不缓存，免得 Children 指向旧数组） */
export function rootDepartment(departments: Department[]): Department {
    return {ID: '', No: '', Name: ROOT_NAME, ParentID: '', ParentName: '', Children: departments};
}

function toRow(node: Department, level: number, isRoot: boolean): DepartmentRow {
    return {
        ID: isRoot ? ROOT_KEY : departmentKey(node),
        No: toStringOrEmpty(node.No),
        Name: toStringOrEmpty(node.Name),
        ParentID: toStringOrEmpty(node.ParentID),
        ParentName: toStringOrEmpty(node.ParentName),
        Attribute: toStringOrEmpty(node.Attribute),
        ContactUser: toStringOrEmpty(node.ContactUser),
        Code: toStringOrEmpty(node.Code),
        Visible: node.Visible !== false,
        Level: level,
    };
}

/**
 * 部门树 → 行（先序：父在前、子紧随其后，含虚拟根）。
 *
 * **摊平的是整棵树，不是「当前展开可见的那些节点」**：折叠只是视觉状态，
 * 按展开态取数会让模型读不到收起来的部门，而且每次展开都改变行数。
 * 层级由 Level / ParentName 两列表达（见 ./columns.ts 与 bridged.ts 的 cautions）。
 */
export function flattenDepartments(departments: Department[]): DepartmentRow[] {
    const rows: DepartmentRow[] = [];
    const walk = (node: Department, level: number, isRoot: boolean) => {
        rows.push(toRow(node, level, isRoot));
        (node.Children ?? []).forEach((child) => walk(child, level + 1, false));
    };
    walk(rootDepartment(departments), 0, true);
    return rows;
}

/** 按 key 找原始节点；找不到返回 null（虚拟根也能找到） */
export function findDepartment(departments: Department[], key: string): Department | null {
    if (key === ROOT_KEY) return rootDepartment(departments);
    const walk = (nodes: Department[]): Department | null => {
        for (const node of nodes) {
            if (departmentKey(node) === key) return node;
            const hit = walk(node.Children ?? []);
            if (hit) return hit;
        }
        return null;
    };
    return walk(departments);
}

/** 从根到该节点的祖先 key（含自身）：选中深层节点时要把这条路径展开，否则用户看不见选中 */
export function ancestorKeys(departments: Department[], key: string): string[] {
    const path: string[] = [];
    const walk = (nodes: Department[], trail: string[]): boolean => {
        for (const node of nodes) {
            const next = [...trail, departmentKey(node)];
            if (departmentKey(node) === key) {
                path.push(...next);
                return true;
            }
            if (walk(node.Children ?? [], next)) return true;
        }
        return false;
    };
    walk(departments, [ROOT_KEY]);
    return path;
}

/** 部门树 → antd Tree 的 treeData（虚拟根 + 接口返回的层级） */
export function buildTreeData(departments: Department[]): DepartmentTreeNode[] {
    const convert = (node: Department, isRoot: boolean): DepartmentTreeNode => {
        const children = (node.Children ?? []).map((child) => convert(child, false));
        return {
            key: isRoot ? ROOT_KEY : departmentKey(node),
            title: toStringOrEmpty(node.Name),
            department: node,
            children: children.length > 0 ? children : undefined,
            isLeaf: children.length === 0,
        };
    };
    return [convert(rootDepartment(departments), true)];
}

/**
 * 新增子部门时自动生成的编码（旧客户端 `newBtn_ItemClick` 的算法）：
 * 父编码 + 两位序号，序号取同级最大值加一；没有子部门就是 01。
 *
 * 与旧客户端的唯一差别：那边 `int.Parse` 遇到非数字后缀会直接抛异常，这里跳过这类编码。
 */
export function nextChildNo(parent: Department): string {
    const prefix = toStringOrEmpty(parent.No);
    let max = 0;
    (parent.Children ?? []).forEach((child) => {
        const no = toStringOrEmpty(child.No);
        const suffix = no.startsWith(prefix) ? no.slice(prefix.length) : no;
        const parsed = toNumberOrNull(suffix);
        if (parsed !== null && parsed > max) max = parsed;
    });
    return `${prefix}${String(max + 1).padStart(2, '0')}`;
}

/** 适配器要读的页面状态：行、当前选中、以及「怎么选中」 */
export type DepartmentTreeTableState = {
    rows: DepartmentRow[];
    activeKey: string | null;
    /** 选中一个节点（等价于用户在树上点一下）；返回真正选中的行数 */
    select: (keys: string[]) => number;
};

const NO_ACTIVE_ROW: GridTableSelectedRowChangeInfo = {
    record: undefined,
    row: -1,
    rowIndex: -1,
    rowKey: '',
    isSummaryRow: false,
    isGroupRow: false,
};

/**
 * 把部门树包成界面桥认识的「表」。
 *
 * 桥的读能力（列目录、按行号取数、按主键取整行、选中）都建立在 `TableReadApi` 这几个方法上，
 * 而它只要求「行号与用户看到的一致」，并不要求底下真的是 GridTable。所以这里给树做一层适配，
 * 页面就能直接复用 `createTableBridge`，不必自己再写一套取数与选中命令。
 *
 * 树没有排序、没有统计行、没有筛选面板，对应能力一律给空 —— 列上也没配 `filterType`，
 * 桥不会对外声明筛选命令。
 */
export function createDepartmentTreeTable(read: () => DepartmentTreeTableState): TableReadApi {
    const rowAt = (index: number): DepartmentRow | undefined => read().rows[index];

    const infoOf = (row: DepartmentRow, index: number): GridTableRowInfo => ({
        rowIndex: index,
        rowKey: row.ID,
        record: row,
        isSummaryRow: false,
        isGroupRow: false,
    });

    const activeIndex = (): number => {
        const {rows, activeKey} = read();
        if (!activeKey) return -1;
        return rows.findIndex((row) => row.ID === activeKey);
    };

    return {
        getDisplayInfo: (): GridTableDisplayInfo => ({
            rowCount: read().rows.length,
            sorts: [],
            grouped: false,
        }),
        getRowByIndex: (index: number) => {
            const row = rowAt(index);
            return row ? infoOf(row, index) : undefined;
        },
        getRowByKey: (key: string) => {
            const index = read().rows.findIndex((row) => row.ID === key);
            const row = rowAt(index);
            return index >= 0 && row ? infoOf(row, index) : undefined;
        },
        getActiveRow: () => {
            const index = activeIndex();
            const row = rowAt(index);
            if (index < 0 || !row) return NO_ACTIVE_ROW;
            return {...infoOf(row, index), row: index};
        },
        getSelection: (): GridTableSelection => {
            const index = activeIndex();
            const row = rowAt(index);
            // 树是单选：选中态最多一行，没有单元格级选中
            return {rows: index >= 0 && row ? [row] : [], cells: [], activeCell: null};
        },
        selectRowsByKeys: (keys: string[]) => read().select(keys),
    };
}
