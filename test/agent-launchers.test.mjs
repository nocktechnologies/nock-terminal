import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AGENT_FOLDER_ID,
  buildLauncherTargets,
  getProfileCommand,
  resolveDefaultAgentId,
  resolveSessionLaunch,
  sanitizeStagedTerminalInput,
} from '../src/utils/agentLaunchers.mjs';

const project = {
  id: 'dev:/Users/kevin/Dev/nock-terminal',
  kind: 'project',
  name: 'nock-terminal',
  path: '/Users/kevin/Dev/nock-terminal',
  branch: 'main',
  status: 'active',
};

const agent = {
  id: 'agent:/Users/kevin/Dev/claude-remote-manager/agents/mira',
  kind: 'agent',
  name: 'Mira',
  path: '/Users/kevin/Dev/claude-remote-manager/agents/mira',
  status: 'active',
  agent: { name: 'mira', lifecycle: 'idle', model: 'claude-opus-4-6' },
  launch: { command: 'mira', cwd: '/Users/kevin/Dev/claude-remote-manager/agents/mira' },
};

test('resolves profile default agents and command overrides', () => {
  assert.equal(resolveDefaultAgentId({ defaultAgent: 'codex' }), 'codex');
  assert.equal(resolveDefaultAgentId({ defaultAgent: 'bogus' }), 'claude');
  assert.equal(getProfileCommand({ codexCommand: 'codex --model gpt-5.4' }, 'codex'), 'codex --model gpt-5.4');
  assert.equal(getProfileCommand({}, 'gemini'), 'gemini');
});

test('resolves project and agent-folder launches', () => {
  assert.deepEqual(
    resolveSessionLaunch(project, { defaultAgent: 'gemini' }),
    {
      agentId: 'gemini',
      label: 'Gemini CLI',
      shortLabel: 'Gemini',
      command: 'gemini',
      cwd: '/Users/kevin/Dev/nock-terminal',
      title: 'nock-terminal (Gemini)',
      disabledReason: '',
    }
  );

  const agentLaunch = resolveSessionLaunch(agent, {});
  assert.equal(agentLaunch.agentId, AGENT_FOLDER_ID);
  assert.equal(agentLaunch.command, 'mira');
  assert.equal(agentLaunch.cwd, agent.launch.cwd);
});

test('builds launcher targets from session and profile search fields', () => {
  const targets = buildLauncherTargets([project, agent], {
    [project.path]: { defaultAgent: 'codex', notes: 'private alpha cockpit' },
  }, 'alpha codex');

  assert.equal(targets.length, 1);
  assert.equal(targets[0].session.name, 'nock-terminal');
  assert.equal(targets[0].defaultAgentId, 'codex');
});

test('sanitizes staged terminal input without submitting shell newlines', () => {
  assert.equal(
    sanitizeStagedTerminalInput(' fix the bug\nthen run tests\tplease\u0007 '),
    'fix the bug then run tests please'
  );
});
