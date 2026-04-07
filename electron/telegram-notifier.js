const https = require('https');

class TelegramNotifier {
  constructor(store) {
    this.store = store;
    this.lastSentAt = 0;
    this.MIN_INTERVAL_MS = 5000; // 5 second rate limit
  }

  isEnabled() {
    return (
      this.store.get('telegramEnabled') === true &&
      typeof this.store.get('telegramBotToken') === 'string' &&
      this.store.get('telegramBotToken').length > 0 &&
      typeof this.store.get('telegramChatId') === 'string' &&
      this.store.get('telegramChatId').length > 0
    );
  }

  isQuietHours() {
    const quietStart = this.store.get('telegramQuietStart');
    const quietEnd = this.store.get('telegramQuietEnd');
    if (!quietStart || !quietEnd) return false;

    const parseTime = (str) => {
      const parts = str.split(':');
      if (parts.length !== 2) return null;
      const h = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      if (isNaN(h) || isNaN(m)) return null;
      return h * 60 + m;
    };

    const start = parseTime(quietStart);
    const end = parseTime(quietEnd);
    if (start === null || end === null) return false;

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    // Support overnight ranges (e.g., 22:00 to 07:00)
    if (start <= end) {
      // Same-day range (e.g., 09:00 to 17:00)
      return currentMinutes >= start && currentMinutes < end;
    }
    // Overnight range (e.g., 22:00 to 07:00)
    return currentMinutes >= start || currentMinutes < end;
  }

  shouldNotify(eventType) {
    if (!this.isEnabled()) return false;
    if (this.isQuietHours()) return false;

    // Per-event toggle map
    const eventToggleMap = {
      pr_merged: 'telegramNotifyPrMerged',
      build_complete: 'telegramNotifyBuildComplete',
      session_ended: 'telegramNotifySessionEnded',
      fence_event: 'telegramNotifyFenceEvent',
    };

    const toggleKey = eventToggleMap[eventType];
    if (toggleKey && this.store.get(toggleKey) === false) return false;

    // Rate limit
    const now = Date.now();
    if (now - this.lastSentAt < this.MIN_INTERVAL_MS) return false;

    return true;
  }

  async send(text) {
    const token = this.store.get('telegramBotToken');
    const chatId = this.store.get('telegramChatId');

    if (!token || !chatId) {
      return { success: false, error: 'Missing bot token or chat ID' };
    }

    const payload = JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
    });

    return new Promise((resolve) => {
      const req = https.request(
        {
          hostname: 'api.telegram.org',
          path: `/bot${token}/sendMessage`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
          timeout: 10000,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              if (parsed.ok) {
                this.lastSentAt = Date.now();
                resolve({ success: true });
              } else {
                resolve({
                  success: false,
                  error: parsed.description || 'Telegram API error',
                });
              }
            } catch (parseError) {
              resolve({
                success: false,
                error: `Invalid response from Telegram: ${parseError.message}`,
              });
            }
          });
        }
      );

      req.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ success: false, error: 'Request timed out' });
      });

      req.write(payload);
      req.end();
    });
  }

  async notify(eventType, details) {
    if (!this.shouldNotify(eventType)) {
      return { success: false, error: 'Notification suppressed' };
    }

    const label = eventType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const timestamp = new Date().toLocaleString();
    const text = `\u{1F514} <b>Nock Terminal</b>\n${label}: ${details}\n<i>${timestamp}</i>`;

    return this.send(text);
  }

  async test() {
    if (!this.isEnabled()) {
      return { success: false, error: 'Telegram notifications are not configured' };
    }

    const timestamp = new Date().toLocaleString();
    const text = `\u{1F514} <b>Nock Terminal</b> \u2014 Test notification\n<i>${timestamp}</i>`;

    return this.send(text);
  }
}

module.exports = TelegramNotifier;
