/**
 * 非 $...$ 包裹的裸 LaTeX 公式自动检测 — MarkdownRenderer V1/V2 共享
 * MIT License
 *
 * 用于 react-markdown 无法处理的场景（模型输出原始公式，未用 $ 或 $$ 包裹）
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
