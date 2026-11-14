import { CustomLayout, type TYPES } from '@visactor/vtable';
import { resolveTagItems, resolveTagPalette, type ColumnTagItemLike } from './tag';

const DEFAULT_TEXT_COLOR = '#1f1f1f';
const TAG_PADDING: [number, number] = [3, 6];
const TAG_MARGIN: [number, number, number, number] = [1, 2, 1, 2];
const TAG_RADIUS = 4;

function paddingQuad(padding: unknown): [number, number, number, number] {
  if (typeof padding === 'number' && Number.isFinite(padding)) {
    return [padding, padding, padding, padding];
  }
  if (Array.isArray(padding)) {
    const parts = padding.map((part) => (typeof part === 'number' && Number.isFinite(part) ? part : 0));
    const [top = 0, right = top, bottom = top, left = right] = parts;
    return [top, right, bottom, left];
  }
  return [0, 0, 0, 0];
}

function justifyContent(textAlign: unknown): 'flex-start' | 'flex-end' | 'center' {
  if (textAlign === 'center') return 'center';
  if (textAlign === 'right' || textAlign === 'end') return 'flex-end';
  return 'flex-start';
}

/**
 * tag 列的 VTable customLayout。
 *
 * 值按逗号拆成几个就画几个 Tag；每个 Tag 单独按 tagMap 匹配颜色。
 * 布局交给 VTable 的 Flex + Tag 图元，不手写 canvas 文本 / 矩形。
 */
export function createTagCustomLayout(
  map: Record<string, ColumnTagItemLike>,
): TYPES.ICustomLayoutFuc {
  return (args) => {
    const { rect, table, col, row, dataValue, forComputation } = args;
    const style = table.getCellStyle(col, row);
    const [top, right, bottom, left] = paddingQuad(style.padding);
    const contentWidth = Math.max(0, (rect?.width ?? 0) - left - right);
    const contentHeight = Math.max(0, (rect?.height ?? 0) - top - bottom);
    const autoWidth = Boolean(forComputation) && table.options.widthMode === 'autoWidth';
    const autoHeight = Boolean(forComputation) && table.options.heightMode === 'autoHeight';

    const container = new CustomLayout.Group({
      display: 'flex',
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      alignContent: 'center',
      justifyContent: justifyContent(style.textAlign),
      // autoWidth 量宽时不锁死宽度；autoHeight 量高时不锁死高度。
      width: autoWidth ? undefined : contentWidth,
      height: forComputation ? (autoHeight ? undefined : contentHeight) : contentHeight,
      clip: !forComputation,
      pickable: false,
    });

    const fallbackText = typeof style.color === 'string' ? style.color : DEFAULT_TEXT_COLOR;
    const fontSize = typeof style.fontSize === 'number' ? style.fontSize : 12;
    const fontFamily = typeof style.fontFamily === 'string' ? style.fontFamily : undefined;
    const horizontalMargin = TAG_MARGIN[1] + TAG_MARGIN[3];
    const maxTagWidth = contentWidth > horizontalMargin ? contentWidth - horizontalMargin : undefined;

    for (const item of resolveTagItems(dataValue, map)) {
      const palette = resolveTagPalette(item, fallbackText);
      const tag = new CustomLayout.Tag({
        text: item.label,
        textStyle: {
          fill: palette.text,
          fontSize,
          fontFamily,
          fontWeight: style.fontWeight,
          lineHeight: fontSize,
          textAlign: 'left',
          textBaseline: 'top',
        },
        panel: {
          visible: true,
          fill: palette.background,
          stroke: palette.border,
          lineWidth: 1,
          cornerRadius: TAG_RADIUS,
        },
        padding: TAG_PADDING,
        marginTop: TAG_MARGIN[0],
        marginRight: TAG_MARGIN[1],
        marginBottom: TAG_MARGIN[2],
        marginLeft: TAG_MARGIN[3],
        maxWidth: maxTagWidth,
        pickable: false,
      });
      // 1.26.8 的组件类型与 Group.add 的 INode 签名不完全兼容，运行时仍是同一图元树。
      container.add(tag as unknown as Parameters<typeof container.add>[0]);
    }

    return {
      rootContainer: container,
      renderDefault: false,
      enableCellPadding: true,
    };
  };
}
