import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import { logger } from "../lib/logger";

export function fillTemplate(
  templateBuffer: Buffer,
  data: Record<string, string>
): Buffer {
  try {
    const zip = new PizZip(templateBuffer);
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      delimiters: { start: "{", end: "}" },
    });

    doc.render(data);

    const output = doc.getZip().generate({
      type: "nodebuffer",
      compression: "DEFLATE",
    });

    logger.info({ fields: Object.keys(data) }, "Template filled successfully");
    return output;
  } catch (err: any) {
    logger.error({ err }, "Error filling template");
    if (err.properties?.errors) {
      const details = err.properties.errors
        .map((e: any) => e.properties?.explanation || e.message)
        .join(", ");
      throw new Error(`خطأ في القالب: ${details}`);
    }
    throw err;
  }
}

export function extractPlaceholders(templateBuffer: Buffer): string[] {
  try {
    const zip = new PizZip(templateBuffer);
    const doc = new Docxtemplater(zip, {
      delimiters: { start: "{", end: "}" },
    });
    const tags = doc.getFullText();
    const matches = tags.match(/\{([^}]+)\}/g) || [];
    const unique = [...new Set(matches.map((m) => m.slice(1, -1).trim()))];
    return unique;
  } catch {
    return [];
  }
}
