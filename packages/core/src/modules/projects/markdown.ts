// Markdown simples: o que uma nota precisa, sem HTML e sem links, para nada de fora entrar na tela.
export type Inline = { kind: 'text' | 'bold' | 'italic' | 'code'; text: string };

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; inline: Inline[] }
  | { kind: 'paragraph'; inline: Inline[] }
  | { kind: 'quote'; inline: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'code'; text: string };

const INLINE = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*/g;

export function parseInline(text: string): Inline[] {
  const parts: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) parts.push({ kind: 'text', text: text.slice(last, match.index) });
    const [whole, code, bold, italic] = match;
    if (code !== undefined) parts.push({ kind: 'code', text: code });
    else if (bold !== undefined) parts.push({ kind: 'bold', text: bold });
    else parts.push({ kind: 'italic', text: italic! });
    last = match.index + whole.length;
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) });
  return parts;
}

const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBER = /^\s*\d+\.\s+(.*)$/;

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (line.trimStart().startsWith('```')) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index]!.trimStart().startsWith('```')) {
        code.push(lines[index]!);
        index += 1;
      }
      index += 1;
      blocks.push({ kind: 'code', text: code.join('\n') });
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({
        kind: 'heading',
        level: heading[1]!.length as 1 | 2 | 3,
        inline: parseInline(heading[2]!),
      });
      index += 1;
      continue;
    }
    const marker = BULLET.test(line) ? BULLET : NUMBER.test(line) ? NUMBER : null;
    if (marker) {
      const items: Inline[][] = [];
      while (index < lines.length && marker.test(lines[index]!)) {
        items.push(parseInline(marker.exec(lines[index]!)![1]!));
        index += 1;
      }
      blocks.push({ kind: 'list', ordered: marker === NUMBER, items });
      continue;
    }
    if (line.startsWith('>')) {
      const quote: string[] = [];
      while (index < lines.length && lines[index]!.startsWith('>')) {
        quote.push(lines[index]!.replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push({ kind: 'quote', inline: parseInline(quote.join('\n')) });
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && isPlain(lines[index]!)) {
      paragraph.push(lines[index]!);
      index += 1;
    }
    blocks.push({ kind: 'paragraph', inline: parseInline(paragraph.join('\n')) });
  }
  return blocks;
}

function isPlain(line: string) {
  return (
    Boolean(line.trim()) &&
    !line.trimStart().startsWith('```') &&
    !/^#{1,3}\s/.test(line) &&
    !BULLET.test(line) &&
    !NUMBER.test(line) &&
    !line.startsWith('>')
  );
}
