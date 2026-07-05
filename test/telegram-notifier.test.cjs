const test = require('node:test');
const assert = require('node:assert/strict');

const TelegramNotifier = require('../electron/telegram-notifier');
const { formatSessionEndedDetail } = TelegramNotifier;

test('formatSessionEndedDetail names the project from the cwd basename', () => {
  assert.equal(formatSessionEndedDetail('/Users/kevin/Dev/nock-terminal', 0), 'nock-terminal (exit 0)');
  assert.equal(formatSessionEndedDetail('/Users/kevin/Dev/nock-terminal/', 1), 'nock-terminal (exit 1)');
  assert.equal(formatSessionEndedDetail('C:\\Users\\kevin\\Dev\\app', 130), 'app (exit 130)');
});

test('formatSessionEndedDetail omits the exit code when it is null/unknown', () => {
  assert.equal(formatSessionEndedDetail('/tmp/project', null), 'project');
  assert.equal(formatSessionEndedDetail('/tmp/project', undefined), 'project');
});

test('formatSessionEndedDetail falls back to "terminal" without a cwd', () => {
  assert.equal(formatSessionEndedDetail(null, 0), 'terminal (exit 0)');
  assert.equal(formatSessionEndedDetail('', 1), 'terminal (exit 1)');
});

test('shouldNotify gates session_ended on the per-event toggle and enablement', () => {
  const store = new Map([
    ['telegramEnabled', true],
    ['telegramBotToken', 'token'],
    ['telegramChatId', 'chat'],
    ['telegramQuietStart', ''],
    ['telegramQuietEnd', ''],
    ['telegramNotifySessionEnded', true],
  ]);
  const notifier = new TelegramNotifier({ get: (k) => store.get(k) });

  assert.equal(notifier.shouldNotify('session_ended'), true);

  store.set('telegramNotifySessionEnded', false);
  assert.equal(notifier.shouldNotify('session_ended'), false);

  store.set('telegramNotifySessionEnded', true);
  store.set('telegramEnabled', false);
  assert.equal(notifier.shouldNotify('session_ended'), false);
});
