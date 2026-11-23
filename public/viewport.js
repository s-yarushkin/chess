// Telegram Mini App fullscreen controls and safe area handling.
// In fullscreen Telegram overlays its own Close/menu controls on the web view.
(function installViewportControls() {
  const telegram = window.Telegram?.WebApp;
  const root = document.documentElement;
  const px = n => typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
  const readCss = name => {
    if (typeof window.getComputedStyle !== 'function') return 0;
    return px(Number.parseFloat(window.getComputedStyle(root).getPropertyValue(name)));
  };
  const mobile = () => typeof window.matchMedia === 'function'
    ? window.matchMedia('(max-width: 800px)').matches : window.innerWidth <= 800;
  const onTelegram = (event,callback) => {
    try { telegram?.onEvent?.(event,callback); } catch { /* Older clients. */ }
  };
  function applySafeArea() {
    const full = !!(telegram?.isFullscreen || document.fullscreenElement);
    const active = full && mobile();
    let top = 0, bottom = 0;
    if (active) {
      const systemTop = px(telegram?.safeAreaInset?.top) || readCss('--tg-safe-area-inset-top');
      const contentTop = px(telegram?.contentSafeAreaInset?.top) || readCss('--tg-content-safe-area-inset-top');
      const systemBottom = px(telegram?.safeAreaInset?.bottom) || readCss('--tg-safe-area-inset-bottom');
      const contentBottom = px(telegram?.contentSafeAreaInset?.bottom) || readCss('--tg-content-safe-area-inset-bottom');
      // Some Telegram Android builds initially report 0 insets. Reserve a
      // minimum tappable header clearance until the client supplies real values.
      top = Math.min(220,Math.max(96,systemTop + contentTop));
      bottom = Math.min(100,systemBottom + contentBottom);
    }
    root.style.setProperty('--chess-telegram-clear-top',top+'px');
    root.style.setProperty('--chess-telegram-clear-bottom',bottom+'px');
    root.classList.toggle('chess-tg-fullscreen',active);
  }
  function init() {
    const header = document.querySelector('.top');
    if (!header) return;
    let button = document.getElementById('expandGame');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.id = 'expandGame';
      button.className = 'icon-btn';
      button.textContent = '⛶';
      button.setAttribute('aria-label','Развернуть игру на весь экран');
      header.appendChild(button);
    }
    const update = () => {
      applySafeArea();
      const full = !!(telegram?.isFullscreen || document.fullscreenElement);
      button.textContent = full ? '⤢' : '⛶';
      button.title = full ? 'Свернуть игру' : 'Развернуть игру';
      button.setAttribute('aria-label',button.title);
    };
    const refresh = () => {
      update();
      window.requestAnimationFrame?.(update);
    };
    button.addEventListener('click',async() => {
      if (telegram?.isFullscreen && typeof telegram.exitFullscreen === 'function') {
        try { telegram.exitFullscreen(); } catch { /* Not supported. */ }
      } else if (typeof telegram?.requestFullscreen === 'function') {
        try { telegram.requestFullscreen(); telegram.expand?.(); } catch { /* Not supported. */ }
      } else if (document.fullscreenElement && document.exitFullscreen) {
        try { await document.exitFullscreen(); } catch { /* Not supported. */ }
      } else if (document.documentElement.requestFullscreen) {
        try { await document.documentElement.requestFullscreen(); } catch { telegram?.expand?.(); }
      } else {
        telegram?.expand?.();
      }
      refresh();
    });
    document.addEventListener('fullscreenchange',refresh);
    document.addEventListener('visibilitychange',refresh);
    window.addEventListener?.('resize',refresh);
    window.visualViewport?.addEventListener?.('resize',refresh);
    for (const event of ['fullscreenChanged','fullscreenFailed','safeAreaChanged',
      'contentSafeAreaChanged','viewportChanged']) onTelegram(event,refresh);
    refresh();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
