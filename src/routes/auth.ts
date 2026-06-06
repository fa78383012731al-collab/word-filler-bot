import { Router } from "express";
import { getAuthUrl, exchangeCodeForTokens } from "../bot/oauth";

const router = Router();

router.get("/google", (_req, res) => {
  const url = getAuthUrl();
  if (!url) {
    res.status(500).send("Google OAuth not configured");
    return;
  }
  res.redirect(url);
});

router.get("/google/callback", async (req, res) => {
  const code = req.query.code as string;
  if (!code) {
    res.status(400).send("Missing authorization code");
    return;
  }
  const success = await exchangeCodeForTokens(code);
  if (success) {
    res.send(`
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head><meta charset="UTF-8"><title>تم الربط</title>
      <style>body{font-family:Arial;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f0fdf4}
      .box{text-align:center;background:white;padding:40px;border-radius:16px;box-shadow:0 4px 20px rgba(0,0,0,0.1);max-width:400px}
      .icon{font-size:64px;margin-bottom:16px} h1{color:#16a34a;margin:0 0 8px} p{color:#6b7280}
      a{color:#16a34a;text-decoration:none}</style></head>
      <body><div class="box">
        <div class="icon">✅</div>
        <h1>تم الربط بنجاح!</h1>
        <p>تم ربط حساب Google Drive بنجاح.</p>
        <p>يمكنك الآن إغلاق هذه الصفحة والعودة إلى البوت.</p>
        <p>📱 <a href="https://t.me/drive71388_bot">العودة إلى البوت</a></p>
      </div></body></html>
    `);
  } else {
    res.status(500).send("فشل الربط. يرجى المحاولة مجدداً.");
  }
});

export default router;
