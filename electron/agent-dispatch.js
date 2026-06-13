'use strict';

const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');

const {
  safeAgentName,
  safeRuntime,
  sanitizeDispatchText: sanitizeDispatchTextValue,
} = require('./ipc-validators');

const DEFAULT_BROKER_AGENT = 'mira-nockos';
const DEFAULT_STATUS_POLL_AGENT = 'nock-terminal';
const MAX_TASK_LENGTH = 12000;
const MAX_THREAD_BODY_LENGTH = 4000;
const DEFAULT_PAYLOAD_CLEANUP_MS = 24 * 60 * 60 * 1000;
const MAX_NOCKCC_RESPONSE_BYTES = 1024 * 1024;
const DISPATCH_PAYLOAD_DIR_PREFIX = 'nock-dispatch-';
const DISPATCH_LIVE_STATUSES = new Set(['accepted', 'running', 'blocked', 'completed', 'failed']);
const pendingPayloadDirs = new Set();
const payloadSweepPromises = new Map();
let payloadCleanupHandlersInstalled = false;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeString(value, maxLength = 1000) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function safeRequestId(value) {
  const normalized = String(value || '').trim();
  return /^[A-Za-z0-9_-]{1,120}$/.test(normalized) ? normalized : '';
}

function safeLimit(value, fallback = 20) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(100, Math.max(1, Math.floor(number)));
}

function normalizeRequestIds(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const requestIds = [];
  for (const item of value) {
    const requestId = safeRequestId(item);
    if (!requestId || seen.has(requestId)) continue;
    seen.add(requestId);
    requestIds.push(requestId);
    if (requestIds.length >= 50) break;
  }
  return requestIds;
}

const sanitizeDispatchText = (value, maxLength = MAX_TASK_LENGTH) => (
  sanitizeDispatchTextValue(value, { maxLength, stringify: true })
);

function requestId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

function buildNockCCUrl(baseUrl, apiPath) {
  const normalizedBase = `${String(baseUrl || '').trim().replace(/\/+$/, '')}/`;
  const relativePath = String(apiPath || '').replace(/^\/+/, '');
  return new URL(relativePath, normalizedBase);
}

function shellQuote(value) {
  const text = String(value || '');
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

function buildDispatchRequest(input = {}) {
  const agentName = safeAgentName(input.agentName);
  const runtime = safeRuntime(input.runtime);
  const taskDescription = sanitizeDispatchText(input.taskDescription);
  const targetRepo = safeString(input.targetRepo, 1000);
  const projectName = safeString(input.projectName, 200);
  const id = safeRequestId(input.requestId) || requestId();

  if (!agentName) throw new Error('A valid dispatch agent name is required');
  if (!runtime) throw new Error('A valid dispatch runtime is required');
  if (!taskDescription) throw new Error('A dispatch task description is required');

  const body = [
    'Nock Terminal dispatch request',
    '',
    `request_id: ${id}`,
    `agent_name: ${agentName}`,
    `runtime: ${runtime}`,
    `target_repo: ${targetRepo || 'unspecified'}`,
    `project_name: ${projectName || 'unspecified'}`,
    '',
    'Task:',
    taskDescription,
  ].join('\n');

  return {
    requestId: id,
    agentName,
    runtime,
    taskDescription,
    targetRepo,
    projectName,
    subject: `Nock Terminal dispatch: ${agentName}`,
    body,
    context: {
      source: 'nock-terminal',
      launch_mode: 'brokered',
      dispatch_agent: agentName,
      agent_runtime: runtime,
      target_repo: targetRepo,
      project_name: projectName,
      request_id: id,
    },
  };
}

function buildBrokeredDispatchMessage(input = {}) {
  const request = buildDispatchRequest(input);
  return {
    from_agent: 'nock-terminal',
    to_agent: safeAgentName(input.brokerAgent) || DEFAULT_BROKER_AGENT,
    message_type: 'directive',
    subject: request.subject,
    body: request.body,
    priority: safeString(input.priority, 40) || 'normal',
    context: request.context,
  };
}

function normalizeMessageContext(context) {
  if (isPlainObject(context)) return context;
  if (typeof context !== 'string' || !context.trim()) return {};
  try {
    const parsed = JSON.parse(context);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeLiveDispatchStatus(value) {
  const normalized = safeString(value, 40).toLowerCase();
  return DISPATCH_LIVE_STATUSES.has(normalized) ? normalized : '';
}

function statusFromBody(body) {
  const match = safeString(body, 5000).match(/\b(accepted|running|blocked|completed|failed)\b/i);
  return normalizeLiveDispatchStatus(match?.[1]);
}

function statusFromMessage(message, context) {
  for (const key of ['status', 'dispatch_status', 'dispatchStatus', 'state']) {
    const status = normalizeLiveDispatchStatus(context[key]);
    if (status) return status;
  }
  return statusFromBody(message?.body);
}

function requestIdFromMessage(message, context) {
  return safeRequestId(
    context.request_id
    || context.requestId
    || safeString(message?.body, 5000).match(/\brequest_id:\s*([A-Za-z0-9_-]{1,120})\b/i)?.[1]
  );
}

function statusMessageFromMessage(message, context) {
  return safeString(
    context.status_message
    || context.statusMessage
    || context.message
    || message?.subject
    || message?.body,
    500
  );
}

function normalizeMessagesResponse(response) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.data?.messages)) return response.data.messages;
  if (Array.isArray(response?.data?.results)) return response.data.results;
  if (Array.isArray(response?.data)) return response.data;
  if (Array.isArray(response?.messages)) return response.messages;
  if (Array.isArray(response?.results)) return response.results;
  return [];
}

function compareMessageOrder(a, b) {
  const aTime = Date.parse(a.createdAt || '') || 0;
  const bTime = Date.parse(b.createdAt || '') || 0;
  if (aTime !== bTime) return aTime - bTime;
  const aId = a.messageId || '';
  const bId = b.messageId || '';
  const aNumber = Number(aId);
  const bNumber = Number(bId);
  if (aId && bId && Number.isFinite(aNumber) && Number.isFinite(bNumber)) {
    const diff = aNumber - bNumber;
    if (diff !== 0) return diff;
  }
  if (aId < bId) return -1;
  if (aId > bId) return 1;
  return 0;
}

function compareThreadMessageOrder(a, b) {
  const aTime = Date.parse(a.createdAt || '');
  const bTime = Date.parse(b.createdAt || '');
  const aHasTime = Number.isFinite(aTime) && aTime > 0;
  const bHasTime = Number.isFinite(bTime) && bTime > 0;
  if (aHasTime && bHasTime && aTime !== bTime) return aTime - bTime;
  if (aHasTime !== bHasTime) return aHasTime ? -1 : 1;

  const aId = a.messageId || '';
  const bId = b.messageId || '';
  const aNumber = Number(aId);
  const bNumber = Number(bId);
  if (aId && bId && Number.isFinite(aNumber) && Number.isFinite(bNumber)) {
    const diff = aNumber - bNumber;
    if (diff !== 0) return diff;
  }
  if (aId < bId) return -1;
  if (aId > bId) return 1;
  return 0;
}

function collectDispatchStatusUpdates(messages, requestIds) {
  const wantedRequestIds = new Set(normalizeRequestIds(requestIds));
  if (!Array.isArray(messages) || wantedRequestIds.size === 0) return [];

  return messages
    .map((message) => {
      if (safeString(message?.message_type || message?.messageType, 40).toLowerCase() !== 'status_update') {
        return null;
      }
      const context = normalizeMessageContext(message.context);
      const requestId = requestIdFromMessage(message, context);
      if (!wantedRequestIds.has(requestId)) return null;

      const status = statusFromMessage(message, context);
      if (!status) return null;

      return {
        messageId: safeString(String(message.id || message.message_id || ''), 200),
        requestId,
        status,
        statusMessage: statusMessageFromMessage(message, context),
        senderAgent: safeAgentName(message.from_agent || message.sender_agent),
        subject: safeString(message.subject, 200),
        createdAt: safeString(message.created_at || message.createdAt, 80),
        readAt: safeString(message.read_at || message.readAt, 80),
        source: 'nockcc-live',
      };
    })
    .filter(Boolean)
    .sort(compareMessageOrder);
}

function collectDispatchThreadEntries(messages, requestId) {
  const wantedRequestId = safeRequestId(requestId);
  if (!Array.isArray(messages) || !wantedRequestId) return [];

  return messages
    .map((message) => {
      const context = normalizeMessageContext(message?.context);
      if (requestIdFromMessage(message, context) !== wantedRequestId) return null;

      return {
        messageId: safeString(String(message?.id || message?.message_id || message?.messageId || ''), 200),
        fromAgent: safeAgentName(message?.from_agent || message?.fromAgent || message?.sender_agent),
        subject: safeString(message?.subject, 200),
        body: sanitizeDispatchText(message?.body, MAX_THREAD_BODY_LENGTH),
        status: statusFromMessage(message, context),
        createdAt: safeString(message?.created_at || message?.createdAt, 80),
      };
    })
    .filter(Boolean)
    .sort(compareThreadMessageOrder);
}

function buildDirectDispatchCommand({ scriptPath, agentName, payloadFile, agentBound = false } = {}) {
  const agent = safeAgentName(agentName);
  const script = safeString(scriptPath, 1000);
  const payload = safeString(payloadFile, 1000);
  if (!script) throw new Error('Dispatch script path is required');
  if (!agentBound && !agent) throw new Error('A valid dispatch agent name is required');
  if (!payload) throw new Error('Dispatch payload file is required');
  return `${shellQuote(script)}${agentBound ? '' : ` --agent ${shellQuote(agent)}`} --payload-file ${shellQuote(payload)}`;
}

function cleanupDispatchPayloadDirSync(dir) {
  if (!pendingPayloadDirs.has(dir)) return;
  pendingPayloadDirs.delete(dir);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup only.
  }
}

async function cleanupDispatchPayloadDir(dir) {
  if (!pendingPayloadDirs.has(dir)) return;
  pendingPayloadDirs.delete(dir);
  try {
    await fsp.rm(dir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup only.
  }
}

async function sweepStaleDispatchPayloadDirs(tmpRoot, opts = {}) {
  const staleAfterMs = Number.isFinite(opts.stalePayloadMaxAgeMs) && opts.stalePayloadMaxAgeMs > 0
    ? opts.stalePayloadMaxAgeMs
    : DEFAULT_PAYLOAD_CLEANUP_MS;
  const now = Date.now();
  let entries = [];
  try {
    entries = await fsp.readdir(tmpRoot, { withFileTypes: true });
  } catch {
    return;
  }

  await Promise.all(entries
    .filter(entry => entry.isDirectory() && entry.name.startsWith(DISPATCH_PAYLOAD_DIR_PREFIX))
    .map(async (entry) => {
      const dir = path.join(tmpRoot, entry.name);
      try {
        const stat = await fsp.stat(dir);
        if (now - stat.mtimeMs > staleAfterMs) {
          await fsp.rm(dir, { recursive: true, force: true });
        }
      } catch {
        // Best-effort cleanup only.
      }
    }));
}

function sweepStaleDispatchPayloadDirsOnce(tmpRoot, opts = {}) {
  const rootKey = path.resolve(tmpRoot);
  if (!payloadSweepPromises.has(rootKey)) {
    payloadSweepPromises.set(rootKey, sweepStaleDispatchPayloadDirs(rootKey, opts));
  }
  return payloadSweepPromises.get(rootKey);
}

function installPayloadCleanupHandlers() {
  if (payloadCleanupHandlersInstalled || typeof process === 'undefined') return;
  payloadCleanupHandlersInstalled = true;
  const cleanupAll = () => {
    for (const dir of [...pendingPayloadDirs]) {
      cleanupDispatchPayloadDirSync(dir);
    }
  };
  process.once('beforeExit', cleanupAll);
  process.once('exit', cleanupAll);
}

function schedulePayloadCleanup(dir, opts = {}) {
  pendingPayloadDirs.add(dir);
  installPayloadCleanupHandlers();
  const cleanupAfterMs = Number.isFinite(opts.cleanupAfterMs) && opts.cleanupAfterMs > 0
    ? opts.cleanupAfterMs
    : DEFAULT_PAYLOAD_CLEANUP_MS;
  const timer = setTimeout(() => {
    cleanupDispatchPayloadDir(dir);
  }, cleanupAfterMs);
  timer.unref?.();
  return cleanupAfterMs;
}

async function createDispatchPayloadFile(input = {}, opts = {}) {
  const request = buildDispatchRequest(input);
  const tmpRoot = opts.tmpDir || os.tmpdir();
  await sweepStaleDispatchPayloadDirsOnce(tmpRoot, opts);
  const dir = await fsp.mkdtemp(path.join(tmpRoot, DISPATCH_PAYLOAD_DIR_PREFIX));
  const filePath = path.join(dir, `${request.agentName}-${request.requestId}.txt`);
  await fsp.writeFile(filePath, request.body, { mode: 0o600 });
  const cleanupAfterMs = schedulePayloadCleanup(dir, opts);

  return {
    request,
    filePath,
    cleanupAfterMs,
    command: input.scriptPath
      ? buildDirectDispatchCommand({
        scriptPath: input.scriptPath,
        agentName: request.agentName,
        payloadFile: filePath,
        agentBound: input.agentBound === true,
      })
      : '',
  };
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fsp.readFile(filePath, 'utf-8'));
  } catch {
    return {};
  }
}

async function readNockCCConfig(store) {
  const configured = {
    apiKey: safeString(store?.get?.('nockccApiKey'), 500),
    baseUrl: safeString(store?.get?.('nockccUrl'), 1000) || 'https://cc.nocktechnologies.io',
  };
  if (configured.apiKey) return configured;

  const fileConfig = await readJsonIfExists(path.join(os.homedir(), '.nockcc', 'config.json'));
  return {
    apiKey: safeString(fileConfig.api_key || fileConfig.apiKey, 500),
    baseUrl: safeString(fileConfig.api_url || fileConfig.apiUrl, 1000) || configured.baseUrl,
  };
}

function requestJson({ baseUrl, apiKey }, method, apiPath, body) {
  if (!apiKey) {
    return Promise.reject(new Error('NockCC API key is not configured'));
  }

  let parsed;
  try {
    parsed = buildNockCCUrl(baseUrl, apiPath);
  } catch {
    return Promise.reject(new Error('NockCC URL is invalid'));
  }

  const payload = body === undefined ? '' : JSON.stringify(body);
  const options = {
    method,
    hostname: parsed.hostname,
    port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
    path: parsed.pathname + (parsed.search || ''),
    headers: {
      'X-API-Key': apiKey,
    },
    timeout: 8000,
  };
  if (payload) {
    options.headers['Content-Type'] = 'application/json';
    options.headers['Content-Length'] = Buffer.byteLength(payload);
  }

  return new Promise((resolve, reject) => {
    const transport = parsed.protocol === 'https:' ? https : http;
    let settled = false;
    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const req = transport.request(options, (res) => {
      res.setEncoding('utf8');
      let data = '';
      let responseBytes = 0;
      res.on('data', (chunk) => {
        responseBytes += Buffer.byteLength(chunk);
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
        let json = {};
        try {
          json = data ? JSON.parse(data) : {};
        } catch {
          json = { raw: data };
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(json);
        } else {
          reject(new Error(`NockCC returned HTTP ${res.statusCode}`));
        }
      });
      res.on('error', rejectOnce);
    });
    req.on('error', rejectOnce);
    req.on('timeout', () => {
      req.destroy(new Error('NockCC request timed out'));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

function postJson(config, apiPath, body) {
  return requestJson(config, 'POST', apiPath, body);
}

class AgentDispatchService {
  constructor(store) {
    this._store = store;
  }

  async createPayload(input) {
    return createDispatchPayloadFile(input);
  }

  async sendBrokered(input) {
    const message = buildBrokeredDispatchMessage(input);
    const config = await readNockCCConfig(this._store);
    const response = await postJson(config, '/api/teams/messages/', message);
    const data = response?.data || response || {};
    return {
      ok: true,
      requestId: message.context.request_id,
      messageId: data.id || data.message_id || null,
      broker: message.to_agent,
    };
  }

  async pollStatusUpdates(input = {}) {
    const requestIds = normalizeRequestIds(input.requestIds);
    if (requestIds.length === 0) {
      return {
        success: true,
        agentName: DEFAULT_STATUS_POLL_AGENT,
        checkedMessageCount: 0,
        updates: [],
      };
    }

    const agentName = safeAgentName(input.agentName) || DEFAULT_STATUS_POLL_AGENT;
    const limit = safeLimit(input.limit, 20);
    const params = new URLSearchParams({ limit: String(limit) });
    if (input.unreadOnly === true) params.set('unread', 'true');

    const config = await readNockCCConfig(this._store);
    const response = await requestJson(
      config,
      'GET',
      `/api/teams/messages/inbox/${encodeURIComponent(agentName)}/?${params.toString()}`
    );
    const messages = normalizeMessagesResponse(response);
    return {
      success: true,
      agentName,
      checkedMessageCount: messages.length,
      updates: collectDispatchStatusUpdates(messages, requestIds),
    };
  }

  async getDispatchThread(input = {}) {
    const requestId = safeRequestId(typeof input === 'string' ? input : input.requestId);
    const agentName = safeAgentName(input.agentName) || DEFAULT_STATUS_POLL_AGENT;
    const limit = safeLimit(input.limit, 100);
    if (!requestId) {
      return {
        success: true,
        requestId: '',
        agentName,
        checkedMessageCount: 0,
        thread: [],
      };
    }

    const params = new URLSearchParams({ limit: String(limit) });
    const config = await readNockCCConfig(this._store);
    const response = await requestJson(
      config,
      'GET',
      `/api/teams/messages/inbox/${encodeURIComponent(agentName)}/?${params.toString()}`
    );
    const messages = normalizeMessagesResponse(response);
    return {
      success: true,
      requestId,
      agentName,
      checkedMessageCount: messages.length,
      thread: collectDispatchThreadEntries(messages, requestId),
    };
  }
}

module.exports = {
  AgentDispatchService,
  buildBrokeredDispatchMessage,
  buildDirectDispatchCommand,
  collectDispatchThreadEntries,
  collectDispatchStatusUpdates,
  createDispatchPayloadFile,
  sanitizeDispatchText,
};
