import { google } from "googleapis";
import { Readable } from "stream";
import { logger } from "../lib/logger";
import { getAuthorizedClient } from "./oauth";

async function getDriveClient() {
  const client = await getAuthorizedClient();
  if (!client) return null;
  return google.drive({ version: "v3", auth: client });
}

export async function createFolder(name: string, parentId?: string): Promise<{ id: string; link: string }> {
  const drive = await getDriveClient();
  if (!drive) throw new Error("Google account not connected");

  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      ...(parentId ? { parents: [parentId] } : {}),
    },
    fields: "id, webViewLink",
  });

  const folderId = res.data.id!;
  await drive.permissions.create({
    fileId: folderId,
    requestBody: { role: "reader", type: "anyone" },
  });

  logger.info({ folderId, name }, "Created Drive folder");
  return { id: folderId, link: res.data.webViewLink! };
}

export async function uploadFile(
  fileName: string,
  mimeType: string,
  buffer: Buffer,
  parentId?: string
): Promise<{ id: string; link: string }> {
  const drive = await getDriveClient();
  if (!drive) throw new Error("Google account not connected");

  const stream = Readable.from(buffer);
  const res = await drive.files.create({
    requestBody: {
      name: fileName,
      ...(parentId ? { parents: [parentId] } : {}),
    },
    media: { mimeType, body: stream },
    fields: "id, webViewLink",
  });

  const fileId = res.data.id!;
  await drive.permissions.create({
    fileId,
    requestBody: { role: "reader", type: "anyone" },
  });

  logger.info({ fileId, fileName }, "Uploaded file to Drive");
  return { id: fileId, link: res.data.webViewLink! };
}

export async function downloadFile(fileId: string): Promise<Buffer> {
  const drive = await getDriveClient();
  if (!drive) throw new Error("Google account not connected");

  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" }
  );

  return Buffer.from(res.data as ArrayBuffer);
}
