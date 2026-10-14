/** 表格主题（配色与选中态） */
import { themes } from '@visactor/vtable';

export const THEME: themes.TableTheme = themes.DEFAULT.extends({
  underlayBackgroundColor: '#ffffff',
  // 内容没撑满容器时，横向滚动条也贴到容器边缘，避免停在数据行下方
  scrollStyle: { barToSide: true },
  defaultStyle: {
    bgColor: '#ffffff',
    color: '#1f1f1f',
    fontSize: 12,
    padding: [2, 8],
    borderColor: '#f0f0f0',
    borderLineWidth: 1,
  },
  headerStyle: {
    bgColor: '#fafafa',
    color: '#1f1f1f',
    fontSize: 12,
    fontWeight: 'bold',
    padding: [4, 8],
    frameStyle: { borderColor: '#e8e8e8', borderLineWidth: 1 },
  },
  bodyStyle: {
    bgColor: '#ffffff',
    color: '#1f1f1f',
    fontSize: 12,
    padding: [2, 8],
    // 选中整行 / 悬停整行的高亮色，横向滚动时也能看清选中的是哪一行
    select: { inlineRowBgColor: '#e6f4ff', cellBgColor: '#e6f4ff' },
    hover: { inlineRowBgColor: '#f5f8ff' },
    frameStyle: { borderColor: '#f0f0f0', borderLineWidth: 1 },
  },
  selectionStyle: {
    cellBorderColor: '#1677ff',
    cellBorderLineWidth: 1,
    cellBgColor: 'rgba(22,119,255,0.10)',
    // 多个选中范围（Ctrl 多选）时，isCellSelected 只有在这一项等于 'replace' 时才会给范围内的格子上色，
    // 主题默认是 'overlay'，结果就是多选一格都不上色、只剩范围边框
    selectionFillMode: 'replace',
  },
  frameStyle: { borderColor: '#e8e8e8', borderLineWidth: 1 },
});
