import { ReactNode, createElement, useMemo } from 'react';

interface MarkdownContentProps {
  content: string;
  className?: string;
}

type HeadingTag = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
type KeyFactory = () => string;

function createKeyFactory(prefix: string): KeyFactory {
  let counter = 0;
  return () => `${prefix}-${counter++}`;
}

function isBlockStart(line: string) {
  return (
    /^```/.test(line) ||
    /^ {0,3}(#{1,6})\s+/.test(line) ||
    /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line) ||
    /^\s*> ?/.test(line) ||
    /^\s*[-+*]\s+/.test(line) ||
    /^\s*\d+\.\s+/.test(line)
  );
}

function sanitizeHref(rawHref: string) {
  const href = rawHref.trim();
  if (!href) {
    return null;
  }

  if (/^(https?:|mailto:)/i.test(href)) {
    return href;
  }

  if (/^(\/|\.\/|\.\.\/|#)/.test(href)) {
    return href;
  }

  return null;
}

function normalizeLinkHref(rawHref: string) {
  const titleMatch = rawHref.match(/^(.+?)\s+(?:"[^"]*"|'[^']*')\s*$/);
  return (titleMatch?.[1] ?? rawHref).trim();
}

function stripTrailingPunctuation(rawUrl: string) {
  let url = rawUrl;
  let trailing = '';

  while (/[),.!?;:]$/.test(url)) {
    trailing = `${url.slice(-1)}${trailing}`;
    url = url.slice(0, -1);
  }

  return { url, trailing };
}

function appendTextWithBreaks(text: string, nodes: ReactNode[], makeKey: KeyFactory) {
  if (!text) {
    return;
  }

  const parts = text.split('\n');
  parts.forEach((part, index) => {
    if (part) {
      nodes.push(part);
    }

    if (index < parts.length - 1) {
      nodes.push(createElement('br', { key: makeKey() }));
    }
  });
}

function appendPlainText(text: string, nodes: ReactNode[], makeKey: KeyFactory) {
  if (!text) {
    return;
  }

  const urlPattern = /https?:\/\/[^\s<]+/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = urlPattern.exec(text)) !== null) {
    if (match.index > cursor) {
      appendTextWithBreaks(text.slice(cursor, match.index), nodes, makeKey);
    }

    const { url, trailing } = stripTrailingPunctuation(match[0]);
    const href = sanitizeHref(url);

    if (href) {
      nodes.push(
        createElement(
          'a',
          {
            key: makeKey(),
            href,
            target: '_blank',
            rel: 'noreferrer',
          },
          url,
        ),
      );
    } else {
      appendTextWithBreaks(match[0], nodes, makeKey);
    }

    if (trailing) {
      appendTextWithBreaks(trailing, nodes, makeKey);
    }

    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    appendTextWithBreaks(text.slice(cursor), nodes, makeKey);
  }
}

function renderDelimitedInline(
  text: string,
  start: number,
  delimiter: string,
  tagName: 'strong' | 'em' | 'del',
  makeKey: KeyFactory,
) {
  if (!text.startsWith(delimiter, start)) {
    return null;
  }

  const end = text.indexOf(delimiter, start + delimiter.length);
  if (end === -1) {
    return null;
  }

  const inner = text.slice(start + delimiter.length, end);
  if (!inner.trim()) {
    return null;
  }

  return {
    end: end + delimiter.length,
    node: createElement(tagName, { key: makeKey() }, renderInline(inner, makeKey)),
  };
}

function renderLinkInline(text: string, start: number, makeKey: KeyFactory) {
  const match = text.slice(start).match(/^\[([^\]\n]+)\]\(([^)\n]+)\)/);
  if (!match) {
    return null;
  }

  const href = sanitizeHref(normalizeLinkHref(match[2]));
  const end = start + match[0].length;
  const label = renderInline(match[1], makeKey);

  if (!href) {
    return {
      end,
      node: createElement('span', { key: makeKey() }, label),
    };
  }

  return {
    end,
    node: createElement(
      'a',
      {
        key: makeKey(),
        href,
        target: '_blank',
        rel: 'noreferrer',
      },
      label,
    ),
  };
}

function renderInlineCode(text: string, start: number, makeKey: KeyFactory) {
  if (text[start] !== '`') {
    return null;
  }

  const end = text.indexOf('`', start + 1);
  if (end === -1) {
    return null;
  }

  return {
    end: end + 1,
    node: createElement('code', { key: makeKey() }, text.slice(start + 1, end)),
  };
}

function renderInline(text: string, makeKey: KeyFactory): ReactNode[] {
  const nodes: ReactNode[] = [];
  let index = 0;

  while (index < text.length) {
    const strong =
      renderDelimitedInline(text, index, '**', 'strong', makeKey) ??
      renderDelimitedInline(text, index, '__', 'strong', makeKey);
    if (strong) {
      nodes.push(strong.node);
      index = strong.end;
      continue;
    }

    const strike = renderDelimitedInline(text, index, '~~', 'del', makeKey);
    if (strike) {
      nodes.push(strike.node);
      index = strike.end;
      continue;
    }

    const inlineCode = renderInlineCode(text, index, makeKey);
    if (inlineCode) {
      nodes.push(inlineCode.node);
      index = inlineCode.end;
      continue;
    }

    const link = renderLinkInline(text, index, makeKey);
    if (link) {
      nodes.push(link.node);
      index = link.end;
      continue;
    }

    const emphasis =
      renderDelimitedInline(text, index, '*', 'em', makeKey) ??
      renderDelimitedInline(text, index, '_', 'em', makeKey);
    if (emphasis) {
      nodes.push(emphasis.node);
      index = emphasis.end;
      continue;
    }

    let nextIndex = index + 1;
    while (
      nextIndex < text.length &&
      text[nextIndex] !== '`' &&
      text[nextIndex] !== '[' &&
      text[nextIndex] !== '*' &&
      text[nextIndex] !== '_' &&
      !text.startsWith('~~', nextIndex)
    ) {
      nextIndex += 1;
    }

    appendPlainText(text.slice(index, nextIndex), nodes, makeKey);
    index = nextIndex;
  }

  return nodes;
}

function renderBlocks(markdown: string, makeKey: KeyFactory): ReactNode[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fenceMatch = line.match(/^```([\w-]+)?\s*$/);
    if (fenceMatch) {
      const language = fenceMatch[1]?.trim();
      const codeLines: string[] = [];
      index += 1;

      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }

      if (index < lines.length && /^```\s*$/.test(lines[index])) {
        index += 1;
      }

      blocks.push(
        <div key={makeKey()} className="markdown-code-block">
          {language ? <div className="markdown-code-header">{language}</div> : null}
          <pre>
            <code>{codeLines.join('\n')}</code>
          </pre>
        </div>,
      );
      continue;
    }

    const headingMatch = line.match(/^ {0,3}(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const headingTag = `h${Math.min(headingMatch[1].length, 6)}` as HeadingTag;
      blocks.push(
        createElement(
          headingTag,
          { key: makeKey() },
          renderInline(headingMatch[2].trim(), makeKey),
        ),
      );
      index += 1;
      continue;
    }

    if (/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      blocks.push(createElement('hr', { key: makeKey() }));
      index += 1;
      continue;
    }

    if (/^\s*> ?/.test(line)) {
      const quoteLines: string[] = [];

      while (index < lines.length) {
        const currentLine = lines[index];
        if (!currentLine.trim()) {
          quoteLines.push('');
          index += 1;
          continue;
        }

        if (!/^\s*> ?/.test(currentLine)) {
          break;
        }

        quoteLines.push(currentLine.replace(/^\s*> ?/, ''));
        index += 1;
      }

      blocks.push(
        <blockquote key={makeKey()}>
          {renderBlocks(quoteLines.join('\n'), makeKey)}
        </blockquote>,
      );
      continue;
    }

    const unorderedMatch = line.match(/^\s*[-+*]\s+(.*)$/);
    const orderedMatch = line.match(/^\s*\d+\.\s+(.*)$/);
    if (unorderedMatch || orderedMatch) {
      const ordered = Boolean(orderedMatch);
      const listItems: ReactNode[] = [];

      while (index < lines.length) {
        const currentLine = lines[index];
        const listMatch = ordered
          ? currentLine.match(/^\s*\d+\.\s+(.*)$/)
          : currentLine.match(/^\s*[-+*]\s+(.*)$/);

        if (!listMatch) {
          break;
        }

        const itemLines = [listMatch[1]];
        index += 1;

        while (index < lines.length) {
          const continuation = lines[index];
          if (!continuation.trim()) {
            break;
          }

          const nextListMarker = ordered
            ? /^\s*\d+\.\s+/.test(continuation)
            : /^\s*[-+*]\s+/.test(continuation);

          if (nextListMarker || /^```/.test(continuation) || /^ {0,3}(#{1,6})\s+/.test(continuation)) {
            break;
          }

          if (/^\s{2,}\S/.test(continuation)) {
            itemLines.push(continuation.trim());
            index += 1;
            continue;
          }

          break;
        }

        listItems.push(createElement('li', { key: makeKey() }, renderInline(itemLines.join('\n'), makeKey)));

        if (!lines[index]?.trim()) {
          break;
        }
      }

      blocks.push(createElement(ordered ? 'ol' : 'ul', { key: makeKey() }, listItems));
      continue;
    }

    const paragraphLines = [line];
    index += 1;

    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) {
      paragraphLines.push(lines[index]);
      index += 1;
    }

    blocks.push(createElement('p', { key: makeKey() }, renderInline(paragraphLines.join('\n'), makeKey)));
  }

  return blocks;
}

export default function MarkdownContent({ content, className }: MarkdownContentProps) {
  const nodes = useMemo(() => renderBlocks(content, createKeyFactory('markdown')), [content]);

  if (!nodes.length) {
    return null;
  }

  return <div className={['markdown-content', className].filter(Boolean).join(' ')}>{nodes}</div>;
}
