const { execSync } = require('child_process');

class PortScanner {
  constructor() {
    // Common dev server ports to check
    this.knownPorts = [
      { port: 3000, label: 'React/Next.js' },
      { port: 3001, label: 'React (alt)' },
      { port: 4000, label: 'GraphQL' },
      { port: 5000, label: 'Flask/API' },
      { port: 5173, label: 'Vite' },
      { port: 5174, label: 'Vite (alt)' },
      { port: 8000, label: 'Django' },
      { port: 8080, label: 'HTTP Server' },
      { port: 8888, label: 'Jupyter' },
      { port: 11434, label: 'Ollama' },
    ];
  }

  async scan() {
    const activePorts = [];

    try {
      if (process.platform === 'win32') {
        return this._scanWindows();
      }
      return this._scanUnix();
    } catch (err) {
      console.error('Port scan error:', err.message);
      return activePorts;
    }
  }

  _scanWindows() {
    const activePorts = [];
    try {
      const output = execSync('netstat -ano -p TCP', {
        timeout: 5000,
        encoding: 'utf-8',
      });

      const lines = output.split('\n');
      const listening = new Set();

      for (const line of lines) {
        if (line.includes('LISTENING')) {
          const match = line.match(/:(\d+)\s/);
          if (match) {
            listening.add(parseInt(match[1], 10));
          }
        }
      }

      for (const { port, label } of this.knownPorts) {
        if (listening.has(port)) {
          activePorts.push({ port, label, url: `http://localhost:${port}` });
        }
      }
    } catch {
      // netstat may fail
    }
    return activePorts;
  }

  _scanUnix() {
    const activePorts = [];
    try {
      const output = execSync('lsof -iTCP -sTCP:LISTEN -P -n 2>/dev/null || ss -tlnp 2>/dev/null', {
        timeout: 5000,
        encoding: 'utf-8',
      });

      const listening = new Set();
      const portRegex = /:(\d+)\s/g;
      let match;
      while ((match = portRegex.exec(output)) !== null) {
        listening.add(parseInt(match[1], 10));
      }

      for (const { port, label } of this.knownPorts) {
        if (listening.has(port)) {
          activePorts.push({ port, label, url: `http://localhost:${port}` });
        }
      }
    } catch {
      // Command may fail
    }
    return activePorts;
  }
}

module.exports = PortScanner;
