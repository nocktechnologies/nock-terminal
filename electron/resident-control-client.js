'use strict';

const net = require('node:net');
const { ManagedAgentError, isPlainObject } = require('./managed-agent-blueprint');

const MAX_FRAME_BYTES = 1_048_576;

class ResidentControlClient {
  constructor({ socketFactory = net, timeoutMs = 2500 } = {}) {
    this.socketFactory = socketFactory;
    this.timeoutMs = Math.max(100, timeoutMs);
  }

  send(socketPath, action, params, requestId) {
    const payload = `${JSON.stringify({ id: requestId, action, params })}\n`;
    if (Buffer.byteLength(payload, 'utf8') > MAX_FRAME_BYTES) {
      throw new ManagedAgentError('control request exceeds the resident frame limit', 'CONTROL_FRAME_TOO_LARGE');
    }

    return new Promise((resolve, reject) => {
      let socket;
      let response = Buffer.alloc(0);
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { socket?.destroy(); } catch {}
        if (error) reject(error); else resolve(value);
      };
      const fail = (message, code) => finish(new ManagedAgentError(message, code));
      const timer = setTimeout(() => fail('resident control request timed out', 'CONTROL_TIMEOUT'), this.timeoutMs);

      try {
        socket = this.socketFactory.createConnection({ path: socketPath });
        socket.setTimeout?.(this.timeoutMs);
        socket.once('connect', () => {
          try { socket.write(payload); } catch (error) { fail(`resident control write failed: ${error.message}`, 'CONTROL_IO_ERROR'); }
        });
        socket.on('data', chunk => {
          response = Buffer.concat([response, Buffer.from(chunk)]);
          if (response.length > MAX_FRAME_BYTES) {
            fail('resident control response exceeds the frame limit', 'CONTROL_FRAME_TOO_LARGE');
            return;
          }
          const newline = response.indexOf(0x0a);
          if (newline < 0) return;
          try {
            const frame = JSON.parse(response.subarray(0, newline).toString('utf8'));
            if (!isPlainObject(frame) || frame.id !== requestId) throw new Error('invalid response');
            finish(null, frame);
          } catch {
            fail('resident control response was not valid for this request', 'CONTROL_PROTOCOL_ERROR');
          }
        });
        socket.once('timeout', () => fail('resident control request timed out', 'CONTROL_TIMEOUT'));
        socket.once('error', error => fail(`resident control connection failed: ${error.message}`, 'CONTROL_UNREACHABLE'));
        socket.once('close', () => {
          if (!settled) fail('resident control closed before a response', 'CONTROL_PROTOCOL_ERROR');
        });
      } catch (error) {
        fail(`resident control connection failed: ${error.message}`, 'CONTROL_UNREACHABLE');
      }
    });
  }
}

module.exports = { ResidentControlClient };
