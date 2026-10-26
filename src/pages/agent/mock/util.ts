/** 演示层小工具 */

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** 按不定长切块，模拟 token 流 */
export function splitText(text: string, size: number): string[] {
  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const step = size + Math.floor(Math.random() * size);
    chunks.push(text.slice(cursor, cursor + step));
    cursor += step;
  }
  return chunks;
}
