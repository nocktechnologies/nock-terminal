const OSC_52_PREFIXES = ['\x1b]52;', '\x9d52;'];
const OSC_52_REDACTION = '[OSC 52 clipboard request redacted]';

class TerminalOutputRedactor {
  constructor() {
    this.candidate = '';
    this.redactingOsc52 = false;
    this.escapePending = false;
  }

  redact(data) {
    const chunk = typeof data === 'string' ? data : String(data);
    let output = '';

    for (const character of chunk) {
      if (this.redactingOsc52) {
        if (character === '\x07' || character === '\x9c') {
          this.redactingOsc52 = false;
          this.escapePending = false;
        } else if (this.escapePending) {
          if (character === '\\') {
            this.redactingOsc52 = false;
            this.escapePending = false;
          } else {
            this.escapePending = character === '\x1b';
          }
        } else if (character === '\x1b') {
          this.escapePending = true;
        }
        continue;
      }

      if (this.candidate) {
        this.candidate += character;
      } else if (character === '\x1b' || character === '\x9d') {
        this.candidate = character;
      } else {
        output += character;
        continue;
      }

      const isCompletePrefix = OSC_52_PREFIXES.includes(this.candidate);
      const isPartialPrefix = OSC_52_PREFIXES.some(prefix => prefix.startsWith(this.candidate));
      if (isCompletePrefix) {
        this.candidate = '';
        this.redactingOsc52 = true;
        this.escapePending = false;
        output += OSC_52_REDACTION;
      } else if (!isPartialPrefix) {
        const restartAt = Math.max(
          this.candidate.lastIndexOf('\x1b'),
          this.candidate.lastIndexOf('\x9d'),
        );
        if (restartAt > 0) {
          output += this.candidate.slice(0, restartAt);
          this.candidate = this.candidate.slice(restartAt);
        } else {
          output += this.candidate;
          this.candidate = '';
        }
      }
    }

    return output;
  }
}

module.exports = TerminalOutputRedactor;
