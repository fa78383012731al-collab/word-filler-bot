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
    [Markup.button.callback("📋 القوالب المتاحة", "templates:list")],
    [Markup.button.callback("📜 سجل ملفاتي", "history:list")],
  ];
  if (isAdminUser) {
    rows.push([Markup.button.callback("⚙️ لوحة الإدارة", "admin:panel")]);
  }
  return Markup.inlineKeyboard(rows);
}

export function createBot(): Telegraf {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");

  const bot = new Telegraf(token);

  bot.start(async (ctx) => {
    const userId = ctx.from!.id;
    const name = ctx.from?.first_name || "مستخدم";
    await upsertSession(userId, { state: "idle", templateId: null, collectedData: {}, currentFieldIndex: 0 });

    const driveOk = await isGoogleAuthorized();
    const admin = isAdmin(userId);

    await ctx.reply(
      `👋 أهلاً ${name}!\n` +
      `─────────────────\n` +
      `☁️ Google Drive: ${driveOk ? "✅ متصل" : "❌ غير متصل"}\n` +
      `📄 بوت تعبئة مستندات Word\n` +
      `─────────────────\n` +
      `اختر من القائمة:`,
      mainMenuKeyboard(admin)
    );
  });

  bot.command("menu", async (ctx) => {
    const userId = ctx.from!.id;
    await upsertSession(userId, { state: "idle" });
    await ctx.reply("🏠 القائمة الرئيسية:", mainMenuKeyboard(isAdmin(userId)));
  });

  bot.command("cancel", async (ctx) => {
    const userId = ctx.from!.id;
    await upsertSession(userId, { state: "idle", templateId: null, collectedData: {}, currentFieldIndex: 0 });
    await ctx.reply("↩️ تم الإلغاء.", mainMenuKeyboard(isAdmin(userId)));
  });

  bot.action("templates:list", async (ctx) => {
    await ctx.answerCbQuery();
    const allTemplates = await getAllTemplates();
    if (allTemplates.length === 0) {
      await ctx.reply("📭 لا توجد قوالب متاحة بعد.\nتواصل مع المدير لإضافة قوالب.", mainMenuKeyboard(isAdmin(ctx.from!.id)));
      return;
    }
    const rows = allTemplates.map((t) =>
      [Markup.button.callback(`📄 ${t.name}`, `template:select:${t.id}`)]
    );
    rows.push([Markup.button.callback("🏠 الرئيسية", "menu:main")]);
    await ctx.reply("📋 القوالب المتاحة:\nاختر القالب الذي تريد تعبئته:", Markup.inlineKeyboard(rows));
  });

  bot.action(/^template:select:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from!.id;
    const templateId = parseInt(ctx.match[1]);
    const template = await getTemplate(templateId);
    if (!template) {
      await ctx.reply("⚠️ القالب غير موجود.");
      return;
    }

    const authorized = await isGoogleAuthorized();
    if (!authorized) {
      await ctx.reply(
        `⚠️ Google Drive غير متصل.\n\n🔗 افتح الرابط لربط الحساب:\n${getAuthLink()}`
      );
      return;
    }

    const fields = template.fields as Array<{ key: string; label: string; required: boolean }>;
    if (fields.length === 0) {
      await ctx.reply("⚠️ هذا القالب ليس له حقول.");
      return;
    }

    await upsertSession(userId, {
      state: "filling",
      templateId,
      collectedData: {},
      currentFieldIndex: 0,
    });

    await ctx.reply(
      `📄 ${template.name}\n` +
      `─────────────────\n` +
      `${template.description ? template.description + "\n─────────────────\n" : ""}` +
      `عدد الحقول: ${fields.length}\n\n` +
      `✏️ الحقل 1/${fields.length}: ${fields[0].label}\n` +
      `أرسل القيمة الآن:`
    );
  });

  bot.action("history:list", async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from!.id;
    const history = await getUserHistory(userId);
    if (history.length === 0) {
      await ctx.reply("📭 لم تقم بتعبئة أي مستند بعد.", mainMenuKeyboard(isAdmin(userId)));
      return;
    }
    let text = "📜 آخر 10 مستندات معبأة:\n─────────────────\n";
    for (const doc of history) {
      const template = await getTemplate(doc.templateId);
      const date = new Date(doc.createdAt).toLocaleDateString("ar-SA");
      text += `📄 ${template?.name || "قالب محذوف"} — ${date}\n`;
      if (doc.driveLink) text += `🔗 ${doc.driveLink}\n`;
      text += "\n";
    }
    await ctx.reply(text, mainMenuKeyboard(isAdmin(userId)));
  });

  bot.action("menu:main", async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from!.id;
    await upsertSession(userId, { state: "idle" });
    await ctx.reply("🏠 القائمة الرئيسية:", mainMenuKeyboard(isAdmin(userId)));
  });

  bot.action("admin:panel", async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from!.id;
    if (!isAdmin(userId)) { await ctx.reply("⛔ غير مصرح."); return; }

    const allTemplates = await getAllTemplates();
    await ctx.reply(
      `⚙️ لوحة الإدارة\n─────────────────\n📋 القوالب: ${allTemplates.length}`,
      Markup.inlineKeyboard([
        [Markup.button.callback("➕ إضافة قالب", "admin:add_template")],
        [Markup.button.callback("🗑 حذف قالب", "admin:delete_template")],
        [Markup.button.callback("🏠 الرئيسية", "menu:main")],
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
      `➕ إضافة قالب جديد\n─────────────────\n` +
      `1️⃣ أرسل اسم القالب:`
    );
  });

  bot.action("admin:delete_template", async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from!.id;
    if (!isAdmin(userId)) return;

    const allTemplates = await getAllTemplates();
    if (allTemplates.length === 0) {
      await ctx.reply("📭 لا توجد قوالب لحذفها.");
      return;
    }

    const rows = allTemplates.map((t) =>
      [Markup.button.callback(`🗑 ${t.name}`, `admin:delete:${t.id}`)]
    );
    rows.push([Markup.button.callback("↩️ رجوع", "admin:panel")]);
    await ctx.reply("اختر القالب الذي تريد حذفه:", Markup.inlineKeyboard(rows));
  });

  bot.action(/^admin:delete:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from!.id;
    if (!isAdmin(userId)) return;
    const templateId = parseInt(ctx.match[1]);
    await deleteTemplate(templateId);
    await ctx.reply("✅ تم حذف القالب.", Markup.inlineKeyboard([
      [Markup.button.callback("↩️ لوحة الإدارة", "admin:panel")],
    ]));
  });

  bot.action("admin:save_template", async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from!.id;
    if (!isAdmin(userId)) return;

    const session = await getSession(userId);
    if (!session || !session.tempTemplateName) {
      await ctx.reply("⚠️ لم يتم رفع ملف القالب بعد.");
      return;
    }

    await upsertSession(userId, { adminState: "waiting_template_file" });
    await ctx.reply("📎 الآن أرسل ملف Word (.docx) كمرفق:");
  });

  bot.action("admin:add_field", async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from!.id;
    if (!isAdmin(userId)) return;
    await upsertSession(userId, { adminState: "waiting_field_label" });
    await ctx.reply("✏️ أرسل تسمية الحقل (مثال: اسم الطالب):");
  });

  bot.action("admin:done_fields", async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from!.id;
    if (!isAdmin(userId)) return;

    const session = await getSession(userId);
    const fields = session?.tempTemplateFields || [];
    if (fields.length === 0) {
      await ctx.reply("⚠️ يجب إضافة حقل واحد على الأقل.");
      return;
    }

    await upsertSession(userId, { adminState: "waiting_template_file" });
    await ctx.reply(
      `✅ الحقول المضافة (${fields.length}):\n` +
      fields.map((f, i) => `${i + 1}. ${f.label} → {${f.key}}`).join("\n") +
      `\n\n📎 الآن أرسل ملف Word (.docx) كمرفق:\n` +
      `⚠️ تأكد أن الملف يحتوي على المتغيرات بين أقواس مثل:\n` +
      fields.map(f => `{${f.key}}`).join("  ")
    );
  });

  bot.on("document", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    const session = await getSession(userId);
    const doc = ctx.message.document;
    const fileName = doc.file_name || "";

    // PDF coordinate extraction handler
    if (fileName.toLowerCase().endsWith(".pdf")) {
      await ctx.reply("⏳ جاري تحليل ملف PDF واستخراج الإحداثيات...");
      try {
        const fileLink = await ctx.telegram.getFileLink(doc.file_id);
        const res = await axios.get(fileLink.href, { responseType: "arraybuffer" });
        const buffer = Buffer.from(res.data);

        const extracted = await extractPdfCoordinates(buffer);
        const fillableJson = buildFillableJson(extracted);

        const totalTextBlocks = extracted.pages.reduce(
          (sum, p) => sum + p.elements.filter((e) => e.type === "text_block").length, 0
        );

        // Send full coordinates JSON
        const coordBuffer = Buffer.from(JSON.stringify(extracted, null, 2), "utf-8");
        await ctx.replyWithDocument(
          { source: coordBuffer, filename: fileName.replace(".pdf", "") + "_coordinates.json" },
          {
            caption:
              "📐 إحداثيات عناصر الملف\n─────────────────\n" +
              "📄 الصفحات: " + extracted.pageCount + "\n" +
              "📝 النصوص المكتشفة: " + totalTextBlocks,
          }
        );
        );

        // Send fillable JSON template
        const fillBuffer = Buffer.from(JSON.stringify(fillableJson, null, 2), "utf-8");
        await ctx.replyWithDocument(
          { source: fillBuffer, filename: fileName.replace(".pdf", "") + "_fill_template.json" },
          {
            caption:
              "📋 قالب التعبئة\n─────────────────\n" +
              "عبئ القيم الفارغة في هذا الملف\n" +
              "ثم أرسله لاحقا لتطبيق التعبئة على الـ PDF",
          }
        );
      } catch (err: any) {
        logger.error({ err }, "PDF extraction error");
        await ctx.reply("❌ حدث خطأ أثناء تحليل PDF. تأكد أن الملف غير محمي بكلمة سر.");
      }
      return;
    }

    if (session?.state === "admin" && session.adminState === "waiting_template_file" && isAdmin(userId)) {
      if (!fileName.endsWith(".docx")) {
        await ctx.reply("⚠️ يجب أن يكون الملف بصيغة .docx فقط.");
        return;
      }

      await ctx.reply("⏳ جاري معالجة القالب...");

      try {
        const fileLink = await ctx.telegram.getFileLink(doc.file_id);
        const res = await axios.get(fileLink.href, { responseType: "arraybuffer" });
        const buffer = Buffer.from(res.data);

        const fields = session.tempTemplateFields || [];

        const uploaded = await uploadFile(
          `قالب_${session.tempTemplateName}.docx`,
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          buffer
        );

        await createTemplate({
          name: session.tempTemplateName || "قالب جديد",
          description: `حقول: ${fields.map(f => f.label).join("، ")}`,
          driveFileId: uploaded.id,
          fields,
          createdBy: userId,
        });

        await upsertSession(userId, { state: "idle", adminState: "" });
        await ctx.reply(
          `✅ تم حفظ القالب بنجاح!\n` +
          `📄 الاسم: ${session.tempTemplateName}\n` +
          `📋 الحقول: ${fields.length}\n` +
          `☁️ رُفع إلى Drive`,
          mainMenuKeyboard(true)
        );
      } catch (err) {
        logger.error(err, "Error saving template");
        await ctx.reply("❌ حدث خطأ أثناء حفظ القالب. يرجى المحاولة مجدداً.");
      }
      return;
    }

    await ctx.reply("💡 اختر قالباً من القائمة أولاً.", mainMenuKeyboard(isAdmin(userId)));
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

    await ctx.reply("💡 اختر من القائمة:", mainMenuKeyboard(isAdmin(userId)));
  });

  async function handleAdminText(ctx: Context, userId: number, text: string, session: any) {
    const adminState = session.adminState || "";

    if (adminState === "waiting_template_name") {
      await upsertSession(userId, {
        tempTemplateName: text,
        adminState: "waiting_template_description",
      });
      await ctx.reply(
        `✅ اسم القالب: ${text}\n\n2️⃣ أرسل وصفاً مختصراً للقالب (أو أرسل - للتخطي):`
      );
      return;
    }

    if (adminState === "waiting_template_description") {
      await upsertSession(userId, { adminState: "adding_fields" });
      await ctx.reply(
        `3️⃣ أضف الحقول التي يحتاجها القالب:\n` +
        `(مثال: {اسم_الطالب} → أرسل "اسم الطالب")\n\n`,
        Markup.inlineKeyboard([
          [Markup.button.callback("➕ إضافة حقل", "admin:add_field")],
          [Markup.button.callback("✅ انتهيت من الحقول", "admin:done_fields")],
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
        `✅ تمت إضافة الحقل:\n${label} → {${key}}\n\nإجمالي الحقول: ${newFields.length}`,
        Markup.inlineKeyboard([
          [Markup.button.callback("➕ إضافة حقل آخر", "admin:add_field")],
          [Markup.button.callback("✅ انتهيت", "admin:done_fields")],
        ])
      );
      return;
    }
  }

  async function handleFillingText(ctx: Context, userId: number, text: string, session: any) {
    const template = await getTemplate(session.templateId!);
    if (!template) {
      await ctx.reply("⚠️ القالب غير موجود.");
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
        `✅ تم حفظ: ${text}\n\n` +
        `✏️ الحقل ${nextIndex + 1}/${fields.length}: ${fields[nextIndex].label}\n` +
        `أرسل القيمة الآن:`
      );
    } else {
      await upsertSession(userId, { state: "idle", collectedData: {}, currentFieldIndex: 0 });
      await ctx.reply("⏳ جاري تعبئة المستند ورفعه إلى Drive...");

      try {
        const templateBuffer = await downloadFile(template.driveFileId);
        const filledBuffer = fillTemplate(templateBuffer, collectedData);

        const fileName = `${template.name}_${Date.now()}.docx`;
        const uploaded = await uploadFile(
          fileName,
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
          { source: filledBuffer, filename: fileName },
          {
            caption:
              `✅ تم تعبئة المستند بنجاح!\n` +
              `📄 ${template.name}\n` +
              `─────────────────\n` +
              Object.entries(collectedData).map(([k, v]) => `• ${k}: ${v}`).join("\n") +
              `\n─────────────────\n` +
              `☁️ رابط Drive:\n${uploaded.link}`,
          }
        );

        await ctx.reply("✅ تم! ماذا تريد الآن؟", mainMenuKeyboard(isAdmin(userId)));
      } catch (err) {
        logger.error(err, "Error filling/uploading document");
        await ctx.reply("❌ حدث خطأ أثناء التعبئة. يرجى المحاولة مجدداً.", mainMenuKeyboard(isAdmin(userId)));
      }
    }
  }

  bot.catch((err: any, ctx) => {
    logger.error({ err }, "Bot error");
    if (ctx.chat) {
      ctx.reply("⚠️ حدث خطأ. أرسل /cancel وحاول مجدداً.").catch(() => {});
    }
  });

  return bot;
}
