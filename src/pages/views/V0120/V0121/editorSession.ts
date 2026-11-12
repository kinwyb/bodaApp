import type {RefObject} from 'react';
import type {FilterTableApi} from '@/components/grid-table';

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 提交当前单元格；异步校验仍在进行时等它落地，失败则保留编辑态。 */
export async function commitActiveEditor(tableRef: RefObject<FilterTableApi | null>): Promise<boolean> {
    const table = tableRef.current?.getTable();
    if (!table) return true;
    const manager = table.editorManager;
    if (!manager.editingEditor) return true;

    await manager.completeEdit();
    const deadline = Date.now() + 8000;
    while (manager.editingEditor && Date.now() < deadline) {
        await sleep(30);
    }
    return !manager.editingEditor;
}
