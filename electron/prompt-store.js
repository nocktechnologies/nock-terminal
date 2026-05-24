const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROMPT_SCHEMA_VERSION = 1;

class PromptStore {
  constructor() {
    this.dir = path.join(
      process.env.APPDATA || process.env.HOME,
      'nock-terminal',
      'prompts'
    );
    this._ensureDir();
  }

  _ensureDir() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
    } catch (err) {
      if (err.code !== 'EEXIST') {
        console.error('[PromptStore] Failed to create prompts dir:', err.message);
      }
    }
  }

  _safePath(id) {
    const safe = String(id).replace(/[\/\\\.]+/g, '').slice(0, 50);
    if (!safe) throw new Error('Invalid prompt ID');
    const resolved = path.join(this.dir, `${safe}.md`);
    if (!resolved.startsWith(this.dir)) throw new Error('Path traversal blocked');
    return resolved;
  }

  _parseFrontmatter(content) {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match) {
      return { schemaVersion: 0, title: 'Untitled', tags: [], updatedAt: null, body: content };
    }

    const frontmatter = match[1];
    const body = match[2];
    const meta = { schemaVersion: 0, title: 'Untitled', tags: [], updatedAt: null };

    for (const line of frontmatter.split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();

      if (key === 'title') {
        meta.title = value || 'Untitled';
      } else if (key === 'tags') {
        meta.tags = value
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);
      } else if (key === 'updatedAt') {
        meta.updatedAt = value;
      } else if (key === 'schemaVersion') {
        const version = Number(value);
        meta.schemaVersion = Number.isFinite(version) ? version : 0;
      }
    }

    return { ...meta, body };
  }

  _serialize({ title, tags, body, updatedAt, schemaVersion = PROMPT_SCHEMA_VERSION }) {
    const resolvedUpdatedAt = updatedAt || new Date().toISOString();
    const tagStr = Array.isArray(tags) ? tags.join(', ') : (tags || '');
    return `---\nschemaVersion: ${schemaVersion}\ntitle: ${title || 'Untitled'}\ntags: ${tagStr}\nupdatedAt: ${resolvedUpdatedAt}\n---\n${body || ''}`;
  }

  _normalizePrompt(parsed, fallbackUpdatedAt) {
    return {
      schemaVersion: PROMPT_SCHEMA_VERSION,
      title: typeof parsed.title === 'string' && parsed.title ? parsed.title : 'Untitled',
      tags: Array.isArray(parsed.tags)
        ? parsed.tags.filter((tag) => typeof tag === 'string' && tag.trim()).map((tag) => tag.trim())
        : [],
      updatedAt: typeof parsed.updatedAt === 'string' && parsed.updatedAt
        ? parsed.updatedAt
        : fallbackUpdatedAt,
      body: typeof parsed.body === 'string' ? parsed.body : '',
    };
  }

  _readAndMigratePrompt(filePath) {
    let fd;
    let raw;
    let fallbackUpdatedAt;
    try {
      fd = fs.openSync(filePath, 'r');
      fallbackUpdatedAt = fs.fstatSync(fd).mtime.toISOString();
      raw = fs.readFileSync(fd, 'utf8');
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }

    const parsed = this._parseFrontmatter(raw);
    const normalized = this._normalizePrompt(parsed, fallbackUpdatedAt);
    const migratedContent = this._serialize(normalized);

    if (raw !== migratedContent) {
      try {
        fs.writeFileSync(filePath, migratedContent, 'utf8');
      } catch (err) {
        console.error('[PromptStore] Failed to persist migrated prompt:', err.message);
      }
    }

    return normalized;
  }

  list() {
    try {
      const files = fs.readdirSync(this.dir).filter((f) => f.endsWith('.md'));
      const prompts = [];

      for (const file of files) {
        try {
          const parsed = this._readAndMigratePrompt(path.join(this.dir, file));
          prompts.push({
            id: file.replace(/\.md$/, ''),
            schemaVersion: parsed.schemaVersion,
            title: parsed.title,
            tags: parsed.tags,
            updatedAt: parsed.updatedAt,
            body: parsed.body,
          });
        } catch (parseErr) {
          console.error('[PromptStore] Skipping corrupt file:', file, parseErr.message);
        }
      }

      // Sort by updatedAt descending (newest first)
      prompts.sort((a, b) => {
        const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return dateB - dateA;
      });

      return prompts;
    } catch (err) {
      console.error('[PromptStore] Error listing prompts:', err.message);
      return [];
    }
  }

  get(id) {
    const filePath = this._safePath(id);
    try {
      const parsed = this._readAndMigratePrompt(filePath);
      return { id, ...parsed };
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('[PromptStore] Error reading prompt:', err.message);
      }
      return null;
    }
  }

  save(id, { title, tags, body }) {
    const promptId = id || crypto.randomBytes(6).toString('hex');
    const filePath = this._safePath(promptId);
    const content = this._serialize({ title, tags, body, schemaVersion: PROMPT_SCHEMA_VERSION });

    try {
      fs.writeFileSync(filePath, content, 'utf8');
      return { success: true, id: promptId };
    } catch (err) {
      console.error('[PromptStore] Error saving prompt:', err.message);
      return { success: false, message: err.message };
    }
  }

  delete(id) {
    const filePath = this._safePath(id);
    try {
      fs.unlinkSync(filePath);
      return { success: true };
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('[PromptStore] Error deleting prompt:', err.message);
        return { success: false, message: err.message };
      }
      return { success: true };
    }
  }
}

PromptStore.SCHEMA_VERSION = PROMPT_SCHEMA_VERSION;

module.exports = PromptStore;
