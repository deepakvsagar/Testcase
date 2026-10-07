// Installable-app support: registers the service worker and, when the site is open
// in a browser rather than as the installed app, offers a way to install it.
'use strict';

// Inside the StoryVerse iOS app, `window.storyverseNative` is injected by the app
// before any page script runs. StoryVerseApp wraps it for the site's scripts.
window.StoryVerseApp = (() => {
  const native = window.storyverseNative || null;
  const blobToBase64 = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return {
    native: Boolean(native),
    signedIn: () => Boolean(native?.signedIn),
    signIn: () => native.call('signIn'),
    haptic: (style = 'light') => { native?.call('haptic', { style }).catch(() => {}); },
    // Opens the iOS share sheet (Save Video, Save to Files, AirDrop, apps).
    async shareFile(blob, fileName) {
      return native.call('shareFile', { base64: await blobToBase64(blob), fileName });
    },
  };
})();

if (window.StoryVerseApp.native) {
  document.documentElement.classList.add('native-app', 'standalone');
  window.addEventListener('DOMContentLoaded', () => {
    const header = document.querySelector('header');
    if (!header || header.querySelector('.native-account')) return;
    const account = document.createElement('button');
    account.type = 'button';
    account.className = 'button small native-account';
    account.textContent = 'Account';
    account.addEventListener('click', () => window.storyverseNative.call('openAccount').catch(() => {}));
    header.querySelector(':scope > .button')?.remove();
    header.append(account);
  });
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => { /* app still works online */ }); });
}

(() => {
  const DISMISSED = 'storyverse:install-hint-dismissed';
  const standalone = window.StoryVerseApp.native || window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (standalone) { document.documentElement.classList.add('standalone'); return; }
  try { if (localStorage.getItem(DISMISSED)) return; } catch { /* storage blocked: still offer the hint */ }

  // iPadOS reports itself as a Mac, so check for touch as well.
  const ios = /iPhone|iPad|iPod/u.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let deferredPrompt = null;

  function showHint(message, action) {
    if (document.querySelector('.install-hint')) return;
    const hint = document.createElement('aside');
    hint.className = 'install-hint';
    hint.setAttribute('aria-label', 'Install StoryVerse');
    const icon = document.createElement('img');
    icon.src = '/icons/icon-192.png';
    icon.alt = '';
    const text = document.createElement('p');
    text.append(Object.assign(document.createElement('strong'), { textContent: 'Get the StoryVerse app' }), document.createElement('br'), message);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'install-close';
    close.setAttribute('aria-label', 'Dismiss install suggestion');
    close.textContent = '×';
    close.addEventListener('click', () => { hint.remove(); try { localStorage.setItem(DISMISSED, '1'); } catch { /* ignore */ } });
    hint.append(icon, text);
    if (action) hint.append(action);
    hint.append(close);
    document.body.append(hint);
  }

  if (ios) {
    // iOS has no install prompt API; installation is a manual Share-sheet step.
    const share = document.createElement('span');
    share.className = 'share-glyph';
    share.setAttribute('aria-hidden', 'true');
    share.textContent = '⬆︎';
    const message = document.createDocumentFragment();
    message.append('Tap Share ', share, ' then “Add to Home Screen”.');
    window.addEventListener('load', () => setTimeout(() => showHint(message), 1200));
    return;
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    const install = document.createElement('button');
    install.type = 'button';
    install.className = 'button small';
    install.textContent = 'Install';
    install.addEventListener('click', async () => {
      document.querySelector('.install-hint')?.remove();
      deferredPrompt.prompt();
      await deferredPrompt.userChoice.catch(() => null);
      deferredPrompt = null;
    });
    showHint('Open it from your home screen or dock, even offline.', install);
  });
})();
