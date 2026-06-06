import { Telegraf, Markup, Context } from "telegraf";
import axios from "axios";
import { logger } from "../lib/logger";
import { fillTemplate } from "./filler";
import { uploadFile, downloadFile, createFolder } from "./drive";
import { isGoogleAuthorized } from "./oauth";
import {
  getSession, upsertSession, getAllTemplates, getTemplate,
  createTemplate, deleteTemplate, saveFilledDocument, getUserHistory,
} from "./storage";
import { extractPdfCoordinates, buildFillableJson } from "../lib/pdf-extractor";

const ADMIN_ID = Number(process.env.ADMIN_USER_ID || "0");

function getAuthLink(): string {
  const base = process.env.RENDER_EXTERNAL_URL ||
    (process.env.REPLIT_DOMAINS ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}` : null);
  return base ? `${base}/api/auth/google` : "/api/auth/google";
}

function isAdmin(userId: number) {
  return userId === ADMIN_ID;
}

function mainMenuKeyboard(isAdminUser: boolean) {
  const rows = [
    [Markup.button.callback("\u{1F4CB} \u0627\u0644\u0642\u0648\u0627\u0644\u0628 \u0627\u0644\u0645\u062A\u0627\u062D\u0629", "templates:list")],
    [Markup.button.callback("\u{1F4DC} \u0633\u062C\u0644 \u0645\u0644\u0641\u0627\u062A\u064A", "history:list")],
  ];
  if (isAdminUser) {
    rows.push([Markup.button.callback("\u2699\uFE0F \u0644\u0648\u062D\u0629 \u0627\u0644\u0625\u062F\u0627\u0631\u0629", "admin:panel")]);
  }
  return Markup.inlineKeyboard(rows);
}

export function createBot(): Telegraf {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");

  const bot = new Telegraf(token);

  bot.start(async (ctx) => {
    const userId = ctx.from!.id;
    const name = ctx.from?.first_name || "\u0645\u0633\u062A\u062E\u062F\u0645";
    await upsertSession(userId, { state: "idle", templateId: null, collectedData: {}, currentFieldIndex: 0 });

    const driveOk = await isGoogleAuthorized();
    const admin = isAdmin(userId);

    await ctx.reply(
      "\u{1F44B} \u0623\u0647\u0644\u0627\u064B " + name + "!\n" +
      "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n" +
      "\u2601\uFE0F Google Drive: " + (driveOk ? "\u2705 \u0645\u062A\u0635\u0644" : "\u274C \u063A\u064A\u0631 \u0645\u062A\u0635\u0644") + "\n" +
      "\u{1F4C4} \u0628\u0648\u062A \u062A\u0639\u0628\u0626\u0629 \u0645\u0633\u062A\u0646\u062F\u0627\u062A Word\n" +
      "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n" +
      "\u0627\u062E\u062A\u0631 \u0645\u0646 \u0627\u0644\u0642\u0627\u0626\u0645\u0629:",
      mainMenuKeyboard(admin)
    );
  });

  bot.command("menu", async (ctx) => {
    const userId = ctx.from!.id;
    await upsertSession(userId, { state: "idle" });
    await ctx.reply("\u{1F3E0} \u0627\u0644\u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629:", mainMenuKeyboard(isAdmin(userId)));
  });

  bot.command("cancel", async (ctx) => {
    const userId = ctx.from!.id;
    await upsertSession(userId, { state: "idle", templateId: null, collectedData: {}, currentFieldIndex: 0 });
    await ctx.reply("\u21A9\uFE0F \u062A\u0645 \u0627\u0644\u0625\u0644\u063A\u0627\u0621.", mainMenuKeyboard(isAdmin(userId)));
  });

  bot.action("templates:list", async (ctx) => {
    await ctx.answerCbQuery();
    const allTemplates = await getAllTemplates();
    if (allTemplates.length === 0) {
      await ctx.reply(
        "\u{1F4ED} \u0644\u0627 \u062A\u0648\u062C\u062F \u0642\u0648\u0627\u0644\u0628 \u0645\u062A\u0627\u062D\u0629 \u0628\u0639\u062F.\n\u062A\u0648\u0627\u0635\u0644 \u0645\u0639 \u0627\u0644\u0645\u062F\u064A\u0631 \u0644\u0625\u0636\u0627\u0641\u0629 \u0642\u0648\u0627\u0644\u0628.",
        mainMenuKeyboard(isAdmin(ctx.from!.id))
      );
      return;
    }
    const rows = allTemplates.map((t) =>
      [Markup.button.callback("\u{1F4C4} " + t.name, "template:select:" + t.id)]
    );
    rows.push([Markup.button.callback("\u{1F3E0} \u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629", "menu:main")]);
    await ctx.reply(
      "\u{1F4CB} \u0627\u0644\u0642\u0648\u0627\u0644\u0628 \u0627\u0644\u0645\u062A\u0627\u062D\u0629:\n\u0627\u062E\u062A\u0631 \u0627\u0644\u0642\u0627\u0644\u0628 \u0627\u0644\u0630\u064A \u062A\u0631\u064A\u062F \u062A\u0639\u0628\u0626\u062A\u0647:",
      Markup.inlineKeyboard(rows)
    );
  });

  bot.action(/^template:select:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from!.id;
    const templateId = parseInt(ctx.match[1]);
    const template = await getTemplate(templateId);
    if (!template) {
      await ctx.reply("\u26A0\uFE0F \u0627\u0644\u0642\u0627\u0644\u0628 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F.");
      return;
    }

    const authorized = await isGoogleAuthorized();
    if (!authorized) {
      await ctx.reply(
        "\u26A0\uFE0F Google Drive \u063A\u064A\u0631 \u0645\u062A\u0635\u0644.\n\n\u{1F517} \u0627\u0641\u062A\u062D \u0627\u0644\u0631\u0627\u0628\u0637 \u0644\u0631\u0628\u0637 \u0627\u0644\u062D\u0633\u0627\u0628:\n" + getAuthLink()
      );
      return;
    }

    const fields = template.fields as Array<{ key: string; label: string; required: boolean }>;
    if (fields.length === 0) {
      await ctx.reply("\u26A0\uFE0F \u0647\u0630\u0627 \u0627\u0644\u0642\u0627\u0644\u0628 \u0644\u064A\u0633 \u0644\u0647 \u062D\u0642\u0648\u0644.");
      return;
    }

    await upsertSession(userId, {
      state: "filling",
      templateId,
      collectedData: {},
      currentFieldIndex: 0,
    });

    await ctx.reply(
      "\u{1F4C4} " + template.name + "\n" +
      "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n" +
      (template.description ? template.description + "\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n" : "") +
      "\u0639\u062F\u062F \u0627\u0644\u062D\u0642\u0648\u0644: " + fields.length + "\n\n" +
      "\u270F\uFE0F \u0627\u0644\u062D\u0642\u0644 1/" + fields.length + ": " + fields[0].label + "\n" +
      "\u0623\u0631\u0633\u0644 \u0627\u0644\u0642\u064A\u0645\u0629 \u0627\u0644\u0622\u0646:"
    );
  });

  bot.action("history:list", async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from!.id;
    const history = await getUserHistory(userId);
    if (history.length === 0) {
      await ctx.reply(
        "\u{1F4ED} \u0644\u0645 \u062A\u0642\u0645 \u0628\u062A\u0639\u0628\u0626\u0629 \u0623\u064A \u0645\u0633\u062A\u0646\u062F \u0628\u0639\u062F.",
        mainMenuKeyboard(isAdmin(userId))
      );
      return;
    }
    let text = "\u{1F4DC} \u0622\u062E\u0631 10 \u0645\u0633\u062A\u0646\u062F\u0627\u062A \u0645\u0639\u0628\u0623\u0629:\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n";
    for (const doc of history) {
      const template = await getTemplate(doc.templateId);
      const date = new Date(doc.createdAt).toLocaleDateString("ar-SA");
      text += "\u{1F4C4} " + (template?.name || "\u0642\u0627\u0644\u0628 \u0645\u062D\u0630\u0648\u0641") + " \u2014 " + date + "\n";
      if (doc.driveLink) text += "\u{1F517} " + doc.driveLink + "\n";
      text += "\n";
    }
    await ctx.reply(text, mainMenuKeyboard(isAdmin(userId)));
  });

  bot.action("menu:main", async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from!.id;
    await upsertSession(userId, { state: "idle" });
    await ctx.reply("\u{1F3E0} \u0627\u0644\u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629:", mainMenuKeyboard(isAdmin(userId)));
  });

  bot.action("admin:panel", async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from!.id;
    if (!isAdmin(userId)) { await ctx.reply("\u26D4 \u063A\u064A\u0631 \u0645\u0635\u0631\u062D."); return; }

    const allTemplates = await getAllTemplates();
    await ctx.reply(
      "\u2699\uFE0F \u0644\u0648\u062D\u0629 \u0627\u0644\u0625\u062F\u0627\u0631\u0629\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\u{1F4CB} \u0627\u0644\u0642\u0648\u0627\u0644\u0628: " + allTemplates.length,
      Markup.inlineKeyboard([
        [Markup.button.callback("\u2795 \u0625\u0636\u0627\u0641\u0629 \u0642\u0627\u0644\u0628", "admin:add_template")],
        [Markup.button.callback("\u{1F5D1} \u062D\u0630\u0641 \u0642\u0627\u0644\u0628", "admin:delete_template")],
        [Markup.button.callback("\u{1F3E0} \u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629", "menu:main")],
      ])
    );
  });

  bot.action("admin:add_template", async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from!.id;
    if (!isAdmin(userId)) return;

    await upsertSession(userId, {
      state: "admin",
      adminState: "waiting_template_name",
      tempTemplateName: "",
      tempTemplateFields: [],
    });

    await ctx.reply(
      "\u2795 \u0625\u0636\u0627\u0641\u0629 \u0642\u0627\u0644\u0628 \u062C\u062F\u064A\u062F\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n1\uFE0F\u20E3 \u0623\u0631\u0633\u0644 \u0627\u0633\u0645 \u0627\u0644\u0642\u0627\u0644\u0628:"
    );
  });

  bot.action("admin:delete_template", async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from!.id;
    if (!isAdmin(userId)) return;

    const allTemplates = await getAllTemplates();
    if (allTemplates.length === 0) {
      await ctx.reply("\u{1F4ED} \u0644\u0627 \u062A\u0648\u062C\u062F \u0642\u0648\u0627\u0644\u0628 \u0644\u062D\u0630\u0641\u0647\u0627.");
      return;
    }

    const rows = allTemplates.map((t) =>
      [Markup.button.callback("\u{1F5D1} " + t.name, "admin:delete:" + t.id)]
    );
    rows.push([Markup.button.callback("\u21A9\uFE0F \u0631\u062C\u0648\u0639", "admin:panel")]);
    await ctx.reply("\u0627\u062E\u062A\u0631 \u0627\u0644\u0642\u0627\u0644\u0628 \u0627\u0644\u0630\u064A \u062A\u0631\u064A\u062F \u062D\u0630\u0641\u0647:", Markup.inlineKeyboard(rows));
  });

  bot.action(/^admin:delete:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from!.id;
    if (!isAdmin(userId)) return;
    const templateId = parseInt(ctx.match[1]);
    await deleteTemplate(templateId);
    await ctx.reply("\u2705 \u062A\u0645 \u062D\u0630\u0641 \u0627\u0644\u0642\u0627\u0644\u0628.", Markup.inlineKeyboard([
      [Markup.button.callback("\u21A9\uFE0F \u0644\u0648\u062D\u0629 \u0627\u0644\u0625\u062F\u0627\u0631\u0629", "admin:panel")],
    ]));
  });

  bot.action("admin:save_template", async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from!.id;
    if (!isAdmin(userId)) return;

    const session = await getSession(userId);
    if (!session || !session.tempTemplateName) {
      await ctx.reply("\u26A0\uFE0F \u0644\u0645 \u064A\u062A\u0645 \u0631\u0641\u0639 \u0645\u0644\u0641 \u0627\u0644\u0642\u0627\u0644\u0628 \u0628\u0639\u062F.");
      return;
    }

    await upsertSession(userId, { adminState: "waiting_template_file" });
    await ctx.reply("\u{1F4CE} \u0627\u0644\u0622\u0646 \u0623\u0631\u0633\u0644 \u0645\u0644\u0641 Word (.docx) \u0643\u0645\u0631\u0641\u0642:");
  });

  bot.action("admin:add_field", async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from!.id;
    if (!isAdmin(userId)) return;
    await upsertSession(userId, { adminState: "waiting_field_label" });
    await ctx.reply("\u270F\uFE0F \u0623\u0631\u0633\u0644 \u062A\u0633\u0645\u064A\u0629 \u0627\u0644\u062D\u0642\u0644 (\u0645\u062B\u0627\u0644: \u0627\u0633\u0645 \u0627\u0644\u0637\u0627\u0644\u0628):");
  });

  bot.action("admin:done_fields", async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from!.id;
    if (!isAdmin(userId)) return;

    const session = await getSession(userId);
    const fields = session?.tempTemplateFields || [];
    if (fields.length === 0) {
      await ctx.reply("\u26A0\uFE0F \u064A\u062C\u0628 \u0625\u0636\u0627\u0641\u0629 \u062D\u0642\u0644 \u0648\u0627\u062D\u062F \u0639\u0644\u0649 \u0627\u0644\u0623\u0642\u0644.");
      return;
    }

    await upsertSession(userId, { adminState: "waiting_template_file" });
    await ctx.reply(
      "\u2705 \u0627\u0644\u062D\u0642\u0648\u0644 \u0627\u0644\u0645\u0636\u0627\u0641\u0629 (" + fields.length + "):\n" +
      fields.map((f, i) => (i + 1) + ". " + f.label + " \u2192 {" + f.key + "}").join("\n") +
      "\n\n\u{1F4CE} \u0627\u0644\u0622\u0646 \u0623\u0631\u0633\u0644 \u0645\u0644\u0641 Word (.docx) \u0643\u0645\u0631\u0641\u0642:\n" +
      "\u26A0\uFE0F \u062A\u0623\u0643\u062F \u0623\u0646 \u0627\u0644\u0645\u0644\u0641 \u064A\u062D\u062A\u0648\u064A \u0639\u0644\u0649 \u0627\u0644\u0645\u062A\u063A\u064A\u0631\u0627\u062A:\n" +
      fields.map(f => "{" + f.key + "}").join("  ")
    );
  });

  bot.on("document", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    const session = await getSession(userId);
    const doc = ctx.message.document;
    const fileName = doc.file_name || "";

    // PDF coordinate extraction — available to all users
    if (fileName.toLowerCase().endsWith(".pdf")) {
      await ctx.reply("\u23F3 \u062C\u0627\u0631\u064A \u062A\u062D\u0644\u064A\u0644 \u0645\u0644\u0641 PDF \u0648\u0627\u0633\u062A\u062E\u0631\u0627\u062C \u0627\u0644\u0625\u062D\u062F\u0627\u062B\u064A\u0627\u062A...");
      try {
        const fileLink = await ctx.telegram.getFileLink(doc.file_id);
        const res = await axios.get(fileLink.href, { responseType: "arraybuffer" });
        const buffer = Buffer.from(res.data);

        const extracted = await extractPdfCoordinates(buffer);
        const fillableJson = buildFillableJson(extracted);

        const totalTextBlocks = extracted.pages.reduce(
          (sum, p) => sum + p.elements.filter((e) => e.type === "text_block").length, 0
        );

        // Send coordinates JSON
        const coordBuffer = Buffer.from(JSON.stringify(extracted, null, 2), "utf-8");
        await ctx.replyWithDocument(
          { source: coordBuffer, filename: fileName.replace(".pdf", "") + "_coordinates.json" },
          {
            caption:
              "\u{1F4D0} \u0625\u062D\u062F\u0627\u062B\u064A\u0627\u062A \u0639\u0646\u0627\u0635\u0631 \u0627\u0644\u0645\u0644\u0641\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n" +
              "\u{1F4C4} \u0627\u0644\u0635\u0641\u062D\u0627\u062A: " + extracted.pageCount + "\n" +
              "\u{1F4DD} \u0627\u0644\u0646\u0635\u0648\u0635 \u0627\u0644\u0645\u0643\u062A\u0634\u0641\u0629: " + totalTextBlocks,
          }
        );

        // Send fillable JSON template
        const fillBuffer = Buffer.from(JSON.stringify(fillableJson, null, 2), "utf-8");
        await ctx.replyWithDocument(
          { source: fillBuffer, filename: fileName.replace(".pdf", "") + "_fill_template.json" },
          {
            caption:
              "\u{1F4CB} \u0642\u0627\u0644\u0628 \u0627\u0644\u062A\u0639\u0628\u0626\u0629\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n" +
              "\u0639\u0628\u0626 \u0627\u0644\u0642\u064A\u0645 \u0627\u0644\u0641\u0627\u0631\u063A\u0629 \u0641\u064A \u0647\u0630\u0627 \u0627\u0644\u0645\u0644\u0641\n" +
              "\u062B\u0645 \u0623\u0631\u0633\u0644\u0647 \u0644\u0627\u062D\u0642\u0627\u064B \u0644\u062A\u0637\u0628\u064A\u0642 \u0627\u0644\u062A\u0639\u0628\u0626\u0629 \u0639\u0644\u0649 \u0627\u0644\u0640 PDF",
          }
        );
      } catch (err: any) {
        logger.error({ err }, "PDF extraction error");
        await ctx.reply("\u274C \u062D\u062F\u062B \u062E\u0637\u0623 \u0623\u062B\u0646\u0627\u0621 \u062A\u062D\u0644\u064A\u0644 PDF. \u062A\u0623\u0643\u062F \u0623\u0646 \u0627\u0644\u0645\u0644\u0641 \u063A\u064A\u0631 \u0645\u062D\u0645\u064A \u0628\u0643\u0644\u0645\u0629 \u0633\u0631.");
      }
      return;
    }

    if (session?.state === "admin" && session.adminState === "waiting_template_file" && isAdmin(userId)) {
      if (!fileName.endsWith(".docx")) {
        await ctx.reply("\u26A0\uFE0F \u064A\u062C\u0628 \u0623\u0646 \u064A\u0643\u0648\u0646 \u0627\u0644\u0645\u0644\u0641 \u0628\u0635\u064A\u063A\u0629 .docx \u0641\u0642\u0637.");
        return;
      }

      await ctx.reply("\u23F3 \u062C\u0627\u0631\u064A \u0645\u0639\u0627\u0644\u062C\u0629 \u0627\u0644\u0642\u0627\u0644\u0628...");

      try {
        const fileLink = await ctx.telegram.getFileLink(doc.file_id);
        const res = await axios.get(fileLink.href, { responseType: "arraybuffer" });
        const buffer = Buffer.from(res.data);

        const fields = session.tempTemplateFields || [];

        const uploaded = await uploadFile(
          "\u0642\u0627\u0644\u0628_" + session.tempTemplateName + ".docx",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          buffer
        );

        await createTemplate({
          name: session.tempTemplateName || "\u0642\u0627\u0644\u0628 \u062C\u062F\u064A\u062F",
          description: "\u062D\u0642\u0648\u0644: " + fields.map(f => f.label).join(", "),
          driveFileId: uploaded.id,
          fields,
          createdBy: userId,
        });

        await upsertSession(userId, { state: "idle", adminState: "" });
        await ctx.reply(
          "\u2705 \u062A\u0645 \u062D\u0641\u0638 \u0627\u0644\u0642\u0627\u0644\u0628 \u0628\u0646\u062C\u0627\u062D!\n" +
          "\u{1F4C4} \u0627\u0644\u0627\u0633\u0645: " + session.tempTemplateName + "\n" +
          "\u{1F4CB} \u0627\u0644\u062D\u0642\u0648\u0644: " + fields.length + "\n" +
          "\u2601\uFE0F \u0631\u064F\u0641\u0639 \u0625\u0644\u0649 Drive",
          mainMenuKeyboard(true)
        );
      } catch (err) {
        logger.error(err, "Error saving template");
        await ctx.reply("\u274C \u062D\u062F\u062B \u062E\u0637\u0623 \u0623\u062B\u0646\u0627\u0621 \u062D\u0641\u0638 \u0627\u0644\u0642\u0627\u0644\u0628. \u064A\u0631\u062C\u0649 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0645\u062C\u062F\u062F\u0627\u064B.");
      }
      return;
    }

    await ctx.reply("\u{1F4A1} \u0627\u062E\u062A\u0631 \u0642\u0627\u0644\u0628\u0627\u064B \u0645\u0646 \u0627\u0644\u0642\u0627\u0626\u0645\u0629 \u0623\u0648\u0644\u0627\u064B.", mainMenuKeyboard(isAdmin(userId)));
  });

  bot.on("text", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) return;

    const session = await getSession(userId);
    const state = session?.state ?? "idle";

    if (state === "admin" && isAdmin(userId)) {
      await handleAdminText(ctx, userId, text, session);
      return;
    }

    if (state === "filling" && session?.templateId) {
      await handleFillingText(ctx, userId, text, session);
      return;
    }

    await ctx.reply("\u{1F4A1} \u0627\u062E\u062A\u0631 \u0645\u0646 \u0627\u0644\u0642\u0627\u0626\u0645\u0629:", mainMenuKeyboard(isAdmin(userId)));
  });

  async function handleAdminText(ctx: Context, userId: number, text: string, session: any) {
    const adminState = session.adminState || "";

    if (adminState === "waiting_template_name") {
      await upsertSession(userId, {
        tempTemplateName: text,
        adminState: "waiting_template_description",
      });
      await ctx.reply(
        "\u2705 \u0627\u0633\u0645 \u0627\u0644\u0642\u0627\u0644\u0628: " + text + "\n\n2\uFE0F\u20E3 \u0623\u0631\u0633\u0644 \u0648\u0635\u0641\u0627\u064B \u0645\u062E\u062A\u0635\u0631\u0627\u064B \u0644\u0644\u0642\u0627\u0644\u0628 (\u0623\u0648 \u0623\u0631\u0633\u0644 - \u0644\u0644\u062A\u062E\u0637\u064A):"
      );
      return;
    }

    if (adminState === "waiting_template_description") {
      await upsertSession(userId, { adminState: "adding_fields" });
      await ctx.reply(
        "3\uFE0F\u20E3 \u0623\u0636\u0641 \u0627\u0644\u062D\u0642\u0648\u0644 \u0627\u0644\u062A\u064A \u064A\u062D\u062A\u0627\u062C\u0647\u0627 \u0627\u0644\u0642\u0627\u0644\u0628:",
        Markup.inlineKeyboard([
          [Markup.button.callback("\u2795 \u0625\u0636\u0627\u0641\u0629 \u062D\u0642\u0644", "admin:add_field")],
          [Markup.button.callback("\u2705 \u0627\u0646\u062A\u0647\u064A\u062A \u0645\u0646 \u0627\u0644\u062D\u0642\u0648\u0644", "admin:done_fields")],
        ])
      );
      return;
    }

    if (adminState === "waiting_field_label") {
      const label = text;
      const key = text
        .replace(/\s+/g, "_")
        .replace(/[^\w\u0600-\u06FF]/g, "")
        .toLowerCase();

      const currentFields = session.tempTemplateFields || [];
      const newFields = [...currentFields, { key, label, required: true }];
      await upsertSession(userId, {
        tempTemplateFields: newFields,
        adminState: "adding_fields",
      });

      await ctx.reply(
        "\u2705 \u062A\u0645\u062A \u0625\u0636\u0627\u0641\u0629 \u0627\u0644\u062D\u0642\u0644:\n" + label + " \u2192 {" + key + "}\n\n\u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u062D\u0642\u0648\u0644: " + newFields.length,
        Markup.inlineKeyboard([
          [Markup.button.callback("\u2795 \u0625\u0636\u0627\u0641\u0629 \u062D\u0642\u0644 \u0622\u062E\u0631", "admin:add_field")],
          [Markup.button.callback("\u2705 \u0627\u0646\u062A\u0647\u064A\u062A", "admin:done_fields")],
        ])
      );
      return;
    }
  }

  async function handleFillingText(ctx: Context, userId: number, text: string, session: any) {
    const template = await getTemplate(session.templateId!);
    if (!template) {
      await ctx.reply("\u26A0\uFE0F \u0627\u0644\u0642\u0627\u0644\u0628 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F.");
      await upsertSession(userId, { state: "idle" });
      return;
    }

    const fields = template.fields as Array<{ key: string; label: string; required: boolean }>;
    const currentIndex = session.currentFieldIndex || 0;
    const currentField = fields[currentIndex];

    const collectedData = (session.collectedData as Record<string, string>) || {};
    collectedData[currentField.key] = text;

    const nextIndex = currentIndex + 1;

    if (nextIndex < fields.length) {
      await upsertSession(userId, {
        collectedData,
        currentFieldIndex: nextIndex,
      });
      await ctx.reply(
        "\u2705 \u062A\u0645 \u062D\u0641\u0638: " + text + "\n\n" +
        "\u270F\uFE0F \u0627\u0644\u062D\u0642\u0644 " + (nextIndex + 1) + "/" + fields.length + ": " + fields[nextIndex].label + "\n" +
        "\u0623\u0631\u0633\u0644 \u0627\u0644\u0642\u064A\u0645\u0629 \u0627\u0644\u0622\u0646:"
      );
    } else {
      await upsertSession(userId, { state: "idle", collectedData: {}, currentFieldIndex: 0 });
      await ctx.reply("\u23F3 \u062C\u0627\u0631\u064A \u062A\u0639\u0628\u0626\u0629 \u0627\u0644\u0645\u0633\u062A\u0646\u062F \u0648\u0631\u0641\u0639\u0647 \u0625\u0644\u0649 Drive...");

      try {
        const templateBuffer = await downloadFile(template.driveFileId);
        const filledBuffer = fillTemplate(templateBuffer, collectedData);

        const outFileName = template.name + "_" + Date.now() + ".docx";
        const uploaded = await uploadFile(
          outFileName,
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          filledBuffer
        );

        await saveFilledDocument({
          templateId: template.id,
          userId,
          filledData: collectedData,
          driveFileId: uploaded.id,
          driveLink: uploaded.link,
        });

        await ctx.replyWithDocument(
          { source: filledBuffer, filename: outFileName },
          {
            caption:
              "\u2705 \u062A\u0645 \u062A\u0639\u0628\u0626\u0629 \u0627\u0644\u0645\u0633\u062A\u0646\u062F \u0628\u0646\u062C\u0627\u062D!\n" +
              "\u{1F4C4} " + template.name + "\n" +
              "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n" +
              Object.entries(collectedData).map(([k, v]) => "\u2022 " + k + ": " + v).join("\n") +
              "\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n" +
              "\u2601\uFE0F \u0631\u0627\u0628\u0637 Drive:\n" + uploaded.link,
          }
        );

        await ctx.reply("\u2705 \u062A\u0645! \u0645\u0627\u0630\u0627 \u062A\u0631\u064A\u062F \u0627\u0644\u0622\u0646\u061F", mainMenuKeyboard(isAdmin(userId)));
      } catch (err) {
        logger.error(err, "Error filling/uploading document");
        await ctx.reply("\u274C \u062D\u062F\u062B \u062E\u0637\u0623 \u0623\u062B\u0646\u0627\u0621 \u0627\u0644\u062A\u0639\u0628\u0626\u0629. \u064A\u0631\u062C\u0649 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0645\u062C\u062F\u062F\u0627\u064B.", mainMenuKeyboard(isAdmin(userId)));
      }
    }
  }

  bot.catch((err: any, ctx) => {
    logger.error({ err }, "Bot error");
    if (ctx.chat) {
      ctx.reply("\u26A0\uFE0F \u062D\u062F\u062B \u062E\u0637\u0623. \u0623\u0631\u0633\u0644 /cancel \u0648\u062D\u0627\u0648\u0644 \u0645\u062C\u062F\u062F\u0627\u064B.").catch(() => {});
    }
  });

  return bot;
}
