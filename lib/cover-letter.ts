function escapeLatex(text: string): string {
  return text
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([#$%&_{}])/g, "\\$1")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/~/g, "\\textasciitilde{}");
}

export function buildCoverLetterTex(rawText: string): string {
  const paragraphs = rawText
    .split(/\r?\n\s*\r?\n/g)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => escapeLatex(chunk).replace(/\r?\n/g, "\\\\\n"));

  return String.raw`\documentclass[11pt]{article}
\usepackage[letterpaper,margin=1in]{geometry}
\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage{lmodern}
\setlength{\parindent}{0pt}
\setlength{\parskip}{10pt}
\begin{document}
${paragraphs.join("\n\n")}
\end{document}`;
}
