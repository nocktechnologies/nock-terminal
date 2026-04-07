const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_PROFILE = {
  preferredModel: '',
  systemPrompt: '',
  defaultShell: '',
  envVars: '',
  claudeCommand: '',
  notes: '',
};

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

  get(projectPath) {
    const filePath = this._filePath(projectPath);
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_PROFILE, ...parsed, projectPath };
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('[ProjectProfiles] Error reading profile:', err.message);
      }
      return { ...DEFAULT_PROFILE, projectPath };
    }
  }

  save(projectPath, profile) {
    const filePath = this._filePath(projectPath);
    const data = {
      ...DEFAULT_PROFILE,
      ...profile,
      projectPath,
      updatedAt: new Date().toISOString(),
    };
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
          const raw = fs.readFileSync(path.join(this.dir, file), 'utf8');
          profiles.push(JSON.parse(raw));
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

module.exports = ProjectProfiles;
