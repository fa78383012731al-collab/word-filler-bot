import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.js";
import { logger } from "./logger";

// Disable worker in Node.js environment
(GlobalWorkerOptions as any).workerSrc = false;

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
  const data = new Uint8Array(buffer);
  const loadingTask = getDocument({ data, disableFontFace: true, useSystemFonts: true });
  const pdf = await loadingTask.promise;

  const pageCount = pdf.numPages;
  const pages: PageData[] = [];

  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.0 });
    const width = viewport.width;
    const height = viewport.height;
    const orientation = width > height ? "landscape" : "portrait";

    const textContent = await page.getTextContent();
    const elements: PageElement[] = [];

    // Group text items into blocks by proximity
    const textItems = textContent.items as any[];

    // Merge nearby text items into blocks
    const blocks: { x: number; y: number; w: number; h: number; text: string; fontSize: number }[] = [];

    for (const item of textItems) {
      if (!item.str || item.str.trim() === "") continue;

      const transform = item.transform;
      // transform = [scaleX, skewX, skewY, scaleY, translateX, translateY]
      const x = transform[4];
      // PDF Y-axis is bottom-up, convert to top-down
      const y = height - transform[5] - Math.abs(transform[3]);
      const itemWidth = item.width || 0;
      const fontSize = Math.abs(transform[3]) || Math.abs(transform[0]);

      // Check if this item belongs to an existing block (same line, close proximity)
      let merged = false;
      for (const block of blocks) {
        const sameRow = Math.abs(block.y - y) < fontSize * 1.5;
        const horizontallyClose = Math.abs((block.x + block.w) - x) < fontSize * 3;
        if (sameRow && horizontallyClose) {
          block.text = block.text + " " + item.str;
          block.w = (x + itemWidth) - block.x;
          merged = true;
          break;
        }
      }

      if (!merged) {
        blocks.push({ x, y, w: itemWidth || fontSize * item.str.length * 0.6, h: fontSize, text: item.str, fontSize });
      }
    }

    // Convert blocks to TextElements
    for (const block of blocks) {
      elements.push({
        type: "text_block",
        bbox: {
          x: Math.round(block.x * 100) / 100,
          y: Math.round(block.y * 100) / 100,
          width: Math.round(block.w * 100) / 100,
          height: Math.round(block.h * 100) / 100,
        },
        content: block.text.trim(),
        formatting: {
          alignment: "right",
          fontSize_pt: Math.round(block.fontSize * 100) / 100,
          bold: false,
          italic: false,
          underline: false,
        },
      });
    }

    // Sort by Y position (top to bottom)
    elements.sort((a, b) => a.bbox.y - b.bbox.y);

    const textCount = elements.length;
    pages.push({
      pageNumber: pageNum,
      width: Math.round(width * 100) / 100,
      height: Math.round(height * 100) / 100,
      orientation,
      layoutSummary: `${textCount} text block(s)`,
      elements,
    });

    page.cleanup();
  }

  logger.info({ pageCount, pages: pages.length }, "PDF extraction complete");
  return { pageCount, unit: "pt", pages };
}

export function buildFillableJson(doc: DocumentData): Record<string, string> {
  const fillable: Record<string, string> = {};
  for (const page of doc.pages) {
    for (const el of page.elements) {
      if (el.type === "text_block") {
        const key = el.content
          .replace(/\.{3,}/g, "")
          .replace(/[:：]/g, "")
          .trim()
          .replace(/\s+/g, "_")
          .replace(/[^\w\u0600-\u06FF_]/g, "")
          .slice(0, 40);
        if (key && key.length > 1) {
          fillable[key] = "";
        }
      }
    }
  }
  return fillable;
}