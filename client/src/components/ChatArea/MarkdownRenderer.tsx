import React, { useEffect, useRef, useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import mermaid from 'mermaid';

interface MarkdownRendererProps {
  content: string;
  isStreaming?: boolean;
}

interface RenderedBlock {
  id: number;
  type: 'text' | 'code' | 'math' | 'mermaid' | 'table' | 'heading' | 'list' | 'hr';
  content: string;
  language?: string;
  level?: number;
}

function parseMarkdown(text: string, blockIdRef: { current: number }): RenderedBlock[] {
  const result: RenderedBlock[] = [];
  const lines = text.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('```')) {
      const match = line.match(/```(\w+)?/);
      const language = match?.[1] || 'text';
      let codeContent = '';
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeContent += lines[i] + '\n';
        i++;
      }
      i++;
      blockIdRef.current++;
      if (language === 'mermaid') {
        result.push({ id: blockIdRef.current, type: 'mermaid', content: codeContent.trim() });
      } else {
        result.push({ id: blockIdRef.current, type: 'code', content: codeContent.trim(), language });
      }
    } else if (line.startsWith('$$')) {
      let mathContent = line.slice(2);
      if (line.endsWith('$$')) {
        mathContent = line.slice(2, -2);
        blockIdRef.current++;
        result.push({ id: blockIdRef.current, type: 'math', content: mathContent.trim() });
        i++;
      } else {
        i++;
        while (i < lines.length && !lines[i].endsWith('$$')) {
          mathContent += '\n' + lines[i];
          i++;
        }
        if (i < lines.length) {
          mathContent += '\n' + lines[i].slice(0, -2);
          i++;
        }
        blockIdRef.current++;
        result.push({ id: blockIdRef.current, type: 'math', content: mathContent.trim() });
      }
    } else if (line.match(/^\|.+\|$/)) {
      let tableContent = line + '\n';
      i++;
      while (i < lines.length && lines[i].match(/^\|.+\|$/)) {
        tableContent += lines[i] + '\n';
        i++;
      }
      blockIdRef.current++;
      result.push({ id: blockIdRef.current, type: 'table', content: tableContent.trim() });
    } else if (line.match(/^#{1,6}\s/)) {
      const level = line.match(/^#{1,6}/)?.[0].length || 1;
      const content = line.replace(/^#{1,6}\s/, '').trim();
      blockIdRef.current++;
      result.push({ id: blockIdRef.current, type: 'heading', content, level });
      i++;
    } else if (line.match(/^[-*+]\s/) || line.match(/^\d+\.\s/)) {
      let listContent = line + '\n';
      i++;
      while (i < lines.length && (lines[i].match(/^[-*+]\s/) || lines[i].match(/^\d+\.\s/) || lines[i].startsWith('  ') || lines[i].startsWith('\t'))) {
        listContent += lines[i] + '\n';
        i++;
      }
      blockIdRef.current++;
      result.push({ id: blockIdRef.current, type: 'list', content: listContent.trim() });
    } else if (line.match(/^---*$/)) {
      blockIdRef.current++;
      result.push({ id: blockIdRef.current, type: 'hr', content: '' });
      i++;
    } else {
      let textContent = line;
      i++;
      while (i < lines.length && 
             !lines[i].startsWith('```') && 
             !lines[i].startsWith('$$') && 
             !lines[i].match(/^\|.+\|$/) &&
             !lines[i].match(/^#{1,6}\s/) &&
             !lines[i].match(/^[-*+]\s/) && 
             !lines[i].match(/^\d+\.\s/) &&
             !lines[i].match(/^---*$/)) {
        textContent += '\n' + lines[i];
        i++;
      }
      blockIdRef.current++;
      result.push({ id: blockIdRef.current, type: 'text', content: textContent.trim() });
    }
  }

  return result;
}

function MarkdownRenderer({ content, isStreaming }: MarkdownRendererProps) {
  const blockIdRef = useRef(0);

  const blocks = useMemo(() => {
    return parseMarkdown(content, blockIdRef);
  }, [content]);

  useEffect(() => {
    mermaid.initialize({ startOnLoad: false });
    const mermaidElements = document.querySelectorAll('.mermaid');
    mermaidElements.forEach(async (el) => {
      if (!el.classList.contains('rendered')) {
        const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const code = (el as HTMLElement).textContent || '';
        const { svg } = await mermaid.render(id, code);
        (el as HTMLElement).innerHTML = svg;
        el.classList.add('rendered');
      }
    });
  }, [blocks]);



  const renderHeading = (content: string, level: number, key: string) => {
    const HeadingTag = `h${level}` as keyof JSX.IntrinsicElements;
    const sizes = ['text-2xl', 'text-xl', 'text-lg', 'text-base', 'text-sm', 'text-xs'];
    const margins = ['my-4', 'my-3', 'my-2', 'my-2', 'my-1', 'my-1'];
    
    return React.createElement(HeadingTag, { 
      key,
      className: `${sizes[level - 1]} font-bold text-gray-900 dark:text-white ${margins[level - 1]}` 
    }, renderText(content));
  };

  const renderList = (content: string, key: string) => {
    const lines = content.split('\n');
    const isOrdered = lines[0].match(/^\d+\.\s/) !== null;
    const items: JSX.Element[] = [];

    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      let itemContent = '';
      
      if (line.startsWith('  ')) {
        itemContent = line.trim();
      } else {
        itemContent = line.replace(/^[-*+]\s/, '').replace(/^\d+\.\s/, '');
      }

      items.push(
        <li key={idx} className="ml-4 my-1">
          {renderText(itemContent)}
        </li>
      );
    });

    if (isOrdered) {
      return <ol key={key} className="my-2 list-decimal">{items}</ol>;
    }
    return <ul key={key} className="my-2 list-disc">{items}</ul>;
  };

  const isLatexFormula = (text: string): boolean => {
    const hasChineseChars = /[\u4e00-\u9fa5]/.test(text);
    const hasStraightQuotes = /(?<!\\)"./.test(text) || /(?<!\\)"$/.test(text);
    
    if (hasStraightQuotes) {
      return false;
    }
    
    const latexPatterns = [
      /\\frac/,
      /\\sqrt/,
      /\\sum/,
      /\\int/,
      /\\prod/,
      /\\alpha|\\beta|\\gamma|\\delta|\\epsilon|\\zeta|\\eta|\\theta|\\iota|\\kappa|\\lambda|\\mu|\\nu|\\xi|\\pi|\\rho|\\sigma|\\tau|\\upsilon|\\phi|\\chi|\\psi|\\omega/,
      /\\Gamma|\\Delta|\\Theta|\\Lambda|\\Xi|\\Pi|\\Sigma|\\Upsilon|\\Phi|\\Psi|\\Omega/,
      /\\infty/,
      /\\cdot/,
      /\\times/,
      /\\pm/,
      /\\mp/,
      /\\begin\{/,
      /\\end\{/,
      /\\mathbf/,
      /\\mathbb/,
      /\\mathcal/,
      /\\partial/,
      /\\nabla/,
      /\\exists/,
      /\\forall/,
      /\\Rightarrow/,
      /\\Leftarrow/,
      /\\Leftrightarrow/,
      /\\rightarrow/,
      /\\leftarrow/,
      /\\leftrightarrow/,
      /\\approx/,
      /\\equiv/,
      /\\neq/,
      /\\leq/,
      /\\geq/,
      /\\propto/,
      /\\in/,
      /\\notin/,
      /\\subset/,
      /\\supset/,
      /\\subseteq/,
      /\\supseteq/,
      /\\cap/,
      /\\cup/,
      /\\emptyset/,
      /\\to/,
      /\\mapsto/,
      /\\circ/,
      /\\star/,
      /\\oplus/,
      /\\otimes/,
      /\\odot/,
      /\\div/,
      /\\root/,
      /\\log/,
      /\\ln/,
      /\\sin|\\cos|\\tan|\\cot|\\sec|\\csc/,
      /\\arcsin|\\arccos|\\arctan/,
      /\\sinh|\\cosh|\\tanh|\\coth/,
      /\\exp/,
      /\\lim/,
      /\\inf/,
      /\\sup/,
      /\\det/,
      /\\tr/,
      /\\dim/,
      /\\rank/,
      /\\ker/,
      /\\coker/,
      /\\hom/,
      /\\bigoplus/,
      /\\bigotimes/,
      /\\coprod/,
      /\\bigcup/,
      /\\bigcap/,
      /\\bigsqcup/,
      /\\oint/,
      /\\iint/,
      /\\iiint/,
      /\\idotsint/,
      /\\sum_{/,
      /\\prod_{/,
      /\\int_{/,
      /\\frac\{/,
      /\\lim_{/,
      /\\left/,
      /\\right/,
      /\\sqrt\[/,
      /\\text\{/,
      /\\mathrm\{/,
      /\\mathbf\{/,
      /\\mathit\{/,
      /\\mathcal\{/,
      /\\mathbb\{/,
      /\\boldsymbol\{/,
      /\\overline\{/,
      /\\underline\{/,
      /\\vec\{/,
      /\\tilde\{/,
      /\\hat\{/,
      /\\bar\{/,
      /\\dot\{/,
      /\\ddot\{/,
      /\\prime/,
      /\\dagger/,
      /\\ddagger/,
      /\\quad/,
      /\\qquad/,
      /\\hspace\{/,
      /\\vspace\{/,
      /\\linebreak/,
      /\\newline/,
      /\\lbrace|\\rbrace/,
      /\\lbrack|\\rbrack/,
      /\\langle|\\rangle/,
      /\\lfloor|\\rfloor/,
      /\\lceil|\\rceil/,
      /\\vert|\\lvert|\\rvert/,
      /\\Vert|\\lVert|\\rVert/,
      /\\backslash/,
      /\\slash/,
      /\\%/,
      /\\$/,
      /\\#/,
      /\\&/,
      /\\_/,
      /\\\{/,
      /\\\}/,
    ];

    const hasLatexPattern = latexPatterns.some(pattern => pattern.test(text));
    
    if (hasLatexPattern) {
      return true;
    }
    
    if (hasChineseChars) {
      return false;
    }
    
    const simpleMathPattern = /^[a-zA-Z]\s*=\s*[a-zA-Z0-9^+\-*/()\s]+$/;
    if (simpleMathPattern.test(text) && /\^/.test(text)) {
      return true;
    }
    
    return false;
  };

  const renderText = (text: string, autoDetectFormula: boolean = true) => {
    const parts: JSX.Element[] = [];
    let remaining = text;
    let key = 0;

    const patterns = [
      { regex: /\*\*(.+?)\*\*/g, tag: 'strong' as const },
      { regex: /\*(.+?)\*/g, tag: 'em' as const },
      { regex: /`([^`]+)`/g, tag: 'code' as const },
      { regex: /\[([^\]]+)\]\(([^)]+)\)/g, tag: 'link' as const },
      { regex: /\$([^$]+)\$/g, tag: 'math' as const },
    ];

    let hasMatch = true;
    while (hasMatch) {
      hasMatch = false;
      let earliestMatch: { index: number; pattern: typeof patterns[0]; match: RegExpExecArray } | null = null;

      for (const pattern of patterns) {
        pattern.regex.lastIndex = 0;
        const match = pattern.regex.exec(remaining);
        if (match && (!earliestMatch || match.index < earliestMatch.index)) {
          earliestMatch = { index: match.index, pattern, match };
          hasMatch = true;
        }
      }

      if (earliestMatch) {
        const { index, pattern, match } = earliestMatch;
        if (index > 0) {
          const beforeText = remaining.slice(0, index);
          if (autoDetectFormula && isLatexFormula(beforeText)) {
            const renderedFormula = katex.renderToString(beforeText, { displayMode: false });
            parts.push(
              <span
                key={key++}
                className="inline-block"
                dangerouslySetInnerHTML={{ __html: renderedFormula }}
              />
            );
          } else {
            parts.push(<span key={key++}>{beforeText}</span>);
          }
        }
        if (pattern.tag === 'link') {
          parts.push(
            <a
              key={key++}
              href={match[2]}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:underline"
            >
              {match[1]}
            </a>
          );
        } else if (pattern.tag === 'math') {
          const renderedFormula = katex.renderToString(match[1], { displayMode: false });
          parts.push(
            <span
              key={key++}
              className="inline-block"
              dangerouslySetInnerHTML={{ __html: renderedFormula }}
            />
          );
        } else {
          parts.push(
            React.createElement(pattern.tag, { key: key++ }, match[1])
          );
        }
        remaining = remaining.slice(index + match[0].length);
      }
    }

    if (remaining) {
      if (autoDetectFormula && isLatexFormula(remaining)) {
        const renderedFormula = katex.renderToString(remaining, { displayMode: false });
        parts.push(
          <span
            key={key}
            className="inline-block"
            dangerouslySetInnerHTML={{ __html: renderedFormula }}
          />
        );
      } else {
        parts.push(<span key={key}>{remaining}</span>);
      }
    }

    return parts;
  };

  const renderTable = (content: string, autoDetectFormula: boolean = true) => {
    const rows = content.split('\n');
    if (rows.length < 2) return null;

    const headers = rows[0].split('|').filter((cell) => cell.trim());
    const separator = rows[1];
    const dataRows = rows.slice(2);

    const alignments = separator.split('|').filter((cell) => cell.trim()).map((cell) => {
      if (cell.startsWith(':') && cell.endsWith(':')) return 'center';
      if (cell.startsWith(':')) return 'left';
      if (cell.endsWith(':')) return 'right';
      return 'left';
    });

    return (
      <table className="w-full border-collapse my-4">
        <thead>
          <tr className="bg-gray-100 dark:bg-gray-700">
            {headers.map((header, idx) => (
              <th
                key={idx}
                className="border border-gray-300 dark:border-gray-600 px-4 py-2 text-left"
                style={{ textAlign: alignments[idx] as 'left' | 'center' | 'right' }}
              >
                <span>{renderText(header.trim(), autoDetectFormula)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dataRows.map((row, rowIdx) => {
            const cells = row.split('|').filter((cell) => cell.trim());
            return (
              <tr
                key={rowIdx}
                className={rowIdx % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50 dark:bg-gray-750'}
              >
                {cells.map((cell, cellIdx) => (
                  <td
                    key={cellIdx}
                    className="border border-gray-300 dark:border-gray-600 px-4 py-2"
                    style={{ textAlign: alignments[cellIdx] as 'left' | 'center' | 'right' }}
                  >
                    <span>{renderText(cell.trim(), autoDetectFormula)}</span>
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  };

  return (
    <div className="prose prose-sm max-w-none">
      {blocks.map((block) => {
        switch (block.type) {
          case 'code':
            return (
              <pre
                key={block.id}
                className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-sm my-2"
              >
                <code>{block.content}</code>
              </pre>
            );
          case 'math': {
            const renderedFormula = katex.renderToString(block.content, { displayMode: true });
            return (
              <div
                key={block.id}
                className="my-4 text-center"
                dangerouslySetInnerHTML={{
                  __html: renderedFormula,
                }}
              />
            );
          }
          case 'mermaid':
            return (
              <div
                key={block.id}
                className="mermaid my-4"
                style={{ backgroundColor: '#1a1a1a', padding: '1rem', borderRadius: '8px' }}
              >
                {block.content}
              </div>
            );
          case 'table':
            return <div key={block.id} className="overflow-x-auto">{renderTable(block.content, !isStreaming)}</div>;
          case 'heading':
            return renderHeading(block.content, block.level || 1, String(block.id));
          case 'list':
            return renderList(block.content, String(block.id));
          case 'hr':
            return <hr key={block.id} className="my-4 border-gray-300 dark:border-gray-600" />;
          case 'text':
            return (
              <p key={block.id} className="my-2 whitespace-pre-wrap">
                {renderText(block.content, !isStreaming)}
              </p>
            );
          default:
            return null;
        }
      })}
      {isStreaming && (
        <span className="animate-pulse">▌</span>
      )}
    </div>
  );
}

export default MarkdownRenderer;