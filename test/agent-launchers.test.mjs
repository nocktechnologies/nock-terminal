import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AGENT_FOLDER_ID,
  DISPATCH_AGENT_ID,
  buildLauncherTargets,
  getProfileCommand,
  resolveDefaultAgentId,
  resolveSessionLaunch,
  sanitizeStagedTerminalInput,
  shouldRunSessionLaunch,
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

const dispatchAgent = {
  id: 'agent:/Users/kevin/Dev/claude-remote-manager/agents/ash',
  kind: 'agent',
  name: 'Ash',
  path: '/Users/kevin/Dev/claude-remote-manager/agents/ash',
  status: 'inactive',
  agent: { name: 'ash', lifecycle: 'dispatch', runtime: 'codex', model: 'o4-mini' },
  launch: {
    mode: 'dispatch',
    canLaunch: true,
    broker: 'mira-nockos',
    dispatcher: 'codex',
    cwd: '/Users/kevin/Dev/claude-remote-manager',
    scriptPath: '/Users/kevin/Dev/claude-remote-manager/core/scripts/dispatch-codex.sh',
    aliasPath: '/Users/kevin/Dev/claude-remote-manager/agents/ash/scripts/dispatch-ash.sh',
    aliasCommand: 'agents/ash/scripts/dispatch-ash.sh',
    directScriptPath: '/Users/kevin/Dev/claude-remote-manager/agents/ash/scripts/dispatch-ash.sh',
    directAgentBound: true,
    commandTemplate: '/Users/kevin/Dev/claude-remote-manager/agents/ash/scripts/dispatch-ash.sh --payload-file <payload-file>',
  },
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
      mode: 'terminal',
      action: 'launch',
      actionLabel: 'Launch',
      capability: 'folder-launch',
      canLaunch: true,
      disabledReason: '',
    }
  );

  const agentLaunch = resolveSessionLaunch(agent, {});
  assert.equal(agentLaunch.agentId, AGENT_FOLDER_ID);
  assert.equal(agentLaunch.command, 'mira');
  assert.equal(agentLaunch.cwd, agent.launch.cwd);
  assert.equal(agentLaunch.mode, 'terminal');
  assert.equal(agentLaunch.action, 'launch');
  assert.equal(agentLaunch.actionLabel, 'Launch');
  assert.equal(agentLaunch.canLaunch, true);
});

test('preserves discovered attach action labels for agent folders', () => {
  const attachAgent = {
    ...agent,
    launch: {
      command: 'tmux attach -t crm-default-mira',
      cwd: agent.path,
      action: 'attach',
      actionLabel: 'Attach',
      capability: 'live-attach',
      canLaunch: true,
    },
  };

  const launch = resolveSessionLaunch(attachAgent, {});

  assert.equal(launch.action, 'attach');
  assert.equal(launch.actionLabel, 'Attach');
  assert.equal(launch.capability, 'live-attach');
});

test('preserves disabled discovered attach launches even when a command is present', () => {
  const attachAgent = {
    ...agent,
    launch: {
      command: 'tmux attach -t crm-default-mira',
      cwd: agent.path,
      action: 'attach',
      actionLabel: 'Attach',
      capability: 'live-attach',
      canLaunch: false,
      disabledReason: 'No live CRM session found',
    },
  };

  const launch = resolveSessionLaunch(attachAgent, {});

  assert.equal(launch.action, 'attach');
  assert.equal(launch.actionLabel, 'Attach');
  assert.equal(launch.capability, 'live-attach');
  assert.equal(launch.command, 'tmux attach -t crm-default-mira');
  assert.equal(launch.canLaunch, false);
  assert.equal(launch.disabledReason, 'No live CRM session found');
});

test('runs attach actions by default but lets folder-open suppress command execution', () => {
  const attachAgent = {
    ...agent,
    launch: {
      command: 'tmux attach -t crm-default-mira',
      cwd: agent.path,
      action: 'attach',
      actionLabel: 'Attach',
      capability: 'live-attach',
      canLaunch: true,
    },
  };

  assert.equal(shouldRunSessionLaunch(attachAgent), true);
  assert.equal(shouldRunSessionLaunch(attachAgent, { openFolderOnly: true }), false);
});

test('does not auto-run plain running agents unless launch is explicit', () => {
  assert.equal(shouldRunSessionLaunch(agent), false);
  assert.equal(shouldRunSessionLaunch(agent, { launchFresh: true }), true);
});

test('never runs disabled launch metadata even when a command is present', () => {
  const disabledAttach = {
    ...agent,
    launch: {
      command: 'tmux attach -t crm-default-mira',
      cwd: agent.path,
      action: 'attach',
      actionLabel: 'Attach',
      capability: 'live-attach',
      canLaunch: false,
      disabledReason: 'No live CRM session found',
    },
  };

  assert.equal(shouldRunSessionLaunch(disabledAttach), false);
  assert.equal(shouldRunSessionLaunch(disabledAttach, { launchFresh: true }), false);
});

test('resolves brokered dispatch agent launches without treating them as terminal commands', () => {
  const launch = resolveSessionLaunch(dispatchAgent, {});

  assert.equal(launch.agentId, DISPATCH_AGENT_ID);
  assert.equal(launch.mode, 'dispatch');
  assert.equal(launch.action, 'dispatch');
  assert.equal(launch.actionLabel, 'Dispatch');
  assert.equal(launch.capability, 'dispatch-request');
  assert.equal(launch.canLaunch, true);
  assert.equal(launch.command, '');
  assert.equal(launch.runtime, 'codex');
  assert.equal(launch.broker, 'mira-nockos');
  assert.equal(launch.aliasCommand, 'agents/ash/scripts/dispatch-ash.sh');
  assert.equal(launch.directAgentBound, true);
  assert.match(launch.commandTemplate, /dispatch-ash\.sh --payload-file <payload-file>/);
});

test('falls back to launch runtime when dispatch agent runtime is blank', () => {
  const blankRuntimeAgent = {
    ...dispatchAgent,
    agent: { ...dispatchAgent.agent, runtime: '   ' },
    launch: { ...dispatchAgent.launch, runtime: 'codex', dispatcher: 'deepseek' },
  };

  const launch = resolveSessionLaunch(blankRuntimeAgent, {});

  assert.equal(launch.runtime, 'codex');
  assert.equal(launch.dispatcher, 'deepseek');
});

test('builds launcher targets from session and profile search fields', () => {
  const targets = buildLauncherTargets([project, agent, dispatchAgent], {
    [project.path]: { defaultAgent: 'codex', notes: 'private alpha cockpit' },
  }, 'alpha codex');

  assert.equal(targets.length, 1);
  assert.equal(targets[0].session.name, 'nock-terminal');
  assert.equal(targets[0].defaultAgentId, 'codex');

  const dispatchTargets = buildLauncherTargets([project, agent, dispatchAgent], {}, 'codex dispatch');
  assert.equal(dispatchTargets.length, 1);
  assert.equal(dispatchTargets[0].session.name, 'Ash');
});

test('does not search removed no-op profile model fields', () => {
  const targets = buildLauncherTargets([project], {
    [project.path]: { preferredModel: 'future-model' },
  }, 'future-model');

  assert.equal(targets.length, 0);
});

test('searches dispatch agents by name and runtime', () => {
  const smithRepo = {
    ...project,
    id: 'dev:/Users/kevin/Dev/nock-command-center-smith-284',
    name: 'nock-command-center-smith-284',
    path: '/Users/kevin/Dev/nock-command-center-smith-284',
  };
  const smith = {
    ...dispatchAgent,
    id: 'agent:/Users/kevin/Dev/claude-remote-manager/agents/smith',
    name: 'Smith',
    path: '/Users/kevin/Dev/claude-remote-manager/agents/smith',
    agent: { name: 'smith', lifecycle: 'dispatch', runtime: 'deepseek', model: 'deepseek-v4-pro' },
    launch: {
      ...dispatchAgent.launch,
      dispatcher: 'deepseek',
      runtime: 'deepseek',
      scriptPath: '/Users/kevin/Dev/claude-remote-manager/core/scripts/dispatch-deepseek.sh',
      aliasPath: '',
      aliasCommand: 'dispatch-deepseek.sh --agent smith',
      directScriptPath: '/Users/kevin/Dev/claude-remote-manager/core/scripts/dispatch-deepseek.sh',
      directAgentBound: false,
      commandTemplate: '/Users/kevin/Dev/claude-remote-manager/core/scripts/dispatch-deepseek.sh --agent smith --payload-file <payload-file>',
    },
  };

  assert.equal(buildLauncherTargets([smithRepo, dispatchAgent, smith], {}, 'smith')[0].session.name, 'Smith');
  assert.equal(buildLauncherTargets([dispatchAgent, smith], {}, 'deepseek dispatch')[0].session.name, 'Smith');
});

test('sanitizes staged terminal input without submitting shell newlines', () => {
  assert.equal(
    sanitizeStagedTerminalInput(' fix the bug\nthen run tests\tplease\u0007 '),
    'fix the bug then run tests please'
  );
});
