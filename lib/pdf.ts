import { PDFParse } from "pdf-parse";

function normalizePdfText(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractPdfText(pdfBuffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: pdfBuffer });
  const result = await parser.getText();
  await parser.destroy();
  const text = normalizePdfText(result.text || "");

  if (!text) {
    throw new Error("Compiled PDF did not contain extractable text");
  }

  return text;
}
