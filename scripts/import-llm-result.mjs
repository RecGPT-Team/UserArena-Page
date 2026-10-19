#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SECRET_KEY = /(api[-_]?key|authorization|access[-_]?token|password|secret)/i;

function parseArgs(values) {
  const args = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    if (!key?.startsWith('--') || values[index + 1] === undefined) {
      throw new Error(`expected --name value, received ${key || 'end of input'}`);
    }
    args[key.slice(2)] = values[index + 1];
  }
  return args;
}

function value(report, key) {
  const metric = report?.headline?.[key]?.value;
  if (!Number.isFinite(metric)) throw new Error(`report is missing finite headline.${key}.value`);
  return metric;
}

function nested(object, path) {
  return path.reduce((node, key) => node?.[key], object);
}

function finiteNested(object, path, label) {
  const result = nested(object, path);
  if (!Number.isFinite(result)) throw new Error(`report is missing finite ${label}`);
  return result;
}

function assertNoSecrets(object, path = 'requestParameters') {
  if (!object || typeof object !== 'object') return;
  for (const [key, entry] of Object.entries(object)) {
    if (SECRET_KEY.test(key)) throw new Error(`${path}.${key} looks like a secret and must not be published`);
    assertNoSecrets(entry, `${path}.${key}`);
  }
}

function digest(text) {
  return createHash('sha256').update(text).digest('hex');
}

function failureCount(report) {
  const failures = report?.rollout_failures;
  if (Number.isInteger(failures?.failed) && failures.failed >= 0
      && failures.episodes === report.sim_episodes && failures.failed <= failures.episodes) {
    return failures.failed;
  }
  throw new Error('rollout report is missing the official rollout_failures audit');
}

function coverage(replay, rollout, metadata) {
  const first = replay.llm_track;
  const second = rollout.llm_track;
  if (!first?.config_sha256 || first.config_sha256 !== second?.config_sha256) {
    throw new Error('reports must share an explicit LLM evaluation config');
  }
  for (const track of [first, second]) {
    if (track.snapshot !== metadata.snapshot || track.provider !== metadata.provider
        || track.setting !== metadata.setting || track.prompt_profile !== 'OPTD'
        || JSON.stringify(track.request_parameters) !== JSON.stringify(metadata.requestParameters)) {
      throw new Error('report identity or request parameters differ from import metadata');
    }
  }
  if (!Number.isInteger(replay.steps) || replay.steps <= 0
      || first.coverage?.expected_predictions !== replay.steps
      || first.coverage?.predictions !== replay.steps) {
    throw new Error('Replay prediction coverage is incomplete');
  }
  if (!Number.isInteger(rollout.sim_episodes) || rollout.sim_episodes <= 0
      || second.coverage?.expected_sessions !== rollout.sim_episodes
      || second.coverage?.sessions !== rollout.sim_episodes
      || rollout.real_episodes !== rollout.sim_episodes) {
    throw new Error('Rollout session coverage is incomplete');
  }
  return {
    replayPredictions: replay.steps,
    replayStatesChecked: replay.trace_coverage?.steps_with_state ?? null,
    rolloutRealEpisodes: rollout.real_episodes,
    rolloutSimEpisodes: rollout.sim_episodes,
    rolloutFailures: failureCount(rollout)
  };
}

export function buildEntry({ replay, rollout, metadata, replayText, rolloutText }) {
  if (replay?.paradigm !== 'replay') throw new Error('the replay report must declare paradigm=replay');
  if (rollout?.paradigm !== 'rollout') throw new Error('the rollout report must declare paradigm=rollout');
  if (!replay.metric_definition_version || replay.metric_definition_version !== rollout.metric_definition_version) {
    throw new Error('replay and rollout must use the same explicit metric_definition_version');
  }
  if (!['single', 'cross'].includes(metadata.setting)) throw new Error('setting must be single or cross');
  for (const key of ['model', 'provider', 'snapshot', 'evaluatedAt']) {
    if (!metadata[key]) throw new Error(`${key} is required`);
  }
  assertNoSecrets(metadata.requestParameters);
  const verifiedCoverage = coverage(replay, rollout, metadata);
  return {
    model: metadata.model,
    provider: metadata.provider,
    snapshot: metadata.snapshot,
    evaluatedAt: metadata.evaluatedAt,
    status: 'complete',
    metricDefinitionVersion: replay.metric_definition_version,
    requestParameters: metadata.requestParameters,
    metrics: {
      rva: value(replay, 'valid_action_rate'),
      ova: value(rollout, 'valid_action_rate'),
      f1: value(replay, 'macro_action_f1'),
      accuracy: value(replay, 'macro_exact_action_accuracy'),
      dmJsd: value(rollout, 'action_distribution_divergence'),
      te: finiteNested(rollout, ['diagnostics', 'trajectory_length', 'abs_diff'], 'diagnostics.trajectory_length.abs_diff'),
      pf: value(rollout, 'cohort_conditioned_behavioral_fidelity'),
      ctr: finiteNested(rollout, ['diagnostics', 'l4', 'event_count_rates', 'ctr', 'abs_diff'], 'diagnostics.l4.event_count_rates.ctr.abs_diff'),
      acr: finiteNested(rollout, ['diagnostics', 'l4', 'event_count_rates', 'acr', 'abs_diff'], 'diagnostics.l4.event_count_rates.acr.abs_diff'),
      tJsd: value(rollout, 'terminal_outcome_distribution_divergence')
    },
    coverage: verifiedCoverage,
    provenance: {
      replayReportSha256: digest(replayText),
      rolloutReportSha256: digest(rolloutText)
    }
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const key of ['leaderboard', 'setting', 'model', 'provider', 'snapshot', 'evaluated-at', 'replay', 'rollout', 'request-params']) {
    if (!args[key]) throw new Error(`--${key} is required`);
  }
  const [boardText, replayText, rolloutText, paramsText] = await Promise.all([
    readFile(args.leaderboard, 'utf8'),
    readFile(args.replay, 'utf8'),
    readFile(args.rollout, 'utf8'),
    readFile(args['request-params'], 'utf8')
  ]);
  const board = JSON.parse(boardText);
  const entry = buildEntry({
    replay: JSON.parse(replayText),
    rollout: JSON.parse(rolloutText),
    replayText,
    rolloutText,
    metadata: {
      setting: args.setting,
      model: args.model,
      provider: args.provider,
      snapshot: args.snapshot,
      evaluatedAt: args['evaluated-at'],
      requestParameters: JSON.parse(paramsText)
    }
  });
  const rows = board[args.setting];
  if (!Array.isArray(rows)) throw new Error(`leaderboard has no ${args.setting} collection`);
  const existing = rows.findIndex(row => row.provider === entry.provider && row.snapshot === entry.snapshot);
  if (existing >= 0 && args.replace !== 'true') {
    throw new Error('this provider/snapshot already exists; pass --replace true only after auditing the replacement reports');
  }
  if (existing >= 0) rows[existing] = entry;
  else rows.push(entry);
  board.status = 'active';
  board.updatedAt = new Date().toISOString();
  const destination = resolve(args.leaderboard);
  const temporary = resolve(dirname(destination), `.${destination.split('/').at(-1)}.tmp`);
  await writeFile(temporary, `${JSON.stringify(board, null, 2)}\n`, { flag: 'wx' });
  await rename(temporary, destination);
  process.stdout.write(`Imported ${entry.model} (${args.setting}) with complete L0–L4 metrics.\n`);
}

const currentFile = fileURLToPath(import.meta.url);
if (resolve(process.argv[1] || '') === currentFile) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
