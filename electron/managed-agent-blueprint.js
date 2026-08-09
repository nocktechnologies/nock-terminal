'use strict';

const crypto = require('node:crypto');
const path = require('node:path');

const AGENT_ID_RE = /^[a-z][a-z0-9-]{1,63}$/;
const CONSOLE_PROTOCOL_HASH = 'sha256:ffe01b4ff0d1161dba51540843b159146bdfdaf801149f5fdcb68256e27a7b6c';
const AUTH_PLACEHOLDER = 'authfp:00000000000000000000000000000000';
const DEFAULT_MODEL = 'claude-opus-4-8[1m]';
const PLIST_LABEL_PREFIX = 'io.nock.terminal.resident.';
const MAX_ROOTS = 16;
const MAX_TEXT_LENGTH = 8192;

const PERMISSION_PRESETS = Object.freeze({
  supervised: 'manual',
  standard: 'acceptEdits',
  autonomous: 'bypassPermissions',
});

const SUPPORTED_MODELS = Object.freeze([
  DEFAULT_MODEL,
  'claude-opus-4-6',
  'claude-sonnet-4-5',
  'claude-sonnet-4-20250514',
  'claude-3-7-sonnet-latest',
  'claude-3-5-haiku-latest',
]);

class ManagedAgentError extends Error {
  constructor(message, code = 'MANAGED_AGENT_ERROR') {
    super(message);
    this.name = 'ManagedAgentError';
    this.code = code;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isAbsolute(value) {
  return typeof value === 'string' && path.isAbsolute(value);
}

function isWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function boundedText(value, field, { max = MAX_TEXT_LENGTH, required = false, multiline = false } = {}) {
  if (typeof value !== 'string') {
    if (!required && (value === undefined || value === null)) return '';
    throw new ManagedAgentError(`${field} must be a string`, 'VALIDATION_ERROR');
  }
  const normalized = value.trim();
  if (required && !normalized) throw new ManagedAgentError(`${field} is required`, 'VALIDATION_ERROR');
  const invalidCharacters = multiline
    ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/
    : /[\u0000-\u001F\u007F]/;
  if (normalized.length > max || invalidCharacters.test(normalized)) {
    throw new ManagedAgentError(`${field} is too long or contains control characters`, 'VALIDATION_ERROR');
  }
  return normalized;
}

function normalizeId(value, field = 'agentId') {
  const id = boundedText(value, field, { max: 64, required: true });
  if (!AGENT_ID_RE.test(id)) throw new ManagedAgentError(`${field} must match ${AGENT_ID_RE}`, 'VALIDATION_ERROR');
  return id;
}

function normalizeRoot(value, field) {
  const root = boundedText(value, field, { max: 2000, required: true });
  if (!isAbsolute(root)) throw new ManagedAgentError(`${field} must be absolute`, 'VALIDATION_ERROR');
  return path.resolve(root);
}

function normalizeRoots(value, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_ROOTS) {
    throw new ManagedAgentError(`${field} must be an array of at most ${MAX_ROOTS} absolute paths`, 'VALIDATION_ERROR');
  }
  return [...new Set(value.map((root, index) => normalizeRoot(root, `${field}[${index}]`)))];
}

function normalizeIdentity(draft) {
  const identity = isPlainObject(draft.identity) ? draft.identity : {};
  return {
    agent: boundedText(draft.agent ?? identity.agent ?? draft.displayName, 'identity.agent', { max: 120, required: true }),
    role: boundedText(draft.role ?? identity.role ?? 'Local coding agent', 'identity.role', { max: 160, required: true }),
    partner: boundedText(draft.partner ?? identity.partner ?? 'Local operator', 'identity.partner', { max: 160, required: true }),
    authority: boundedText(draft.authority ?? identity.authority ?? 'Work only within the configured workspace roots.', 'identity.authority', { max: 240, required: true }),
  };
}

function normalizeDraft(draft, { agentId, defaultWorkDirectory, supportedModels = SUPPORTED_MODELS } = {}) {
  if (!isPlainObject(draft)) throw new ManagedAgentError('agent draft must be an object', 'VALIDATION_ERROR');
  const requestedId = draft.agentId ?? draft.id;
  const id = agentId || normalizeId(requestedId);
  if (agentId && requestedId !== undefined && normalizeId(requestedId) !== agentId) {
    throw new ManagedAgentError('agent id and residence cannot be changed', 'IMMUTABLE_ID');
  }
  const displayName = boundedText(draft.displayName ?? draft.name ?? id, 'displayName', { max: 120, required: true });
  const model = boundedText(draft.model ?? DEFAULT_MODEL, 'model', { max: 120, required: true });
  if (!supportedModels.includes(model)) {
    throw new ManagedAgentError(`model ${model} is not supported by the managed Claude template`, 'VALIDATION_ERROR');
  }
  const permissionPreset = boundedText(draft.permissionPreset ?? draft.permissions?.preset ?? 'standard', 'permissionPreset', { max: 32, required: true }).toLowerCase();
  if (!Object.hasOwn(PERMISSION_PRESETS, permissionPreset)) {
    throw new ManagedAgentError('permissionPreset must be supervised, standard, or autonomous', 'VALIDATION_ERROR');
  }

  const workspace = isPlainObject(draft.workspaces) ? draft.workspaces : {};
  const workDirectory = normalizeRoot(draft.workDirectory || workspace.workDirectory || defaultWorkDirectory, 'workDirectory');
  const configuredRoots = normalizeRoots(draft.allowedRoots ?? draft.workspaceRoots ?? workspace.allowedRoots, 'allowedRoots');
  const allowedRoots = [...new Set([workDirectory, ...configuredRoots])];
  const deniedRoots = normalizeRoots(draft.deniedRoots ?? workspace.deniedRoots, 'deniedRoots');

  return {
    id,
    displayName,
    model,
    permissionPreset,
    workDirectory,
    allowedRoots,
    deniedRoots,
    identity: normalizeIdentity({ ...draft, displayName }),
    purpose: boundedText(draft.purpose, 'purpose', { max: 500, multiline: true }),
  };
}

function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=+@,-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, "'\\''")}'`;
}

function posixCommand(argv) {
  return argv.map(shellQuote).join(' ');
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function plistString(value) {
  return `<string>${xmlEscape(value)}</string>`;
}

function plistArray(values) {
  return `<array>${values.map(plistString).join('')}</array>`;
}

function pythonString(value) {
  if (value === undefined) return '';
  if (value === null) return 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  return String(value);
}

function authFingerprint(status) {
  if (!isPlainObject(status)) throw new ManagedAgentError('auth status must be an object', 'AUTH_STATUS_INVALID');
  const material = ['authMethod', 'apiProvider', 'orgId', 'subscriptionType']
    .map(field => pythonString(status[field]))
    .join('|');
  return `authfp:${crypto.createHash('sha256').update(material).digest('hex').slice(0, 32)}`;
}

function sanitizeAuthStatus(status) {
  return {
    loggedIn: status?.loggedIn === true,
    authIdentity: authFingerprint(status || {}),
  };
}

function buildMetadata(draft, paths, { createdAt = new Date().toISOString(), previous, authIdentity = AUTH_PLACEHOLDER, status = 'needs_auth' } = {}) {
  return {
    schemaVersion: 1,
    managed: true,
    id: draft.id,
    displayName: draft.displayName,
    template: 'claude-code-tmux-resident',
    status,
    createdAt: previous?.createdAt || createdAt,
    creation: previous?.creation || { source: 'nock-terminal-agent-console-v1' },
    residence: paths.residence,
    runtime: {
      adapter: 'claude-code-interactive',
      model: draft.model,
      authMode: 'subscription-max',
      authIdentity,
    },
    identity: draft.identity,
    purpose: draft.purpose,
    permissionPreset: draft.permissionPreset,
    permissions: {
      defaultMode: PERMISSION_PRESETS[draft.permissionPreset],
      allowedRoots: draft.allowedRoots,
      deniedRoots: draft.deniedRoots,
    },
    workspaces: {
      workDirectory: draft.workDirectory,
      allowedRoots: draft.allowedRoots,
      deniedRoots: draft.deniedRoots,
    },
    paths: {
      manifest: paths.manifest,
      configDir: paths.configDir,
      controlSocket: paths.controlSocket,
      tmuxSocket: paths.tmuxSocket,
      tmuxSession: paths.tmuxSession,
      launchdPlist: paths.plist,
    },
  };
}

function buildManifest(draft, paths, probes, authIdentity) {
  return {
    agent: draft.id,
    home: paths.residence,
    work_dir: draft.workDirectory,
    state_dir: paths.stateDir,
    runtime: {
      adapter: 'claude-code-interactive',
      binary: probes.claude.path,
      binary_version: probes.claude.version,
      model: draft.model,
      auth_mode: 'subscription-max',
      auth_identity: authIdentity,
    },
    config_dir: paths.configDir,
    tmux: { socket: paths.tmuxSocket, session: paths.tmuxSession },
    control_socket: paths.controlSocket,
    capsule_command: [probes.runtimePython.path, paths.capsuleCompiler],
    channels: { console: { protocol_hash: CONSOLE_PROTOCOL_HASH } },
    workspaces: { allowed_roots: draft.allowedRoots, denied_roots: draft.deniedRoots },
    restart_policy: { max_restarts: 5, window_s: 3600, backoff_s: 15 },
    presence_dir: paths.presenceDir,
    outbox_journal: paths.outboxJournal,
    capsule_source_root: paths.residence,
  };
}

function buildSettings(permissionPreset) {
  return { permissions: { defaultMode: PERMISSION_PRESETS[permissionPreset] } };
}

function buildCapsuleSource(metadata) {
  const summarize = roots => {
    const value = roots.join(', ');
    return value.length <= 1800 ? value : `${value.slice(0, 1790)}...`;
  };
  const lines = [
    `# ${metadata.displayName}`,
    '',
    `agent: ${metadata.identity.agent}`,
    `role: ${metadata.identity.role}`,
    `partner: ${metadata.identity.partner}`,
    `authority: ${metadata.identity.authority}`,
    '',
    'This identity capsule belongs to a Nock-managed local resident seat.',
    `The seat may operate only within these allowed workspace roots: ${summarize(metadata.workspaces.allowedRoots)}`,
    metadata.workspaces.deniedRoots.length
      ? `Denied workspace roots: ${summarize(metadata.workspaces.deniedRoots)}`
      : 'No additional denied workspace roots were configured.',
    metadata.purpose ? `Purpose: ${metadata.purpose}` : 'Purpose: local coding work under operator control.',
    '',
    'Use the configured Claude runtime and keep actions legible to the operator. Treat this file and the generated manifest as residence-owned configuration.',
  ];
  let source = `${lines.join('\n')}\n`;
  if (Buffer.byteLength(source, 'utf8') < 256) {
    source += 'The resident control plane uses a dedicated tmux session, a manifest-declared control socket, and bounded workspace scope.\n';
  }
  return source;
}

function buildCapsuleCompiler() {
  return `#!/usr/bin/env python3
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
METADATA = ROOT / "nock-agent.json"
SOURCE = ROOT / "identity" / "agent.md"

def value(identity, field, source):
    candidate = identity.get(field)
    if isinstance(candidate, str) and candidate.strip():
        return candidate.strip()
    for line in source.splitlines():
        prefix = field + ":"
        if line.lower().startswith(prefix):
            found = line[len(prefix):].strip()
            if found:
                return found
    return "Local coding agent" if field == "role" else "Local operator" if field == "partner" else "Work only within the configured workspace roots."

metadata = json.loads(METADATA.read_text(encoding="utf-8"))
source = SOURCE.read_text(encoding="utf-8")
identity_source = metadata.get("identity") if isinstance(metadata.get("identity"), dict) else {}
identity = {field: value(identity_source, field, source) for field in ("agent", "role", "partner", "authority")}
digest = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
print(json.dumps({
    "identity": identity,
    "text": source,
    "sections": [{"name": "identity/agent.md", "source_file": str(SOURCE), "source_sha256": digest, "bytes": len(SOURCE.read_bytes())}],
}, separators=(",", ":")))
`;
}

function buildWrapper(engineRoot, runtimePython, paths) {
  return `#!/bin/sh
set -u
receipt=${shellQuote(paths.supervisorState)}
rm -f "$receipt"
if cd ${shellQuote(engineRoot)}; then
  ${shellQuote(runtimePython)} -m runtime.seat --manifest ${shellQuote(paths.manifest)}
  status=$?
else
  status=78
fi
umask 077
tmp="${'$'}{receipt}.${'$'}$"
timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '{"exitCode":%s,"recordedAt":"%s"}\n' "$status" "$timestamp" > "$tmp"
mv -f "$tmp" "$receipt"
case "$status" in
  3|78) exit 0 ;;
  *) exit "$status" ;;
esac
`;
}

function buildLaunchdPlist(label, paths, engineRoot, runtimePython, tmuxPath, claudePath) {
  const runtimeDirectories = [runtimePython, tmuxPath, claudePath]
    .filter(Boolean)
    .map(binary => path.dirname(binary));
  const pathEntries = [...new Set([...runtimeDirectories, '/usr/bin', '/bin'])];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>${plistString(label)}
  <key>ProgramArguments</key>${plistArray([paths.wrapper])}
  <key>WorkingDirectory</key>${plistString(engineRoot)}
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key>${plistString(pathEntries.join(path.delimiter))}</dict>
  <key>KeepAlive</key>
  <dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key>${plistString(paths.stdoutLog)}
  <key>StandardErrorPath</key>${plistString(paths.stderrLog)}
</dict>
</plist>
`;
}

module.exports = {
  AGENT_ID_RE,
  AUTH_PLACEHOLDER,
  CONSOLE_PROTOCOL_HASH,
  DEFAULT_MODEL,
  MAX_ROOTS,
  MAX_TEXT_LENGTH,
  ManagedAgentError,
  PERMISSION_PRESETS,
  PLIST_LABEL_PREFIX,
  SUPPORTED_MODELS,
  authFingerprint,
  boundedText,
  buildCapsuleCompiler,
  buildCapsuleSource,
  buildLaunchdPlist,
  buildManifest,
  buildMetadata,
  buildSettings,
  buildWrapper,
  isAbsolute,
  isPlainObject,
  isWithin,
  normalizeDraft,
  normalizeId,
  normalizeRoots,
  posixCommand,
  sanitizeAuthStatus,
  shellQuote,
};
