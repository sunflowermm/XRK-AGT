import { toastIconSVG } from '../ui-kit.js';

export function showToast(message, type = 'info', options = {}) {
  const containerId = options.containerId || 'toastContainer';
  const duration = Number.isFinite(options.duration) ? options.duration : 3000;
  const hideDuration = Number.isFinite(options.hideDuration) ? options.hideDuration : 300;

  const container = document.getElementById(containerId);
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
  toast.innerHTML = `<span class="toast-icon" aria-hidden="true">${toastIconSVG(type)}</span><span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('hide');
    setTimeout(() => toast.remove(), hideDuration);
  }, duration);
}
