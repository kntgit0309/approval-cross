'use strict';
/**
 * Dựng interactive card thông báo trạng thái (plan §8).
 * Xanh = duyệt, đỏ = từ chối. Có nút "Xem chi tiết" deep-link về record Base / trang H5.
 * Theme tái dùng đúng convention Phase 1 (dxc-approval/server.js STATUS_THEME).
 */
const STATUS_THEME = {
  APPROVED:   { template: 'green',  icon: '✅', title: 'đã được duyệt' },
  REJECTED:   { template: 'red',    icon: '❌', title: 'đã bị từ chối' },
  CANCELED:   { template: 'grey',   icon: '🚫', title: 'đã bị hủy' },
  DELETED:    { template: 'grey',   icon: '🚫', title: 'đã bị xóa' },
  TERMINATED: { template: 'grey',   icon: '🛑', title: 'đã kết thúc' },
  REVERTED:   { template: 'orange', icon: '↩️', title: 'đã bị trả về' },
};

function nowStampICT(now = new Date()) {
  const t = new Date(now.getTime() + 7 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(t.getUTCHours())}:${p(t.getUTCMinutes())} ${p(t.getUTCDate())}/${p(t.getUTCMonth() + 1)}/${t.getUTCFullYear()}`;
}

/**
 * data: { title, type, requester, dept, amount, content, fields:[{label,value}], detailUrl }
 * status: APPROVED | REJECTED | CANCELED | DELETED | TERMINATED | REVERTED
 */
function buildStatusCard(status, data = {}, now = new Date()) {
  const theme = STATUS_THEME[status] || { template: 'grey', icon: 'ℹ️', title: `status=${status}` };
  const headTitle = `${theme.icon} ${data.type || 'Đơn'} ${theme.title}${data.title ? ` — ${data.title}` : ''}`;

  const rows = [];
  if (data.requester) rows.push(`**Người đề xuất:** ${data.requester}`);
  if (data.dept) rows.push(`**Phòng ban:** ${data.dept}`);
  if (data.amount) rows.push(`**Số tiền:** ${data.amount}`);
  if (data.content) rows.push(`**Nội dung:** ${data.content}`);
  for (const f of data.fields || []) {
    if (f && f.label && f.value != null) rows.push(`**${f.label}:** ${f.value}`);
  }

  const elements = [
    { tag: 'div', text: { tag: 'lark_md', content: rows.join('\n') || '_(không có chi tiết)_' } },
  ];
  if (data.detailUrl) {
    elements.push({
      tag: 'action',
      actions: [{
        tag: 'button',
        text: { tag: 'plain_text', content: 'Xem chi tiết' },
        type: 'primary',
        url: data.detailUrl,
      }],
    });
  }
  elements.push({ tag: 'note', elements: [{ tag: 'lark_md', content: `🤖 Lark Approval • ${nowStampICT(now)}` }] });

  return {
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: headTitle }, template: theme.template },
    elements,
  };
}

/**
 * Card thông báo kiểu "CC'd / đơn cần biết" (như ảnh Lark CC notification).
 * data: { title, requester, role, details:[{label,value}], detailUrl }
 *   - title: dòng tiêu đề đậm (vd: 'Admin ...\'s "[KAI] Đề xuất chi" — bạn được CC')
 *   - requester + role: dòng người đề xuất
 *   - details: list field hiện ở "Approval details"
 *   - detailUrl: nút "View Details" mở Web App (trang H5)
 */
function buildNotiCard(data = {}, now = new Date()) {
  const detailLines = (data.details || [])
    .filter((d) => d && d.label && d.value != null && d.value !== '')
    .map((d) => `${d.label}: ${d.value}`)
    .join('\n');

  const elements = [
    { tag: 'div', text: { tag: 'lark_md', content: `**${data.title || 'Thông báo phê duyệt'}**` } },
    { tag: 'hr' },
  ];
  if (data.requester) {
    const role = data.role ? `  ${data.role}` : '';
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: `**Requester**\n<font color='blue'>@${data.requester}</font>${role}` } });
  }
  if (detailLines) {
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: `**Approval details**\n${detailLines}` } });
  }
  if (data.detailUrl) {
    elements.push({
      tag: 'action',
      actions: [{ tag: 'button', text: { tag: 'plain_text', content: 'View Details' }, type: 'default', url: data.detailUrl }],
    });
  }
  elements.push({ tag: 'note', elements: [{ tag: 'lark_md', content: `🤖 Lark Approval • ${nowStampICT(now)}` }] });

  return { config: { wide_screen_mode: true }, elements };
}

module.exports = { buildStatusCard, buildNotiCard, STATUS_THEME };
