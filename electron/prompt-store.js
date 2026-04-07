const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

  _parseFrontmatter(content) {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match) {
      return { title: 'Untitled', tags: [], updatedAt: null, body: content };
    }

    const frontmatter = match[1];
    const body = match[2];
    const meta = { title: 'Untitled', tags: [], updatedAt: null };

    for (const line of frontmatter.split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();

      if (key === 'title') {
        meta.title = value;
      } else if (key === 'tags') {
        meta.tags = value
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);
      } else if (key === 'updatedAt') {
        meta.updatedAt = value;
      }
    }

    return { ...meta, body };
  }

  _serialize({ title, tags, body }) {
    const updatedAt = new Date().toISOString();
    const tagStr = Array.isArray(tags) ? tags.join(', ') : (tags || '');
    return `---\ntitle: ${title || 'Untitled'}\ntags: ${tagStr}\nupdatedAt: ${updatedAt}\n---\n${body || ''}`;
  }

  list() {
    try {
      const files = fs.readdirSync(this.dir).filter((f) => f.endsWith('.md'));
      const prompts = [];

      for (const file of files) {
        try {
          const raw = fs.readFileSync(path.join(this.dir, file), 'utf8');
          const parsed = this._parseFrontmatter(raw);
          prompts.push({
            id: file.replace(/\.md$/, ''),
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
    const filePath = path.join(this.dir, `${id}.md`);
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = this._parseFrontmatter(raw);
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
    const filePath = path.join(this.dir, `${promptId}.md`);
    const content = this._serialize({ title, tags, body });

    try {
      fs.writeFileSync(filePath, content, 'utf8');
      return { success: true, id: promptId };
    } catch (err) {
      console.error('[PromptStore] Error saving prompt:', err.message);
      return { success: false, message: err.message };
    }
  }

  delete(id) {
    const filePath = path.join(this.dir, `${id}.md`);
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

module.exports = PromptStore;
