const http = require('http');
const https = require('https');

class OllamaClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl || 'http://localhost:11434';
  }

  setUrl(url) {
    this.baseUrl = url;
  }

  async checkStatus() {
    try {
      const response = await this._fetch('/api/tags', 'GET');
      return { connected: true, models: response.models || [] };
    } catch {
      return { connected: false, models: [] };
    }
  }

  async listModels() {
    try {
      const response = await this._fetch('/api/tags', 'GET');
      return (response.models || []).map(m => ({
        name: m.name,
        size: m.size,
        parameterSize: m.details?.parameter_size || '',
        quantization: m.details?.quantization_level || '',
        family: m.details?.family || '',
        contextLength: m.details?.context_length || null,
      }));
    } catch {
      return [];
    }
  }

  async chat(model, messages, onChunk) {
    return new Promise((resolve, reject) => {
      const url = new URL('/api/chat', this.baseUrl);
      const transport = url.protocol === 'https:' ? https : http;

      const body = JSON.stringify({
        model,
        messages,
        stream: true,
      });

      const req = transport.request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      }, (res) => {
        let fullResponse = '';
        let buffer = '';

        res.on('data', (chunk) => {
          buffer += chunk.toString();
          // Process complete JSON lines
          const lines = buffer.split('\n');
          buffer = lines.pop(); // Keep incomplete line in buffer

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line);
              if (parsed.message?.content) {
                fullResponse += parsed.message.content;
                if (onChunk) {
                  onChunk(parsed.message.content);
                }
              }
              if (parsed.done) {
                resolve({
                  success: true,
                  content: fullResponse,
                  model,
                  totalDuration: parsed.total_duration,
                });
              }
            } catch {
              // Skip malformed JSON
            }
          }
        });

        res.on('end', () => {
          // Process remaining buffer
          if (buffer.trim()) {
            try {
              const parsed = JSON.parse(buffer);
              if (parsed.message?.content) {
                fullResponse += parsed.message.content;
                if (onChunk) onChunk(parsed.message.content);
              }
            } catch {
              // Skip
            }
          }
          if (!fullResponse && res.statusCode !== 200) {
            reject(new Error(`Ollama returned status ${res.statusCode}`));
          } else {
            resolve({ success: true, content: fullResponse, model });
          }
        });

        res.on('error', reject);
      });

      req.on('error', (err) => {
        reject(new Error(`Ollama connection failed: ${err.message}`));
      });

      req.write(body);
      req.end();
    });
  }

  async _fetch(path, method, body) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.baseUrl);
      const transport = url.protocol === 'https:' ? https : http;

      const req = transport.request(url, { method }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        });
        res.on('error', reject);
      });

      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }
}

module.exports = OllamaClient;
