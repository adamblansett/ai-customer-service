export interface WidgetSdkConfig {
  defaultApiBaseUrl: string;
  tenantId?: string;
  title?: string;
  primaryColor?: string;
  enableVoice?: boolean;
}

export class WidgetSdkGenerator {
  /**
   * Generates a standalone, zero-dependency, Shadow-DOM isolated JavaScript SDK bundle
   * for embedding both live AI Web Chat and Click-to-Call Browser Voice on any website.
   */
  static generateEmbedSnippet(params: {
    scriptOrigin: string;
    tenantId: string;
    primaryColor?: string;
    title?: string;
    enableVoice?: boolean;
  }): string {
    const color = params.primaryColor || '#0284c7';
    const title = (params.title || 'AI Support Concierge').replace(/"/g, '&quot;');
    const voice = params.enableVoice !== false ? 'true' : 'false';
    return `<script src="${params.scriptOrigin}/api/v1/widget.js" data-tenant="${params.tenantId}" data-title="${title}" data-primary-color="${color}" data-enable-voice="${voice}" async></script>`;
  }

  static generateBundle(config: WidgetSdkConfig): string {
    const fallbackApi = JSON.stringify(config.defaultApiBaseUrl);
    const fallbackTenant = JSON.stringify(config.tenantId || 'tenant_acme_hvac_001');
    const fallbackTitle = JSON.stringify(config.title || 'AI Customer Support');
    const fallbackColor = JSON.stringify(config.primaryColor || '#0284c7');

    return `(function () {
  if (window.__CS_AI_WIDGET_LOADED__) return;
  window.__CS_AI_WIDGET_LOADED__ = true;

  var scriptEl = document.currentScript || document.querySelector('script[data-tenant]');
  var tenantId = (scriptEl && scriptEl.getAttribute('data-tenant')) || ${fallbackTenant};
  var title = (scriptEl && scriptEl.getAttribute('data-title')) || ${fallbackTitle};
  var primaryColor = (scriptEl && scriptEl.getAttribute('data-primary-color')) || ${fallbackColor};
  var enableVoice = !scriptEl || scriptEl.getAttribute('data-enable-voice') !== 'false';
  var apiBase = (scriptEl && scriptEl.getAttribute('data-api-url')) || ${fallbackApi};

  var sessionId = null;
  var voiceActive = false;
  var host = document.createElement('div');
  host.id = 'cs-ai-widget-root';
  document.body.appendChild(host);

  var shadow = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
  var style = document.createElement('style');
  style.textContent = [
    '.cs-fab { position: fixed; right: 20px; bottom: 20px; z-index: 2147483646; border: none; border-radius: 9999px; padding: 14px 20px; font-family: system-ui, sans-serif; font-weight: 600; font-size: 14px; color: #fff; cursor: pointer; box-shadow: 0 10px 25px rgba(15,23,42,0.25); display: flex; align-items: center; gap: 8px; }',
    '.cs-panel { position: fixed; right: 20px; bottom: 80px; width: 360px; max-width: calc(100vw - 40px); height: 500px; background: #fff; border-radius: 16px; box-shadow: 0 20px 45px rgba(15,23,42,0.28); border: 1px solid #e2e8f0; display: none; flex-direction: column; overflow: hidden; z-index: 2147483646; font-family: system-ui, sans-serif; }',
    '.cs-panel.open { display: flex; }',
    '.cs-header { padding: 14px 16px; color: #fff; display: flex; justify-content: space-between; align-items: center; }',
    '.cs-messages { flex: 1; padding: 14px; overflow-y: auto; background: #f8fafc; display: flex; flex-direction: column; gap: 10px; font-size: 13px; }',
    '.cs-msg { max-width: 82%; padding: 10px 12px; border-radius: 12px; line-height: 1.45; word-break: break-word; }',
    '.cs-msg.ai { background: #fff; color: #0f172a; border: 1px solid #e2e8f0; align-self: flex-start; }',
    '.cs-msg.user { color: #fff; align-self: flex-end; }',
    '.cs-footer { padding: 10px; border-top: 1px solid #e2e8f0; display: flex; gap: 6px; background: #fff; }',
    '.cs-input { flex: 1; border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px 10px; font-size: 13px; outline: none; }',
    '.cs-btn { border: none; border-radius: 8px; padding: 8px 12px; color: #fff; font-weight: 600; font-size: 12px; cursor: pointer; }',
    '.cs-voice-bar { padding: 6px 12px; background: #0f172a; color: #38bdf8; font-size: 11px; display: none; align-items: center; justify-content: space-between; }',
    '.cs-voice-bar.active { display: flex; }'
  ].join('\\n');
  shadow.appendChild(style);

  var panel = document.createElement('div');
  panel.className = 'cs-panel';

  var header = document.createElement('div');
  header.className = 'cs-header';
  header.style.background = primaryColor;
  var headerTitle = document.createElement('span');
  headerTitle.style.fontWeight = '700';
  headerTitle.textContent = title;
  header.appendChild(headerTitle);

  if (enableVoice) {
    var voiceBtn = document.createElement('button');
    voiceBtn.className = 'cs-btn';
    voiceBtn.style.background = 'rgba(255,255,255,0.2)';
    voiceBtn.textContent = 'Voice Call';
    voiceBtn.onclick = function () {
      voiceActive = !voiceActive;
      voiceBar.className = voiceActive ? 'cs-voice-bar active' : 'cs-voice-bar';
      voiceBtn.textContent = voiceActive ? 'End Voice' : 'Voice Call';
    };
    header.appendChild(voiceBtn);
  }

  var voiceBar = document.createElement('div');
  voiceBar.className = 'cs-voice-bar';
  voiceBar.textContent = 'WebRTC Click-to-Call Active (AI Voice Synthesis Ready)';

  var messagesEl = document.createElement('div');
  messagesEl.className = 'cs-messages';

  function appendMessage(role, text) {
    var bubble = document.createElement('div');
    bubble.className = 'cs-msg ' + role;
    if (role === 'user') bubble.style.background = primaryColor;
    bubble.textContent = text;
    messagesEl.appendChild(bubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    if (role === 'ai' && voiceActive && window.speechSynthesis) {
      try {
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
      } catch (_e) {}
    }
  }

  var footer = document.createElement('form');
  footer.className = 'cs-footer';
  var input = document.createElement('input');
  input.className = 'cs-input';
  input.placeholder = 'Ask a question...';
  var sendBtn = document.createElement('button');
  sendBtn.type = 'submit';
  sendBtn.className = 'cs-btn';
  sendBtn.style.background = primaryColor;
  sendBtn.textContent = 'Send';
  footer.appendChild(input);
  footer.appendChild(sendBtn);

  async function ensureSession() {
    if (sessionId) return sessionId;
    var res = await fetch(apiBase + '/chat/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId: tenantId })
    });
    var data = await res.json();
    sessionId = data.conversationId || (data.session && data.session.id);
    if (data.greeting) appendMessage('ai', data.greeting);
    return sessionId;
  }

  footer.onsubmit = async function (e) {
    e.preventDefault();
    var content = input.value.trim();
    if (!content) return;
    input.value = '';
    appendMessage('user', content);
    try {
      var sid = await ensureSession();
      var res = await fetch(apiBase + '/chat/sessions/' + encodeURIComponent(sid) + '/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: tenantId, content: content })
      });
      var reply = await res.json();
      appendMessage('ai', reply.reply || (reply.aiMessage && reply.aiMessage.content) || 'Received.');
    } catch (_err) {
      appendMessage('ai', 'Unable to reach support server right now.');
    }
  };

  panel.appendChild(header);
  panel.appendChild(voiceBar);
  panel.appendChild(messagesEl);
  panel.appendChild(footer);

  var fab = document.createElement('button');
  fab.className = 'cs-fab';
  fab.style.background = primaryColor;
  fab.textContent = 'Chat & Voice Support';
  fab.onclick = function () {
    var isOpen = panel.classList.toggle('open');
    if (isOpen && !sessionId) {
      ensureSession().catch(function () {
        appendMessage('ai', 'Hello! How can we help you today?');
      });
    }
  };

  shadow.appendChild(panel);
  shadow.appendChild(fab);
})();`;
  }
}
