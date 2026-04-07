const fs = require('fs');
const path = require('path');

class SessionHistory {
  constructor(store) {
    this.store = store;
    this.dir = path.join(process.env.APPDATA || process.env.HOME, 'nock-terminal', 'sessions');
    this.activeSessions = new Map(); // tabId -> { metadata, buffer, bufferSize }
    this.MAX_SESSIONS = 100;
    this.MAX_BUFFER_SIZE = 2 * 1024 * 1024; // 2MB cap
    this._ensureDir();
  }

  _ensureDir() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
    } catch (err) {
      console.error('SessionHistory: failed to create sessions dir:', err.message);
    }
  }

  _safeFilename(startTime, tabId) {
    const safeTime = String(startTime).replace(/[\/\\:*?"<>|]/g, '-');
    const safeTab = String(tabId).replace(/[\/\\:*?"<>|]/g, '-');
    return `${safeTime}-${safeTab}`;
  }

  startSession(tabId, metadata) {
    const session = {
      metadata: {
        ...metadata,
        tabId,
        startTime: Date.now(),
        endTime: null,
        exitCode: null,
      },
      buffer: [],
      bufferSize: 0,
    };
    this.activeSessions.set(tabId, session);
    return session.metadata;
  }

  appendOutput(tabId, data) {
    if (!this.store.get('autoCaptureSessions')) return;

    const session = this.activeSessions.get(tabId);
    if (!session) return;

    // Cap buffer at 2MB to prevent memory issues
    if (session.bufferSize >= this.MAX_BUFFER_SIZE) return;

    const chunk = typeof data === 'string' ? data : String(data);
    const chunkSize = Buffer.byteLength(chunk, 'utf8');

    if (session.bufferSize + chunkSize > this.MAX_BUFFER_SIZE) {
      // Truncate to fit remaining space
      const remaining = this.MAX_BUFFER_SIZE - session.bufferSize;
      session.buffer.push(chunk.slice(0, remaining));
      session.bufferSize = this.MAX_BUFFER_SIZE;
    } else {
      session.buffer.push(chunk);
      session.bufferSize += chunkSize;
    }
  }

  endSession(tabId, exitCode) {
    const session = this.activeSessions.get(tabId);
    if (!session) return;

    session.metadata.endTime = Date.now();
    session.metadata.exitCode = exitCode ?? null;

    const prefix = this._safeFilename(session.metadata.startTime, tabId);
    const metaPath = path.join(this.dir, `${prefix}.json`);
    const outputPath = path.join(this.dir, `${prefix}.txt`);

    try {
      fs.writeFileSync(metaPath, JSON.stringify(session.metadata, null, 2), 'utf8');
    } catch (err) {
      console.error('SessionHistory: failed to write metadata:', err.message);
    }

    if (session.buffer.length > 0) {
      try {
        fs.writeFileSync(outputPath, session.buffer.join(''), 'utf8');
      } catch (err) {
        console.error('SessionHistory: failed to write output:', err.message);
      }
    }

    this.activeSessions.delete(tabId);
    this._prune();
  }

  list() {
    try {
      const files = fs.readdirSync(this.dir)
        .filter(f => f.endsWith('.json'))
        .sort()
        .reverse()
        .slice(0, this.MAX_SESSIONS);

      return files.map(f => {
        try {
          const raw = fs.readFileSync(path.join(this.dir, f), 'utf8');
          const meta = JSON.parse(raw);
          // Check if a matching .txt file exists
          const txtFile = f.replace(/\.json$/, '.txt');
          meta.hasOutput = fs.existsSync(path.join(this.dir, txtFile));
          return meta;
        } catch {
          return null;
        }
      }).filter(Boolean);
    } catch (err) {
      console.error('SessionHistory: failed to list sessions:', err.message);
      return [];
    }
  }

  getOutput(startTime, tabId) {
    const prefix = this._safeFilename(startTime, tabId);
    const outputPath = path.join(this.dir, `${prefix}.txt`);
    try {
      return fs.readFileSync(outputPath, 'utf8');
    } catch {
      return null;
    }
  }

  _prune() {
    try {
      const jsonFiles = fs.readdirSync(this.dir)
        .filter(f => f.endsWith('.json'))
        .sort()
        .reverse();

      if (jsonFiles.length <= this.MAX_SESSIONS) return;

      const toDelete = jsonFiles.slice(this.MAX_SESSIONS);
      for (const f of toDelete) {
        const baseName = f.replace(/\.json$/, '');
        try { fs.unlinkSync(path.join(this.dir, `${baseName}.json`)); } catch { /* ignore */ }
        try { fs.unlinkSync(path.join(this.dir, `${baseName}.txt`)); } catch { /* ignore */ }
      }
    } catch (err) {
      console.error('SessionHistory: prune failed:', err.message);
    }
  }
}

module.exports = SessionHistory;
