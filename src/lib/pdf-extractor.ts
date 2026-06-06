// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFParser = require("pdf2json");
import { logger } from "./logger";

const UNIT = 4.5;
const MAX_PAGES = 50;
const TIMEOUT_MS = 60_000;

export interface BBox { x: number; y: number; width: number; height: number; }

export interface TextElement {
  type: "text_block";
  bbox: BBox;
  content: string;
  formatting: { alignment: string; fontSize_pt: number; bold: boolean; italic: boolean; underline: boolean; };
}

export interface GraphicElement { type: "graphic"; bbox: BBox; content: string; }
export type PageElement = TextElement | GraphicElement;

export interface PageData {
  pageNumber: number; width: number; height: number;
  orientation: "portrait" | "landscape"; layoutSummary: string; elements: PageElement[];
}

export interface DocumentData { pageCount: number; unit: "pt"; pages: PageData[]; }

function parseWithTimeout(parser: any, buffer: Buffer): Promise<any> {
  return Promise.race([
    new Promise<any>((resolve, reject) => {
      parser.on("pdfParser_dataReady", resolve);
      parser.on("pdfParser_dataError", (e: any) => reject(new Error(e?.parserError || "PDF parse error")));
      parser.parseBuffer(buffer);
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("TIMEOUT")), TIMEOUT_MS)
    ),
  ]);
}

export async function extractPdfCoordinates(buffer: Buffer): Promise<DocumentData> {
  const parser = new PDFParser(null, 1);
  const raw = await parseWithTimeout(parser, buffer);

  const allPages: any[] = raw.Pages || [];
  const pagesToProcess = allPages.slice(0, MAX_PAGES);
  const skipped = allPages.length - pagesToProcess.length;

  const pages: PageData[] = pagesToProcess.map((page: any, idx: number) => {
    const width  = Math.round((page.Width  || 0) * UNIT * 100) / 100;
    const height = Math.round((page.Height || 0) * UNIT * 100) / 100;
    const elements: PageElement[] = [];

    for (const text of (page.Texts || [])) {
      let content = "";
      try {
        content = decodeURIComponent((text.R || []).map((r: any) => r.T || "").join("")).trim();
      } catch {
        content = (text.R || []).map((r: any) => r.T || "").join("").trim();
      }
      if (!content) continue;

      const r0 = (text.R || [])[0] || {};
      const ts: any[] = r0.TS || [null, 12, 0, 0];
      const fontSize: number = ts[1] || 12;

      elements.push({
        type: "text_block",
        bbox: {
          x: Math.round((text.x || 0) * UNIT * 100) / 100,
          y: Math.round((text.y || 0) * UNIT * 100) / 100,
          width:  Math.round((text.w || 0) * UNIT * 100) / 100,
          height: Math.round(fontSize * 1.2 * 100) / 100,
        },
        content,
        formatting: {
          alignment: "right",
          fontSize_pt: fontSize,
          bold:   ts[2] === 1,
          italic: ts[3] === 1,
          underline: false,
        },
      });
    }

    elements.sort((a, b) => a.bbox.y - b.bbox.y);

    return {
      pageNumber: idx + 1,
      width, height,
      orientation: (width > height ? "landscape" : "portrait") as "landscape" | "portrait",
      layoutSummary: elements.length + " text block(s)" + (skipped > 0 && idx === pagesToProcess.length - 1 ? ` (${skipped} pages skipped)` : ""),
      elements,
    };
  });

  logger.info({ pageCount: pages.length, skipped }, "PDF extraction complete");
  return { pageCount: allPages.length, unit: "pt", pages };
}

export function buildFillableJson(doc: DocumentData): Record<string, string> {
  const fillable: Record<string, string> = {};
  for (const page of doc.pages) {
    for (const el of page.elements) {
      if (el.type !== "text_block") continue;
      const raw = el.content.replace(/\.{3,}/g, "").replace(/[:\u0640]/g, "").trim();
      if (!raw || raw.length < 2) continue;
      const key = raw.replace(/\s+/g, "_").replace(/[^\w\u0600-\u06FF_]/g, "").slice(0, 40);
      if (key && !(key in fillable)) fillable[key] = "";
    }
  }
  return fillable;
}
