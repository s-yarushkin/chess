// Telegram mini-app window controls: optional fullscreen, always responsive.
// A Telegram client may refuse fullscreen; normal play remains available.
(function installViewportControls() {
  const init = () => {
    const header = document.querySelector('.top');
    if (!header || document.getElementById('expandGame')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'expandGame';
    button.className = 'icon-btn';
    button.textContent = '⛶';
    button.title = 'Развернуть игру';
    button.setAttribute('aria-label', 'Развернуть игру на весь экран');
    header.appendChild(button);

    const telegram = window.Telegram?.WebApp;
    const update = () => {
      const expanded = !!telegram?.isFullscreen || !!document.fullscreenElement;
      button.textContent = expanded ? '⤢' : '⛶';
      button.title = expanded ? 'Вернуться к обычному размеру' : 'Развернуть игру';
      button.setAttribute('aria-label', button.title);
    };
    button.addEventListener('click', async () => {
      if (telegram?.isFullscreen && typeof telegram.exitFullscreen === 'function') {
        try { telegram.exitFullscreen(); } catch { /* Unsupported by this client. */ }
      } else if (typeof telegram?.requestFullscreen === 'function') {
        try { telegram.requestFullscreen(); telegram.expand?.(); } catch { /* Telegram client may refuse. */ }
      } else if (document.fullscreenElement && document.exitFullscreen) {
        try { await document.exitFullscreen(); } catch { /* No-op. */ }
      } else if (document.documentElement.requestFullscreen) {
        try { await document.documentElement.requestFullscreen(); } catch { telegram?.expand?.(); }
      } else {
        telegram?.expand?.();
      }
      update();
    });
    document.addEventListener('fullscreenchange', update);
    telegram?.onEvent?.('fullscreenChanged', update);
    update();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true});
  else init();
})();
