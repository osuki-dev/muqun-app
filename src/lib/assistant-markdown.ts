/**
 * Display-only tolerance for a common Chinese model response: `**重点。**后文`.
 * CommonMark cannot close emphasis between punctuation and a letter. Moving
 * that punctuation outside the span keeps the visible words and spacing while
 * allowing the intended strong span. The message, copy and export stay raw.
 *
 * Deliberately not a general Markdown repair. Only simple, complete strong
 * spans within one prose run qualify. Files and user messages never call this.
 */
export function normalizeAssistantMarkdown(markdown: string): string {
  if (!markdown.includes('**')) return markdown;
  // HTML can own content across lines and blank paragraphs (notably <pre>).
  // Keep such messages entirely standard rather than guess at HTML nesting.
  if (/<\/?[a-z][\w:-]*(?:\s|\/?>|$)|<!--|<![A-Z]|<\?/i.test(markdown)) return markdown;
  let fence: string | undefined;
  let inlineCode: string | undefined;
  let literalParagraph = false;
  return markdown
    .split(/(?<=\n)/)
    .map((line) => {
      if (literalParagraph) {
        if (!line.trim()) literalParagraph = false;
        return line;
      }
      const marker = /^\s*(?:>\s*)*(?:(?:[-+*]|\d+[.)])\s+)?(`{3,}|~{3,})/.exec(line)?.[1];
      if (fence) {
        if (
          marker?.[0] === fence[0] &&
          marker.length >= fence.length &&
          line.slice(line.indexOf(marker) + marker.length).trim() === ''
        )
          fence = undefined;
        return line;
      }
      if (!inlineCode && marker) {
        fence = marker;
        return line;
      }
      // Indented code and reference definitions are literal here.
      if (!inlineCode && /^(?: {4}|\t)/.test(line)) return line;
      if (!inlineCode && /^\s*(?:>\s*)*\[[^\]]+\]:/.test(line)) {
        literalParagraph = true;
        return line;
      }

      let output = '';
      let prose = '';
      const flush = () => {
        output += normalizeProse(prose);
        prose = '';
      };
      for (let index = 0; index < line.length;) {
        if (inlineCode) {
          const run = /^`+/.exec(line.slice(index))?.[0];
          if (run === inlineCode) inlineCode = undefined;
          output += run ?? line[index];
          index += run?.length ?? 1;
          continue;
        }
        const character = line[index];
        const url = /^[a-z]/i.test(character)
          ? /^(?:(?:https?|ftp|file):\/\/|www\.)[^\s<>]+/i.exec(line.slice(index))?.[0]
          : undefined;
        if (url) {
          flush();
          output += url;
          index += url.length;
        } else if (character === '`') {
          flush();
          inlineCode = /^`+/.exec(line.slice(index))![0];
          output += inlineCode;
          index += inlineCode.length;
        } else if (character === '\\') {
          flush();
          output += line.slice(index, index + 2);
          index += 2;
        } else if (character === '[' || character === '<' || character === '$') {
          // Keep links/images (including destinations and titles), autolinks,
          // and math untouched. If syntax is still streaming, retain the
          // rest of this line rather than guessing where prose resumes.
          flush();
          const end = protectedEnd(line, index);
          if (end === line.length) literalParagraph = true;
          output += line.slice(index, end);
          index = end;
        } else {
          prose += character;
          index += 1;
        }
      }
      flush();
      return output;
    })
    .join('');
}

const STRONG = /(?<!\*)\*\*([^*\r\n]+)\*\*(?!\*)(?=\p{Script=Han})/gu;
const TRAILING_PUNCTUATION = /[。，；：！？、）〉》」』】〕〗〙〛”’]+$/u;

function normalizeProse(prose: string): string {
  return prose.replace(STRONG, (source, content: string) => {
    // An opening quote after a Chinese letter has its own delimiter ambiguity;
    // do not turn this narrow closing-delimiter correction into a full parser.
    if (!/^[\p{L}\p{N}]/u.test(content) || !/\p{Script=Han}/u.test(content)) return source;
    const punctuation = TRAILING_PUNCTUATION.exec(content)?.[0];
    if (!punctuation) return source;
    const body = content.slice(0, -punctuation.length);
    if (!body || /\s$/u.test(body)) return source;
    return `**${body}**${punctuation}`;
  });
}

/** End of a literal inline construct; an unfinished one owns the line's tail. */
function protectedEnd(line: string, start: number): number {
  const opener = line[start];
  if (opener === '<' || opener === '$') {
    const delimiter = opener === '<' ? '>' : line.startsWith('$$', start) ? '$$' : '$';
    const end = line.indexOf(delimiter, start + (opener === '$' ? delimiter.length : 1));
    return end < 0 ? line.length : end + delimiter.length;
  }
  const labelEnd = balancedEnd(line, start, '[', ']');
  if (labelEnd >= line.length) return line.length;
  if (line[labelEnd] === '(') return balancedEnd(line, labelEnd, '(', ')');
  if (line[labelEnd] === '[') return balancedEnd(line, labelEnd, '[', ']');
  return labelEnd;
}

function balancedEnd(line: string, start: number, open: string, close: string): number {
  let depth = 1;
  let quote: string | undefined;
  for (let index = start + 1; index < line.length; index += 1) {
    const character = line[index];
    if (character === '\\') index += 1;
    else if (quote) {
      if (character === quote) quote = undefined;
    } else if (open === '(' && (character === '"' || character === "'")) quote = character;
    else if (character === open) depth += 1;
    else if (character === close && --depth === 0) return index + 1;
  }
  return line.length;
}
