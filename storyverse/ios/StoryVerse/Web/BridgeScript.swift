import Foundation

/// JavaScript injected into StoryVerse pages before they load. It exposes
/// `window.storyverseNative` and attaches the app session to the site's own
/// /api/ requests. The site's scripts check for it to switch to native features.
enum BridgeScript {
    static func source(sessionToken: String?) -> String {
        let session = sessionToken.flatMap { token -> String? in
            guard let data = try? JSONSerialization.data(withJSONObject: [token]),
                  let array = String(data: data, encoding: .utf8) else { return nil }
            return String(array.dropFirst().dropLast()) // a JSON string literal
        } ?? "null"
        return """
        (() => {
          if (window.storyverseNative) return;
          const handler = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.storyverse;
          if (!handler) return;
          let session = \(session);
          const call = (action, payload = {}) => handler.postMessage({ action, payload });
          const pageFetch = window.fetch.bind(window);
          window.fetch = (input, init = {}) => {
            try {
              const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, location.href);
              if (session && url.origin === location.origin && url.pathname.startsWith('/api/')) {
                const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
                if (!headers.has('authorization')) headers.set('authorization', 'Bearer ' + session);
                init = Object.assign({}, init, { headers });
              }
            } catch (error) { /* fall through to the original request */ }
            return pageFetch(input, init);
          };
          window.storyverseNative = Object.freeze({
            platform: 'ios',
            call,
            get signedIn() { return Boolean(session); },
            _setSession(token) {
              session = token || null;
              window.dispatchEvent(new CustomEvent('storyverse:session', { detail: { signedIn: Boolean(session) } }));
            },
          });
          // At document start the root element may not exist yet.
          const mark = () => document.documentElement && document.documentElement.classList.add('native-app', 'standalone');
          if (document.documentElement) mark(); else document.addEventListener('readystatechange', mark, { once: true });
        })();
        """
    }
}
