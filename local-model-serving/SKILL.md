---
name: local-model-serving
description: Select and run the right local LLM engine (MLX with speculative decoding vs llama.cpp) with the right settings for a task, and enforce the one-engine-at-a-time memory rule. Use whenever a task runs local inference against an OpenAI-compatible endpoint — evals, summarization, code review, content generation — or when choosing between local engines serving the same model.
---

# Local Model Serving

Use this skill whenever a task needs local LLM inference on this machine.
It is engine- and model-generic: the measured numbers come from a
Qwen3.8-27B-class dense model (8-bit, ~28-30 GB resident) on a 128 GB
Apple Silicon Mac, but the decision rules and settings transfer to any
model served by the same two engine families.

## The Two Engine Families (same model, two backends)

| | MLX + speculative decoding (e.g. mlx-dspark) | llama.cpp (e.g. LM Studio) |
| --- | --- | --- |
| Model file | MLX 8-bit (e.g. `mlx-community/…-8bit`) + drafter | GGUF Q8_0 (e.g. `lmstudio-community/…-GGUF`) |
| Port | e.g. `http://127.0.0.1:8080/v1` | e.g. `http://127.0.0.1:1234/v1` |
| Context | model native (e.g. 262,144) | model native |
| Thinking-off knob | `"enable_thinking": false` | `"reasoning_effort": "none"` |
| Short-context decode | **~1.7-2.2× faster** (measured) | baseline |
| Long-context (100k+) | slower (spec-decode verify rounds double the huge-KV cost) | **~1.9× faster decode, ~linear prefill** |

Both are OpenAI-compatible (`/v1/chat/completions`), so the same client code
works against either — only the base URL and the thinking-off parameter
differ.

Drafters (DSpark, DFlash 2, and similar speculative-decoding heads) are
**modes of the MLX family**, not a third engine. Do not install NVIDIA-only
stacks (SGLang, vLLM) or a third MLX GUI to A/B a drafter. A better drafter
can raise short-context decode; it does not remove the long-context
crossover, because every verify round still walks the full KV. Use the
drafter the local serving policy or helper names. llama.cpp may be LM Studio
or `llama-server`; that is still the same family.

## First: The Memory Rule (crash prevention)

**Never run both engines with a model resident at the same time.** On a
128 GB machine, two resident 28 GB models plus the OS drove the system into
~20-46 GB of swap and crushed both engines' throughput (a long run was
aborted, another finished at half speed). The same exclusivity rule applies
on a 64 GB machine that can fit only one ~28 GB model. Each engine fits
alone; both do not.

- Stop the other engine before starting one:
  `lms unload <identifier>` / `lms unload all`, or
  `pkill -f "mlx-dspark serve"` (or the equivalent for your server).
- Wrap `start`/`stop` in a small helper that refuses the second engine
  unless it unloads the first — mechanical enforcement beats discipline.

## Decision Rule

| Prompt | Engine | Why |
| --- | --- | --- |
| Short (≤ ~100k tokens), decode-heavy | **MLX + spec decode** | 1.7-2.2× faster decode, same quality |
| Long (≥ ~100k tokens) | **llama.cpp** | faster decode, ~linear prefill scaling, better retrieval at depth |
| Code review of huge diffs | **llama.cpp** if local; prefer a cloud model for quality-critical | 100k+ contexts; local 27B-class models miss subtle defect classes |

Rule of thumb: **short in, long out → MLX spec-decode; long in → llama.cpp.**

## Settings (pinned, per engine)

- **Context:** use the model's native window (e.g. 262,144) unless the task
  explicitly needs less.
- **Thinking: pin it off** unless the task is reasoning-specific. Default
  thinking produces reasoning-only/truncated output in structured pipelines.
  The knob name differs per engine — using the wrong one silently does
  nothing, so verify with a smoke call.
- **Reproducible runs (evals):** temperature `0` (greedy), and compare runs
  only within one engine + quant — Q8_0 vs int8 and sampler differences
  shift scores.
- **Realistic generation (Qwen3.8 documented defaults):** temp `0.7`,
  top_p `0.80`, top_k `20`, presence_penalty `1.5`.

## Known Workload Mapping

| Task | Engine | Notes |
| --- | --- | --- |
| Eval / judge sweeps (many short prompts) | MLX spec-decode | pin the engine for the whole baseline |
| Summarization of short/mid text (strict JSON) | MLX spec-decode, re-verify the schema first | schema quirks differ per engine |
| Summarization of long documents (100k+) | llama.cpp | long-context winner |
| Code review of huge PRs | cloud (or llama.cpp if local) | token-hungry; local = minutes at best, hours worst-case |
| Content generation / filling objects | MLX spec-decode | decode-heavy short prompts — biggest win |

## Verify The Engine Is Actually Serving

Smoke-test before a batch run — confirm reachability **and** that thinking is
off (the wrong knob is the classic silent failure):

```bash
curl -s http://127.0.0.1:<port>/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"<model-id>","messages":[{"role":"user","content":"Say OK"}],
       "max_tokens":8,"<thinking-off-knob>":<value>}'
```

## Closeout

- **Unload when done** (`lms unload` / stop the server process) so memory
  returns for the other engine or other workloads on the same machine.
- If a run produced a new measurement or decision (quality delta, throughput,
  engine crossover), record it in your repository's knowledge base with the
  exact setup so it is reproducible — single-run anecdotes are signal, not
  proof.
