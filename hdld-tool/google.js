'use strict';
/**
 * hdld-tool/google.js — Sinh tài liệu trên Google Docs bằng SERVICE ACCOUNT.
 *
 * Luồng:
 *   copyTemplate(srcDocId, name) → tạo bản sao doc (drive.files.copy)
 *   replacePlaceholders(docId, map) → docs.batchUpdate replaceAllText {{Bxxx}} → value
 *   docUrl(docId) → link mở doc
 *
 * YÊU CẦU service account (GOOGLE_SA_KEY):
 *   - được share Editor các Google Doc template (để copy)
 *   - được share Editor thư mục đích GOOGLE_DEST_FOLDER_ID (nên là Shared Drive,
 *     vì SA thường KHÔNG có quota lưu trong My Drive cá nhân).
 */
const { google } = require('googleapis');
const { Readable } = require('stream');

const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/documents',
];

let _clients = null;
function clients() {
  if (_clients) return _clients;
  const keyFile = process.env.GOOGLE_SA_KEY;
  if (!keyFile) throw new Error('Thiếu GOOGLE_SA_KEY (đường dẫn service account .json)');
  const auth = new google.auth.GoogleAuth({ keyFile, scopes: SCOPES });
  _clients = {
    drive: google.drive({ version: 'v3', auth }),
    docs:  google.docs({ version: 'v1', auth }),
  };
  return _clients;
}

// Copy doc template → bản mới (tên = name), đặt trong DEST_FOLDER nếu có.
// LUÔN ép mimeType = Google Doc: template native giữ nguyên; template .docx được CONVERT
// sang Google Doc (nếu không, bản copy vẫn là .docx và Docs API replaceAllText sẽ lỗi).
async function copyTemplate(srcDocId, name) {
  const { drive } = clients();
  const dest = process.env.GOOGLE_DEST_FOLDER_ID || '';
  const requestBody = { name, mimeType: 'application/vnd.google-apps.document' };
  if (dest) requestBody.parents = [dest];
  const res = await drive.files.copy({
    fileId: srcDocId,
    requestBody,
    supportsAllDrives: true,
    fields: 'id, name, webViewLink',
  });
  return res.data;   // {id, name, webViewLink}
}

// Replace tất cả placeholder. map = { "{{B001}}": "Nguyễn Văn A", ... }
// Trả về số lần thay được (theo Google trả về) để đối chiếu.
async function replacePlaceholders(docId, map) {
  const { docs } = clients();
  const requests = Object.entries(map).map(([find, replace]) => ({
    replaceAllText: {
      containsText: { text: find, matchCase: true },
      replaceText: replace == null ? '' : String(replace),
    },
  }));
  if (!requests.length) return { replies: [] };
  const res = await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: { requests },
  });
  return res.data;
}

// Xuất doc → PDF rồi upload PDF vào DEST_FOLDER. Trả {id, webViewLink}.
async function exportPdf(docId, name) {
  const { drive } = clients();
  const exp = await drive.files.export(
    { fileId: docId, mimeType: 'application/pdf' },
    { responseType: 'arraybuffer' },
  );
  const buf = Buffer.from(exp.data);
  const dest = process.env.GOOGLE_DEST_FOLDER_ID || '';
  const requestBody = { name: `${name}.pdf`, mimeType: 'application/pdf' };
  if (dest) requestBody.parents = [dest];
  const res = await drive.files.create({
    requestBody,
    media: { mimeType: 'application/pdf', body: Readable.from(buf) },
    supportsAllDrives: true,
    fields: 'id, name, webViewLink',
  });
  return res.data;   // {id, name, webViewLink}
}

function docUrl(docId) {
  return `https://docs.google.com/document/d/${docId}/edit`;
}

module.exports = { copyTemplate, replacePlaceholders, exportPdf, docUrl };
