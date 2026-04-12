'use strict';

const https = require('https');
const http = require('http');

/**
 * NockCC client — fire-and-forget HTTP calls to the NockCC server.
 *
 * All public methods catch their own errors. The Electron main process
 * must not crash on network failures.
 */
class NockCCClient {
  /**
   * @param {import('electron-store')} store - electron-store instance
   */
  constructor(store) {
    this._store = store;
    this._sessionId = null; // numeric DB id returned by startSession
  }

  _getConfig() {
    const apiKey = this._store.get('nockccApiKey') || '';
    const rawUrl = this._store.get('nockccUrl') || 'https://cc.nocktechnologies.io';
    // Strip trailing slash
    const baseUrl = rawUrl.replace(/\/$/, '');
    return { apiKey, baseUrl };
  }

  /**
   * Fire-and-forget JSON POST/PATCH to NockCC.
   * @param {'POST'|'PATCH'} method
   * @param {string} path
   * @param {object} body
   */
  _request(method, path, body) {
    const { apiKey, baseUrl } = this._getConfig();
    if (!apiKey) return; // not configured

    let parsed;
    try {
      parsed = new URL(baseUrl + path);
    } catch {
      return;
    }

    const payload = JSON.stringify(body);
    const options = {
      method,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + (parsed.search || ''),
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'X-Api-Key': apiKey,
      },
      timeout: 5000,
    };

    const transport = parsed.protocol === 'https:' ? https : http;
    const req = transport.request(options, (res) => {
      // Drain response to free socket
      res.resume();
    });
    req.on('error', () => { /* fire-and-forget */ });
    req.on('timeout', () => { req.destroy(); });
    req.write(payload);
    req.end();
  }

  /**
   * POST /api/terminal/sessions/ — register this Terminal session with NockCC.
   * Stores the returned id for subsequent heartbeat/end calls.
   * @param {object} opts
   * @param {string} [opts.machine]
   * @param {string} [opts.appVersion]
   */
  startSession({ machine = '', appVersion = '' } = {}) {
    const { apiKey, baseUrl } = this._getConfig();
    if (!apiKey) return;

    let parsed;
    try {
      parsed = new URL(baseUrl + '/api/terminal/sessions/');
    } catch {
      return;
    }

    const payload = JSON.stringify({ machine, app_version: appVersion });
    const options = {
      method: 'POST',
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'X-Api-Key': apiKey,
      },
      timeout: 5000,
    };

    const transport = parsed.protocol === 'https:' ? https : http;
    const req = transport.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.success && json.data && json.data.id) {
            this._sessionId = json.data.id;
          }
        } catch { /* ignore */ }
      });
    });
    req.on('error', () => { /* fire-and-forget */ });
    req.on('timeout', () => { req.destroy(); });
    req.write(payload);
    req.end();
  }

  /**
   * PATCH /api/terminal/sessions/{id}/ — send heartbeat.
   * @param {object} opts
   * @param {number} [opts.activeProjectCount]
   * @param {string[]} [opts.activeClaudeSessionIds]
   */
  heartbeat({ activeProjectCount = 0, activeClaudeSessionIds = [] } = {}) {
    if (!this._sessionId) return;
    this._request('PATCH', `/api/terminal/sessions/${this._sessionId}/`, {
      active_project_count: activeProjectCount,
      active_claude_session_ids: activeClaudeSessionIds,
    });
  }

  /**
   * POST /api/terminal/sessions/{id}/end/ — mark session completed.
   */
  endSession() {
    if (!this._sessionId) return;
    this._request('POST', `/api/terminal/sessions/${this._sessionId}/end/`, {});
    this._sessionId = null;
  }
}

module.exports = NockCCClient;
