const OSC_52_REDACTION = '[OSC 52 clipboard request redacted]';
const OSC_IDENTIFIER_LIMIT = 64;
const OSC_TERMINATORS = new Set(['\x07', '\x18', '\x1a', '\x9c']);

function isIgnoredOscControl(character) {
  const code = character.charCodeAt(0);
  return code <= 0x17 || code === 0x19 || (code >= 0x1c && code <= 0x1f);
}

function isC1Control(character) {
  const code = character.charCodeAt(0);
  return code >= 0x80 && code <= 0x9f;
}

class TerminalOutputRedactor {
  constructor() {
    this.state = 'text';
    this.oscIntroducer = '';
    this.oscIdentifier = '';
    this.oscIdentifierOverflow = false;
    this.osc52Match = 'zeros';
  }

  redact(data) {
    const chunk = typeof data === 'string' ? data : String(data);
    let output = '';

    for (const character of chunk) {
      let reprocess = true;

      while (reprocess) {
        reprocess = false;

        if (this.state === 'text') {
          if (character === '\x1b') {
            this.state = 'escape';
          } else if (character === '\x9d') {
            this._startOscIdentifier('\x9d');
          } else {
            output += character;
          }
          continue;
        }

        if (this.state === 'escape') {
          if (character === ']') {
            this._startOscIdentifier('\x1b]');
          } else {
            output += '\x1b';
            this.state = 'text';
            reprocess = true;
          }
          continue;
        }

        if (this.state === 'osc-identifier') {
          if (isIgnoredOscControl(character)) {
            continue;
          } else if (character >= '0' && character <= '9') {
            this._appendOscIdentifier(character);
          } else if (character === ';') {
            if (this.osc52Match === 'fifty-two') {
              output += OSC_52_REDACTION;
              this.state = 'osc-52';
            } else {
              output += `${this._capturedOscIdentifier()};`;
              this.state = 'text';
            }
          } else {
            output += this._capturedOscIdentifier();
            this.state = 'text';
            reprocess = true;
          }
          continue;
        }

        if (this.state === 'osc-52') {
          if (OSC_TERMINATORS.has(character)) {
            this.state = 'text';
          } else if (character === '\x1b') {
            this.state = 'osc-52-escape';
          } else if (isC1Control(character)) {
            this.state = 'text';
            reprocess = true;
          }
          continue;
        }

        if (this.state === 'osc-52-escape') {
          if (character === '\\') {
            this.state = 'text';
          } else if (OSC_TERMINATORS.has(character)) {
            this.state = 'text';
          } else {
            // A non-ST ESC aborts OSC and starts a new terminal sequence.
            this.state = 'escape';
            reprocess = true;
          }
        }
      }
    }

    return output;
  }

  _startOscIdentifier(introducer) {
    this.state = 'osc-identifier';
    this.oscIntroducer = introducer;
    this.oscIdentifier = '';
    this.oscIdentifierOverflow = false;
    this.osc52Match = 'zeros';
  }

  _appendOscIdentifier(digit) {
    if (this.oscIdentifier.length < OSC_IDENTIFIER_LIMIT) {
      this.oscIdentifier += digit;
    } else {
      this.oscIdentifierOverflow = true;
    }

    if (this.osc52Match === 'zeros') {
      if (digit === '5') this.osc52Match = 'five';
      else if (digit !== '0') this.osc52Match = 'other';
    } else if (this.osc52Match === 'five') {
      this.osc52Match = digit === '2' ? 'fifty-two' : 'other';
    } else if (this.osc52Match === 'fifty-two') {
      this.osc52Match = 'other';
    }
  }

  _capturedOscIdentifier() {
    const overflow = this.oscIdentifierOverflow ? '[identifier truncated]' : '';
    return `${this.oscIntroducer}${this.oscIdentifier}${overflow}`;
  }
}

module.exports = TerminalOutputRedactor;
