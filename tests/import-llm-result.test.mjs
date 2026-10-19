import assert from 'node:assert/strict';
import test from 'node:test';

import { buildEntry } from '../scripts/import-llm-result.mjs';

function metric(value) {
  return { value };
}

function reports() {
  const replay = {
    paradigm: 'replay',
    steps: 100,
    metric_definition_version: 'userarena-metrics-test',
    headline: {
      valid_action_rate: metric(0.98),
      macro_action_f1: metric(0.42),
      macro_exact_action_accuracy: metric(0.31)
    }
  };
  const rollout = {
    paradigm: 'rollout',
    metric_definition_version: 'userarena-metrics-test',
    real_episodes: 100,
    sim_episodes: 100,
    rollout_failures: { episodes: 100, failed: 2, failure_rate: 0.02, failed_without_steps: 1, failed_by_error: { parse: 2 } },
    headline: {
      valid_action_rate: metric(0.97),
      action_distribution_divergence: metric(0.03),
      cohort_conditioned_behavioral_fidelity: metric(0.88),
      terminal_outcome_distribution_divergence: metric(0.04)
    },
    diagnostics: {
      trajectory_length: { abs_diff: 0.7 },
      l4: { event_count_rates: { ctr: { abs_diff: 0.02 }, acr: { abs_diff: 0.05 } } }
    }
  };
  const track = { config_sha256: 'fixed-config-hash', snapshot: 'example-model-2026-10-17',
    provider: 'Example provider', setting: 'single', prompt_profile: 'OPTD',
    request_parameters: { max_tokens: 512, temperature: null } };
  replay.llm_track = { ...track, coverage: { expected_predictions: 100, predictions: 100 } };
  rollout.llm_track = { ...track, coverage: { expected_sessions: 100, sessions: 100 } };
  return { replay, rollout };
}

test('buildEntry imports a complete Replay and Rollout pair', () => {
  const { replay, rollout } = reports();
  const entry = buildEntry({
    replay,
    rollout,
    replayText: JSON.stringify(replay),
    rolloutText: JSON.stringify(rollout),
    metadata: {
      setting: 'single',
      model: 'Example model',
      provider: 'Example provider',
      snapshot: 'example-model-2026-10-17',
      evaluatedAt: '2026-10-17',
      requestParameters: { max_tokens: 512, temperature: null }
    }
  });
  assert.deepEqual(entry.metrics, {
    rva: 0.98, ova: 0.97, f1: 0.42, accuracy: 0.31, dmJsd: 0.03,
    te: 0.7, pf: 0.88, ctr: 0.02, acr: 0.05, tJsd: 0.04
  });
  assert.equal(entry.coverage.rolloutFailures, 2);
  assert.equal(entry.coverage.replayPredictions, 100);
  assert.match(entry.provenance.replayReportSha256, /^[0-9a-f]{64}$/);
});

test('buildEntry rejects partial coverage and mismatched model identities', () => {
  const { replay, rollout } = reports();
  const metadata = { setting: 'single', model: 'Example model', provider: 'Example provider',
    snapshot: 'example-model-2026-10-17', evaluatedAt: '2026-10-17',
    requestParameters: { max_tokens: 512, temperature: null } };
  const build = () => buildEntry({ replay, rollout, metadata, replayText: '{}', rolloutText: '{}' });
  replay.llm_track.coverage.predictions = 99;
  assert.throws(build, /prediction coverage is incomplete/);
  replay.llm_track.coverage.predictions = 100;
  rollout.llm_track.snapshot = 'different-model';
  assert.throws(build, /identity or request parameters differ/);
});

test('buildEntry rejects mixed metric versions and credential fields', () => {
  const { replay, rollout } = reports();
  rollout.metric_definition_version = 'different-version';
  assert.throws(() => buildEntry({
    replay, rollout, replayText: '{}', rolloutText: '{}',
    metadata: { setting: 'single', model: 'M', provider: 'P', snapshot: 'S', evaluatedAt: '2026-10-17', requestParameters: {} }
  }), /same explicit metric_definition_version/);
  rollout.metric_definition_version = replay.metric_definition_version;
  assert.throws(() => buildEntry({
    replay, rollout, replayText: '{}', rolloutText: '{}',
    metadata: { setting: 'single', model: 'M', provider: 'P', snapshot: 'S', evaluatedAt: '2026-10-17', requestParameters: { api_key: 'never publish this' } }
  }), /looks like a secret/);
});
