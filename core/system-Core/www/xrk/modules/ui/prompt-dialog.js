export function showPromptDialog(message) {
  return new Promise(resolve => {
    const id = 'xrkPromptDialog';
    let modal = document.getElementById(id);
    if (!modal) {
      modal = document.createElement('div');
      modal.id = id;
      modal.className = 'xrk-prompt-modal';
      modal.innerHTML = `
        <div class="xrk-prompt-backdrop"></div>
        <div class="xrk-prompt-dialog">
          <div class="xrk-prompt-message"></div>
          <input class="xrk-prompt-input" type="text" />
          <div class="xrk-prompt-actions">
            <button type="button" class="xrk-prompt-cancel">取消</button>
            <button type="button" class="xrk-prompt-ok">确定</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }

    const backdrop = modal.querySelector('.xrk-prompt-backdrop');
    const msgEl = modal.querySelector('.xrk-prompt-message');
    const input = modal.querySelector('.xrk-prompt-input');
    const okBtn = modal.querySelector('.xrk-prompt-ok');
    const cancelBtn = modal.querySelector('.xrk-prompt-cancel');

    const cleanup = (value) => {
      modal.classList.remove('show');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      backdrop.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKeydown);
      setTimeout(() => {
        modal.style.display = 'none';
        resolve(value);
      }, 200);
    };

    const onOk = () => cleanup(input.value);
    const onCancel = () => cleanup(null);
    const onKeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onOk();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };

    msgEl.textContent = message ?? '';
    input.value = '';
    modal.style.display = 'flex';
    requestAnimationFrame(() => {
      modal.classList.add('show');
      input.focus();
    });

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    backdrop.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKeydown);
  });
}

