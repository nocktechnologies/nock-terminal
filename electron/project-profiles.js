const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROFILE_SCHEMA_VERSION = 1;

const DEFAULT_PROFILE = {
  defaultAgent: 'claude',
  defaultShell: '',
  shellArgs: '',
  envVars: '',
  claudeCommand: '',
  codexCommand: '',
  geminiCommand: '',
  customAgentCommand: '',
  notes: '',
};

const REMOVED_PROFILE_FIELDS = new Set(['preferredModel', 'systemPrompt']);
const PROFILE_STRING_FIELDS = new Set(Object.keys(DEFAULT_PROFILE));
const VALID_PROFILE_AGENTS = new Set(['claude', 'codex', 'gemini', 'custom']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeProfile(profile = {}) {
  const sanitized = {};
  if (!isPlainObject(profile)) return sanitized;

  for (const [key, value] of Object.entries(profile)) {
    if (PROFILE_STRING_FIELDS.has(key) && typeof value === 'string' && !REMOVED_PROFILE_FIELDS.has(key)) {
      if (key === 'defaultAgent' && !VALID_PROFILE_AGENTS.has(value)) continue;
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function migrateProfileRecord(profile = {}, projectPath) {
  const source = isPlainObject(profile) ? profile : {};
  const migrated = {
    ...DEFAULT_PROFILE,
    ...sanitizeProfile(source),
    schemaVersion: PROFILE_SCHEMA_VERSION,
  };

  const resolvedProjectPath = typeof projectPath === 'string'
    ? projectPath
    : (typeof source.projectPath === 'string' ? source.projectPath : '');
  if (resolvedProjectPath) migrated.projectPath = resolvedProjectPath;
  if (typeof source.updatedAt === 'string') migrated.updatedAt = source.updatedAt;

  return migrated;
}

function recordsEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

class ProjectProfiles {
  constructor() {
    this.dir = path.join(
      process.env.APPDATA || process.env.HOME,
      'nock-terminal',
      'projects'
    );
    this._ensureDir();
  }

  _ensureDir() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
    } catch (err) {
      if (err.code !== 'EEXIST') {
        console.error('[ProjectProfiles] Failed to create profiles dir:', err.message);
      }
    }
  }

  _hash(projectPath) {
    return crypto
      .createHash('md5')
      .update(projectPath.toLowerCase())
      .digest('hex')
      .slice(0, 12);
  }

  _filePath(projectPath) {
    return path.join(this.dir, `${this._hash(projectPath)}.json`);
  }

  _writeMigratedProfile(filePath, data) {
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      console.error('[ProjectProfiles] Failed to persist migrated profile:', err.message);
    }
  }

  get(projectPath) {
    const filePath = this._filePath(projectPath);
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      const migrated = migrateProfileRecord(parsed, projectPath);
      if (!recordsEqual(parsed, migrated)) {
        this._writeMigratedProfile(filePath, migrated);
      }
      return migrated;
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('[ProjectProfiles] Error reading profile:', err.message);
      }
      return migrateProfileRecord({}, projectPath);
    }
  }

  save(projectPath, profile) {
    const filePath = this._filePath(projectPath);
    const data = migrateProfileRecord({
      ...profile,
      projectPath,
      updatedAt: new Date().toISOString(),
    }, projectPath);
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
      return { success: true, data };
    } catch (err) {
      console.error('[ProjectProfiles] Error saving profile:', err.message);
      return { success: false, message: err.message };
    }
  }

  delete(projectPath) {
    const filePath = this._filePath(projectPath);
    try {
      fs.unlinkSync(filePath);
      return { success: true };
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('[ProjectProfiles] Error deleting profile:', err.message);
        return { success: false, message: err.message };
      }
      return { success: true };
    }
  }

  list() {
    try {
      const files = fs.readdirSync(this.dir).filter((f) => f.endsWith('.json'));
      const profiles = [];
      for (const file of files) {
        try {
          const filePath = path.join(this.dir, file);
          const raw = fs.readFileSync(filePath, 'utf8');
          const parsed = JSON.parse(raw);
          const migrated = migrateProfileRecord(parsed);
          if (!recordsEqual(parsed, migrated)) {
            this._writeMigratedProfile(filePath, migrated);
          }
          profiles.push(migrated);
        } catch (parseErr) {
          console.error('[ProjectProfiles] Skipping corrupt file:', file, parseErr.message);
        }
      }
      return profiles;
    } catch (err) {
      console.error('[ProjectProfiles] Error listing profiles:', err.message);
      return [];
    }
  }
}

ProjectProfiles.SCHEMA_VERSION = PROFILE_SCHEMA_VERSION;
ProjectProfiles.DEFAULT_PROFILE = DEFAULT_PROFILE;
ProjectProfiles.migrateProfileRecord = migrateProfileRecord;

module.exports = ProjectProfiles;
