/* =====================================================================
   SNAPSEC BACKEND API CLIENT
   Connects the frontend workspace store and actions to the Express REST API
   ===================================================================== */

import { clearAuthSession, getStoredAuthToken } from './auth.js';

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL ? String(import.meta.env.VITE_API_BASE_URL) : '').replace(/\/+$/, '');

async function request(path, options = {}) {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const token = getStoredAuthToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };
  const res = await fetch(url, {
    ...options,
    headers,
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !path.includes('/api/auth/login') && !path.includes('/api/auth/signup')) {
      clearAuthSession();
      if (typeof window !== 'undefined' && window.__snapsec) {
        window.__snapsec.S.ui.auth = 'login';
        try {
          window.location.hash = 'login';
        } catch {}
        window.__snapsec.render();
      }
    }
    const err = new Error(data.error || `Request failed with status ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  health: () => request('/api/health'),
  bootstrap: () => request('/api/bootstrap'),
  checkSession: () => request('/api/auth/me'),
  metrics: () => request('/api/metrics'),
  syncState: payload =>
    request('/api/state', {
      method: 'PUT',
      body: payload,
      keepalive: true,
    }),
  resetWorkspace: () => request('/api/reset', { method: 'POST' }),

  // Tasks
  listTasks: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/tasks${qs ? `?${qs}` : ''}`);
  },
  getTask: id => request(`/api/tasks/${encodeURIComponent(id)}`),
  createTask: body => request('/api/tasks', { method: 'POST', body }),
  updateTask: (id, patch) => request(`/api/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
  duplicateTask: id => request(`/api/tasks/${encodeURIComponent(id)}/duplicate`, { method: 'POST' }),
  archiveTask: id => request(`/api/tasks/${encodeURIComponent(id)}/archive`, { method: 'POST' }),
  restoreTask: id => request(`/api/tasks/${encodeURIComponent(id)}/restore`, { method: 'POST' }),
  deleteTask: id => request(`/api/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  bulkTasks: body => request('/api/tasks/bulk', { method: 'POST', body }),

  // Subtasks
  addSubtask: (taskId, title) => request(`/api/tasks/${encodeURIComponent(taskId)}/subtasks`, { method: 'POST', body: { title } }),
  updateSubtask: (taskId, sid, patch) =>
    request(`/api/tasks/${encodeURIComponent(taskId)}/subtasks/${encodeURIComponent(sid)}`, { method: 'PATCH', body: patch }),
  deleteSubtask: (taskId, sid) =>
    request(`/api/tasks/${encodeURIComponent(taskId)}/subtasks/${encodeURIComponent(sid)}`, { method: 'DELETE' }),
  promoteSubtask: (taskId, sid) =>
    request(`/api/tasks/${encodeURIComponent(taskId)}/subtasks/${encodeURIComponent(sid)}/promote`, { method: 'POST' }),

  // Comments
  listComments: taskId => request(`/api/tasks/${encodeURIComponent(taskId)}/comments`),
  addComment: (taskId, text, by, attachments = []) =>
    request(`/api/tasks/${encodeURIComponent(taskId)}/comments`, { method: 'POST', body: { text, by, attachments } }),
  deleteComment: id => request(`/api/comments/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  toggleReaction: (id, emoji, by) =>
    request(`/api/comments/${encodeURIComponent(id)}/reactions`, { method: 'POST', body: { emoji, by } }),

  // Projects
  listProjects: () => request('/api/projects'),
  getProject: id => request(`/api/projects/${encodeURIComponent(id)}`),
  createProject: body => request('/api/projects', { method: 'POST', body }),
  updateProject: (id, patch) => request(`/api/projects/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
  duplicateProject: id => request(`/api/projects/${encodeURIComponent(id)}/duplicate`, { method: 'POST' }),
  archiveProject: id => request(`/api/projects/${encodeURIComponent(id)}/archive`, { method: 'POST' }),
  restoreProject: id => request(`/api/projects/${encodeURIComponent(id)}/restore`, { method: 'POST' }),
  deleteProject: id => request(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  reorderProjects: projOrder => request('/api/projects/order', { method: 'PUT', body: { projOrder } }),

  // Teams & Members
  listTeams: () => request('/api/teams'),
  createTeam: body => request('/api/teams', { method: 'POST', body }),
  updateTeam: (id, body) => request(`/api/teams/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  deleteTeam: id => request(`/api/teams/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  listMembers: () => request('/api/members'),
  listOutbox: () => request('/api/outbox'),
  inviteMembers: body => request('/api/members/invite', { method: 'POST', body }),
  resendInvite: (id, body = {}) => request(`/api/members/${encodeURIComponent(id)}/resend-invite`, { method: 'POST', body }),
  acceptInvite: body => request('/api/invites/accept', { method: 'POST', body }),
  saveSmtpConfig: body => request('/api/settings/smtp', { method: 'POST', body }),
  updateMember: (id, body) => request(`/api/members/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  removeMember: id => request(`/api/members/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // Files
  listFiles: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/files${qs ? `?${qs}` : ''}`);
  },
  uploadFile: body => request('/api/files', { method: 'POST', body }),
  renameFile: (id, name) => request(`/api/files/${encodeURIComponent(id)}`, { method: 'PATCH', body: { name } }),
  duplicateFile: id => request(`/api/files/${encodeURIComponent(id)}/duplicate`, { method: 'POST' }),
  deleteFile: id => request(`/api/files/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // Notifications & Activity
  listNotifications: () => request('/api/notifications'),
  markNotifRead: (id, read = true) =>
    request(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'POST', body: { read } }),
  markAllNotifsRead: () => request('/api/notifications/read-all', { method: 'POST' }),
  clearReadNotifs: () => request('/api/notifications/read', { method: 'DELETE' }),
  listActivity: () => request('/api/activity'),

  // Views, Preferences & Workspace
  createView: body => request('/api/views', { method: 'POST', body }),
  renameView: (id, name) => request(`/api/views/${encodeURIComponent(id)}`, { method: 'PATCH', body: { name } }),
  deleteView: id => request(`/api/views/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  updatePreferences: body => request('/api/preferences', { method: 'PATCH', body }),
  updateWorkspace: body => request('/api/workspace', { method: 'PATCH', body }),

  // Auth & Security
  login: (email, password) => request('/api/auth/login', { method: 'POST', body: { email, password } }),
  signup: (name, email, password) => request('/api/auth/signup', { method: 'POST', body: { name, email, password } }),
  googleAuth: profile => request('/api/auth/google', { method: 'POST', body: profile }),
  forgotPassword: email => request('/api/auth/forgot', { method: 'POST', body: { email } }),
  resendVerification: email =>
    request('/api/auth/resend-verification', {
      method: 'POST',
      body: { email, baseUrl: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4000' },
    }),
  verifyEmail: (tokenOrOtp, email) =>
    request('/api/auth/verify', {
      method: 'POST',
      body: { token: tokenOrOtp, otp: tokenOrOtp, email },
    }),
  resetPassword: (password, confirmPassword, token, email) =>
    request('/api/auth/reset', { method: 'POST', body: { password, confirmPassword, token, email } }),
  changePassword: (currentPassword, newPassword, confirmPassword) =>
    request('/api/auth/password', { method: 'POST', body: { currentPassword, newPassword, confirmPassword } }),
  toggle2fa: (enabled, code) => request('/api/auth/2fa', { method: 'POST', body: { enabled, code } }),
  revokeSession: id => request(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  revokeAllSessions: () => request('/api/sessions', { method: 'DELETE' }),
};
