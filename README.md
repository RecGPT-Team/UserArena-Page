# UserArena

Anonymous project page for **UserArena: Benchmarking Interactive User Simulation for Long-Horizon Shopping Agents**. This repository contains the static benchmark website for double-blind review.

## GitHub Pages

Upload the contents of this directory to the root of a repository on the `main` branch, including `.github/workflows/pages.yml`. In **Settings → Pages → Build and deployment**, select **GitHub Actions**. Run **Deploy UserArena to GitHub Pages** from the Actions tab for the first deployment; later pushes to `main` deploy automatically.

No package installation or Node.js build is required. The workflow publishes the HTML, CSS, JavaScript, data, and assets directly. Relative resource paths support both root and project Pages URLs.

## Local preview

From this directory, run:

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

Then open `http://127.0.0.1:4173/`. An HTTP server is required for loading the JSON data.

## Content

- `index.html` and `styles.css`: page content and presentation.
- `js/`: browser interactions and the approved anonymous-link policy.
- `data/`: public example trajectories, the standardized LLM leaderboard, the paper's leaderboard snapshot, and resource links.
- `assets/`: presentation screenshots and self-hosted fonts with their licenses.

The Code links point to the anonymous research repository: https://anonymous.4open.science/r/UserArena-D877.

Screenshots are anonymized English presentation reconstructions. Product imagery was retouched and displayed prices follow a presentation scaling rule. The annotation image is a partial interface example. The trajectory explorer is a recorded demonstration; hosted environments and community submissions are not yet available.

The website leaderboard contains only the standardized SOTA LLM track. Every ranked model receives the same OPTD instruction and evaluation inputs for its setting, uses the same environment and action budget, and is scored with the released L0--L4 pipeline. Exact provider model identifiers, evaluation dates, accepted request parameters, and failures must be reported. No model-specific prompting, tools, memory, retrieval, self-correction, or fallback predictions are allowed. `data/llm-leaderboard.json` is intentionally empty until complete evaluation reports are available; do not add placeholder scores.

The historical paper snapshot remains archived in `data/leaderboard.json` and is not loaded or displayed by the website. No composite score is defined. Font copyright notices identify third-party font creators and are retained under the SIL Open Font License.

## Importing an LLM evaluation

Do not type leaderboard scores by hand. Import one complete Replay report and one complete Rollout report produced by the same model snapshot and metric version:

```sh
node scripts/import-llm-result.mjs \
  --leaderboard data/llm-leaderboard.json \
  --setting single \
  --model "REPLACE_DISPLAY_NAME" \
  --provider "REPLACE_PROVIDER" \
  --snapshot "REPLACE_EXACT_PROVIDER_MODEL_ID" \
  --evaluated-at "YYYY-MM-DD" \
  --replay /path/to/replay/report.json \
  --rollout /path/to/rollout/report.json \
  --request-params /path/to/public-request-parameters.json
```

The importer rejects missing metrics, mixed metric versions, duplicate snapshots, and request-parameter files containing credential-like fields. It records report hashes, coverage, and rollout failure counts with the displayed scores.

The 2026-10-18 evaluation round covers single-session GPT, Claude, Gemini, and Qwen routes. Results remain pending until complete Replay and Rollout reports pass the importer. Import requires matching model/config identity and full prediction/session coverage. The official `rollout_failures.failed` value is used directly. Evaluation execution does not publish or push this site.

`data/evaluation-status.json` records timestamped progress for the seven authorized model routes, separately from verified scores. Paused and incomplete runs are never ranked. The current website has no paper-baseline or cross-session leaderboard switch.
