import PDFParser from "pdf2json";
import { logger } from "./logger";

// pdf2json unit: 1 unit = 4.5 points
const UNIT = 4.5;

export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextElement {
  type: "text_block";
  bbox: BBox;
  content: string;
  formatting: {
    alignment: string;
    fontSize_pt: number;
    bold: boolean;
    italic: boolean;
    underline: boolean;
  };
}

export interface GraphicElement {
  type: "graphic";
  bbox: BBox;
  content: string;
}

export type PageElement = TextElement | GraphicElement;

export interface PageData {
  pageNumber: number;
  width: number;
  height: number;
  orientation: "portrait" | "landscape";
  layoutSummary: string;
  elements: PageElement[];
}

export interface DocumentData {
  pageCount: number;
  unit: "pt";
  pages: PageData[];
}

export async function extractPdfCoordinates(buffer: Buffer): Promise<DocumentData> {
  return new Promise((resolve, reject) => {
    const parser = new (PDFParser as any)(null, 1);

    parser.on("pdfParser_dataReady", (raw: any) => {
      try {
        const pages: PageData[] = (raw.Pages || []).map((page: any, idx: number) => {
          const width = Math.round((page.Width || 0) * UNIT * 100) / 100;
          const height = Math.round((page.Height || 0) * UNIT * 100) / 100;
          const elements: PageElement[] = [];

          for (const text of (page.Texts || [])) {
            let content = "";
            try {
              content = decodeURIComponent(
                (text.R || []).map((r: any) => r.T || "").join("")
              ).trim();
            } catch {
              content = (text.R || []).map((r: any) => r.T || "").join("").trim();
            }

            if (!content) continue;

            const r0 = text.R?.[0] || {};
            const ts = r0.TS || [null, 12, 0, 0];
            const fontSize = ts[1] || 12;
            const bold = ts[2] === 1;
            const italic = ts[3] === 1;

            const x = Math.round((text.x || 0) * UNIT * 100) / 100;
            const y = Math.round((text.y || 0) * UNIT * 100) / 100;
            const w = Math.round((text.w || 0) * UNIT * 100) / 100;
            const h = Math.round(fontSize * 1.2 * 100) / 100;

            elements.push({
              type: "text_block",
              bbox: { x, y, width: w, height: h },
              content,
              formatting: {
                alignment: "right",
                fontSize_pt: fontSize,
                bold,
                italic,
                underline: false,
              },
            });
          }

          elements.sort((a, b) => a.bbox.y - b.bbox.y);

          return {
            pageNumber: idx + 1,
            width,
            height,
            orientation: width > height ? "landscape" : "portrait",
            layoutSummary: elements.length + " text block(s)",
            elements,
          };
        });

        logger.info({ pageCount: pages.length }, "PDF extraction complete");
        resolve({ pageCount: pages.length, unit: "pt", pages });
      } catch (err) {
        reject(err);
      }
    });

    parser.on("pdfParser_dataError", (err: any) => {
      reject(new Error(err?.parserError || "PDF parse error"));
    });

    parser.parseBuffer(buffer);
  });
}

export function buildFillableJson(doc: DocumentData): Record<string, string> {
  const fillable: Record<string, string> = {};
  for (const page of doc.pages) {
    for (const el of page.elements) {
      if (el.type !== "text_block") continue;
      const raw = el.content
        .replace(/\.{3,}/g, "")
        .replace(/[::\u0640]/g, "")
        .trim();
      if (!raw || raw.length < 2) continue;
      const key = raw
        .replace(/\s+/g, "_")
        .replace(/[^\w\u0600-\u06FF_]/g, "")
        .slice(0, 40);
      if (key && !(key in fillable)) {
        fillable[key] = "";
      }
    }
  }
  return fillable;
}
