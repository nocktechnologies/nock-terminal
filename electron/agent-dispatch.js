'use strict';

const crypto = require('crypto');
const fsp = require('fs/promises');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');

const DEFAULT_BROKER_AGENT = 'mira-nockos';
const MAX_TASK_LENGTH = 12000;

function safeAgentName(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return /^[a-z0-9_-]{1,100}$/.test(normalized) ? normalized : '';
}

function safeRuntime(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['codex', 'deepseek'].includes(normalized) ? normalized : '';
}

function safeString(value, maxLength = 1000) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function safeRequestId(value) {
  const normalized = String(value || '').trim();
  return /^[A-Za-z0-9_-]{1,120}$/.test(normalized) ? normalized : '';
}

function sanitizeDispatchText(value, maxLength = MAX_TASK_LENGTH) {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLength);
}

function requestId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
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

function buildDirectDispatchCommand({ scriptPath, agentName, payloadFile } = {}) {
  const agent = safeAgentName(agentName);
  const script = safeString(scriptPath, 1000);
  const payload = safeString(payloadFile, 1000);
  if (!script) throw new Error('Dispatch script path is required');
  if (!agent) throw new Error('A valid dispatch agent name is required');
  if (!payload) throw new Error('Dispatch payload file is required');
  return `${shellQuote(script)} --agent ${shellQuote(agent)} --payload-file ${shellQuote(payload)}`;
}

async function createDispatchPayloadFile(input = {}, opts = {}) {
  const request = buildDispatchRequest(input);
  const tmpRoot = opts.tmpDir || os.tmpdir();
  const dir = await fsp.mkdtemp(path.join(tmpRoot, 'nock-dispatch-'));
  const filePath = path.join(dir, `${request.agentName}-${request.requestId}.txt`);
  await fsp.writeFile(filePath, request.body, { mode: 0o600 });

  return {
    request,
    filePath,
    command: input.scriptPath
      ? buildDirectDispatchCommand({
        scriptPath: input.scriptPath,
        agentName: request.agentName,
        payloadFile: filePath,
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

function postJson({ baseUrl, apiKey }, apiPath, body) {
  if (!apiKey) {
    return Promise.reject(new Error('NockCC API key is not configured'));
  }

  let parsed;
  try {
    parsed = new URL(baseUrl.replace(/\/$/, '') + apiPath);
  } catch {
    return Promise.reject(new Error('NockCC URL is invalid'));
  }

  const payload = JSON.stringify(body);
  const options = {
    method: 'POST',
    hostname: parsed.hostname,
    port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
    path: parsed.pathname + (parsed.search || ''),
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      'X-API-Key': apiKey,
    },
    timeout: 8000,
  };

  return new Promise((resolve, reject) => {
    const transport = parsed.protocol === 'https:' ? https : http;
    const req = transport.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
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
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('NockCC request timed out'));
    });
    req.write(payload);
    req.end();
  });
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
}

module.exports = {
  AgentDispatchService,
  buildBrokeredDispatchMessage,
  buildDirectDispatchCommand,
  buildDispatchRequest,
  createDispatchPayloadFile,
  sanitizeDispatchText,
};
