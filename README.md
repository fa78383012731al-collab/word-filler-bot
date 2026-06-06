# 📄 Word Filler Bot — @drive71388_bot

بوت تيليغرام لتعبئة قوالب Word تلقائياً ورفعها إلى Google Drive.

## كيف يعمل

1. **المدير** يرفع قالب Word يحتوي على متغيرات مثل `{اسم_الطالب}`
2. **المستخدم** يختار القالب من القائمة
3. **البوت** يطلب قيمة كل حقل
4. **البوت** يعبئ القالب ويرسله + يرفعه على Drive

## متطلبات القالب

في ملف Word، ضع المتغيرات بين أقواس:
```
{اسم_الطالب}  {الدرجة}  {التاريخ}
```

## إعداد Render

### متغيرات البيئة:
| المتغير | القيمة |
|---|---|
| `TELEGRAM_BOT_TOKEN` | توكن البوت من BotFather |
| `GOOGLE_CLIENT_ID` | من Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | من Google Cloud Console |
| `DATABASE_URL` | رابط Supabase PostgreSQL |
| `SESSION_SECRET` | أي نص عشوائي |
| `ADMIN_USER_ID` | رقم Telegram ID الخاص بك |
| `PORT` | 8080 |

## إعداد Google Cloud
1. فعّل **Google Drive API**
2. أنشئ **OAuth 2.0 Client ID** من نوع Web
3. أضف Redirect URI:
   ```
   https://YOUR-APP.onrender.com/api/auth/google/callback
   ```

## إعداد قاعدة البيانات (Supabase)
شغّل ملف `setup.sql` في SQL Editor

## ربط Google Drive
افتح: `https://YOUR-APP.onrender.com/api/auth/google`

## UptimeRobot
أضف مراقبة على: `https://YOUR-APP.onrender.com/api/healthz`
