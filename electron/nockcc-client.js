'use strict';

const https = require('https');
const http = require('http');
const { isLoopbackHostname } = require('./settings-utils');

const MAX_NOCKCC_RESPONSE_BYTES = 1024 * 1024;

function buildNockCCUrl(baseUrl, apiPath) {
  const normalizedBase = `${String(baseUrl || '').trim().replace(/\/+$/, '')}/`;
  const relativePath = String(apiPath || '').replace(/^\/+/, '');
  return new URL(relativePath, normalizedBase);
}

// Defense in depth for the X-API-Key: this client trusts the settings normalizer
// to keep nockccUrl on https-or-loopback, but a single chokepoint here means the
// key can never leave over cleartext http to a non-loopback host even if the
// stored URL is somehow tainted. Mirrors agent-dispatch's isSecureTransport.
function isSecureTransport(parsed) {
  return parsed.protocol === 'https:' || isLoopbackHostname(parsed.hostname);
}

function readBoundedResponse(req, res, { encoding = null } = {}) {
  return new Promise((resolve, reject) => {
    let data = '';
    let responseBytes = 0;
    let settled = false;
    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    if (encoding) res.setEncoding(encoding);
    res.on('data', (chunk) => {
      responseBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
      if (responseBytes > MAX_NOCKCC_RESPONSE_BYTES) {
        const error = new Error('NockCC response exceeded 1 MB');
        req.destroy(error);
        res.destroy(error);
        rejectOnce(error);
        return;
      }
      data += chunk;
    });
    res.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(data);
    });
    res.on('error', rejectOnce);
  });
}

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
    const baseUrl = rawUrl.replace(/\/+$/, '');
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
    if (!apiKey) return Promise.resolve(); // not configured

    let parsed;
    try {
      parsed = buildNockCCUrl(baseUrl, path);
    } catch {
      return Promise.resolve();
    }

    if (!isSecureTransport(parsed)) {
      console.warn('NockCCClient: refusing to send API key over cleartext http to a non-loopback host');
      return Promise.resolve();
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
        'X-API-Key': apiKey,
      },
      timeout: 5000,
    };

    return new Promise((resolve, reject) => {
      const transport = parsed.protocol === 'https:' ? https : http;
      const req = transport.request(options, (res) => {
        readBoundedResponse(req, res)
          .then(() => resolve())
          .catch(reject);
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy(new Error('NockCC request timed out'));
      });
      req.write(payload);
      req.end();
    });
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
      parsed = buildNockCCUrl(baseUrl, '/api/terminal/sessions/');
    } catch {
      return;
    }

    if (!isSecureTransport(parsed)) {
      console.warn('NockCCClient: refusing to send API key over cleartext http to a non-loopback host');
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
        'X-API-Key': apiKey,
      },
      timeout: 5000,
    };

    const transport = parsed.protocol === 'https:' ? https : http;
    const req = transport.request(options, (res) => {
      readBoundedResponse(req, res, { encoding: 'utf8' })
        .then((data) => {
          try {
            const json = JSON.parse(data);
            if (json.success && json.data && json.data.id) {
              this._sessionId = json.data.id;
            }
          } catch { /* ignore */ }
        })
        .catch(() => { /* fire-and-forget */ });
    });
    req.on('error', () => { /* fire-and-forget */ });
    req.on('timeout', () => { req.destroy(new Error('NockCC request timed out')); });
    req.write(payload);
    req.end();
  }

  /**
   * PATCH /api/terminal/sessions/{id}/ — send heartbeat.
   * @param {object} opts
   * @param {number} [opts.activeProjectCount]
   * @param {string[]} [opts.activeClaudeSessionIds]
   * @param {string[]} [opts.activeAgentSessionIds]
   */
  heartbeat({
    activeProjectCount = 0,
    activeClaudeSessionIds = [],
    activeAgentSessionIds = [],
  } = {}) {
    if (!this._sessionId) return;
    const request = this._request('PATCH', `/api/terminal/sessions/${this._sessionId}/`, {
      active_project_count: activeProjectCount,
      active_claude_session_ids: activeClaudeSessionIds,
      active_agent_session_ids: activeAgentSessionIds,
    });
    request?.catch?.(() => { /* fire-and-forget */ });
  }

  /**
   * POST /api/terminal/sessions/{id}/end/ — mark session completed.
   */
  endSession() {
    if (!this._sessionId) return;
    const request = this._request('POST', `/api/terminal/sessions/${this._sessionId}/end/`, {});
    request?.catch?.(() => { /* fire-and-forget */ });
    this._sessionId = null;
  }
}

module.exports = NockCCClient;
