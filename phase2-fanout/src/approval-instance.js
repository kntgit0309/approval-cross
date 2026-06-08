'use strict';
/**
 * Lấy + normalize chi tiết 1 approval instance từ Approval API (tenant TRUNG TÂM / KAI).
 *   GET /open-apis/approval/v4/instances/{instance_code}
 *
 * normalizeInstance() là hàm THUẦN (test được offline) — map response Lark → shape H5 page dùng:
 *   { id, rqId, title, type, status, submitter, fields[], steps[] }
 *
 * LƯU Ý: tên approver trong timeline là user_id tenant trung tâm → cần nameResolver
 * (user_id → display name) để hiện đẹp; tạm thời fallback hiển thị user_id nếu thiếu.
 */

const STATUS_MAP = {
  PENDING: 'in_progress',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELED: 'canceled',
  DELETED: 'canceled',
  TERMINATED: 'canceled',
  REVERTED: 'in_progress',
};

// task status (mỗi node) → trạng thái step
const TASK_STATUS = {
  PENDING: 'in_progress',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  TRANSFERRED: 'approved',
  DONE: 'done',
};

function normalizeInstance(raw, { nameResolver } = {}) {
  const inst = (raw && raw.data) || raw || {};
  const resolveName = (uid) => (nameResolver && nameResolver(uid)) || uid || 'N/A';

  const steps = [];
  // Bước submit luôn đứng đầu
  steps.push({
    node: 'Submit', name: resolveName(inst.user_id), role: 'Người đề xuất',
    status: 'approved', result: 'Submitted', time: inst.start_time || null, comment: null,
  });
  for (const t of inst.task_list || []) {
    steps.push({
      node: t.node_name || 'Phê duyệt',
      name: resolveName(t.user_id),
      role: t.node_name || '',
      status: TASK_STATUS[t.status] || 'pending',
      result: t.status,
      time: t.end_time || t.start_time || null,
      comment: (t.comments && t.comments[0] && t.comments[0].content) || null,
    });
  }

  return {
    id: inst.instance_code || inst.serial_number || '',
    rqId: inst.serial_number || '',
    title: inst.approval_name || 'Đơn phê duyệt',
    type: inst.approval_name || '',
    status: STATUS_MAP[inst.status] || 'in_progress',
    submitter: { name: resolveName(inst.user_id), role: '', time: inst.start_time || '' },
    fields: [], // form parse là bước sau (mỗi approval form có widget khác nhau)
    steps,
  };
}

// Gọi API thật. client = lark-client; token = tenant_access_token tenant TRUNG TÂM.
async function getApprovalInstance(instanceCode, { client, token, nameResolver } = {}) {
  if (!client || !token) {
    throw new Error('getApprovalInstance: cần client + token tenant trung tâm (chưa nối REAL mode)');
  }
  const r = await client.get(`/open-apis/approval/v4/instances/${encodeURIComponent(instanceCode)}`, { token });
  return normalizeInstance(r, { nameResolver });
}

module.exports = { getApprovalInstance, normalizeInstance, STATUS_MAP, TASK_STATUS };
