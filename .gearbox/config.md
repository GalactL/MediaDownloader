---
specs_dir: docs/engineering/specs
plans_dir: docs/engineering/plans
solutions_dir: docs/solutions
tracker: github
base_branch: main
max_parallel_workers: 3
max_cycles: 3
learning_policy: conditional
token_profile: efficient
quality_profile: standard
result_cache_policy: read-only
execution_mode: delegated-control-plane
orchestrator_product_writes: forbidden
implementation_policy: workers-only
task_review_policy: cross-provider-in-hybrid
post_pr_policy: manual
model_selection: ask-once
model_policy: hybrid
claude_models:
  fast: haiku
  standard: sonnet
  deep: opus
codex_models:
  economy: gpt-6-luna
  standard: gpt-6.1-sol
  frontier: gpt-6-astra
allow_codex_default_model: false
codex_frontier_policy: escalation-or-exceptional
codex_mcp_policy: required-only
hybrid_review_policy: opposite-provider
codex_bin: codex
capability_routing: enabled
capability_preflight: live
web_comp_policy: auto
web_comp_image_model: gpt-image-2.5-flare
web_comp_edit_model: gpt-image-2.5-sunburst
claude_capabilities: []
codex_capabilities:
  - cua_repl
  - node_repl
budget:
  max_worker_dispatches: 10
  max_codex_dispatches: 12
  max_review_dispatches: 14
  max_model_escalations: 3
  max_pr_repair_cycles: 3
risk_policy:
  auth: high
  permissions: high
  billing: high
  destructive_migration: critical
  persistence: high
  concurrency: high
  public_api: medium
human_gate:
  - destructive_migration
  - privilege_change
  - breaking_external_contract
  - production_config
ponytail: preferred
test_commands:
  - cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
  - cmake --build build --config Release --parallel
  - ctest --test-dir build -C Release --output-on-failure
  - node --test extension/test/lib.test.js
check_commands:
  - for f in extension/*.js; do node --check "$f"; done
ui_commands: []
verification_catalog: []
---
