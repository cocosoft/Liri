/**
 * LaTeX 公式检测器
 *
 * 从 MarkdownRenderer 中提取，用于判断文本是否为 LaTeX 数学公式。
 * 纯函数，无任何外部依赖。
 */

/**
 * 判断文本是否为 LaTeX 公式
 *
 * 检测策略：
 * 1. 包含中文 → 不是公式
 * 2. 包含直引号（非 LaTeX 转义引号）→ 不是公式
 * 3. 包含 LaTeX 命令模式 → 是公式
 * 4. 简单的 a = b 形式（含 ^）→ 是公式
 */
export function isLatexFormula(text: string): boolean {
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

  const hasLatexPattern = latexPatterns.some((pattern) => pattern.test(text));

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
}
