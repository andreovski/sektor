import { type Inline, parseMarkdown } from '@sektor/core/src/modules/projects/markdown';

function Text({ parts }: { parts: Inline[] }) {
  return parts.map((part, index) => {
    if (part.kind === 'bold') return <strong key={index}>{part.text}</strong>;
    if (part.kind === 'italic') return <em key={index}>{part.text}</em>;
    if (part.kind === 'code') {
      return (
        <code key={index} className="rounded-[4px] bg-sunken px-1 font-mono text-[0.9em]">
          {part.text}
        </code>
      );
    }
    return <span key={index}>{part.text}</span>;
  });
}

const HEADING = {
  1: 'text-xl font-semibold',
  2: 'text-lg font-semibold',
  3: 'text-base font-semibold',
};

export function MarkdownView({ source }: { source: string }) {
  return (
    <div className="flex flex-col gap-3 text-sm leading-relaxed whitespace-pre-wrap">
      {parseMarkdown(source).map((block, index) => {
        switch (block.kind) {
          case 'heading':
            return (
              <p key={index} role="heading" aria-level={block.level} className={HEADING[block.level]}>
                <Text parts={block.inline} />
              </p>
            );
          case 'list': {
            const List = block.ordered ? 'ol' : 'ul';
            return (
              <List
                key={index}
                className={block.ordered ? 'list-decimal pl-5' : 'list-disc pl-5'}
              >
                {block.items.map((item, position) => (
                  <li key={position}>
                    <Text parts={item} />
                  </li>
                ))}
              </List>
            );
          }
          case 'quote':
            return (
              <blockquote key={index} className="border-l-2 border-line-strong pl-3 text-muted">
                <Text parts={block.inline} />
              </blockquote>
            );
          case 'code':
            return (
              <pre key={index} className="overflow-x-auto rounded-control bg-sunken p-2.5 font-mono text-xs">
                {block.text}
              </pre>
            );
          default:
            return (
              <p key={index}>
                <Text parts={block.inline} />
              </p>
            );
        }
      })}
    </div>
  );
}
