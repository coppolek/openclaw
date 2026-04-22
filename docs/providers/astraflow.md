---
title: "UCloud AstraFlow"
summary: "UCloud AstraFlow setup (auth + model selection)"
read_when:
  - You want to use UCloud AstraFlow with OpenClaw
  - You need the API key env var or CLI auth choice
---

# UCloud AstraFlow

[UCloud AstraFlow](https://astraflow.ucloud-global.com) provides 200+ curated models with an OpenAI-compatible API, available in both global and China endpoints.

| Property | Global                                | China                          |
| -------- | ------------------------------------- | ------------------------------ |
| Provider | `astraflow`                           | `astraflow-cn`                 |
| Auth     | `ASTRAFLOW_API_KEY`                   | `ASTRAFLOW_CN_API_KEY`         |
| API      | OpenAI-compatible                     | OpenAI-compatible              |
| Base URL | `https://api-us-ca.umodelverse.ai/v1` | `https://api.modelverse.cn/v1` |

## Getting started

<Steps>
  <Step title="Get your API key">
    - Global: [astraflow.ucloud-global.com](https://astraflow.ucloud-global.com/en-us/modelverse/api-keys)
    - China: [astraflow.ucloud.cn](https://astraflow.ucloud.cn/modelverse/api-keys)
  </Step>
  <Step title="Run onboarding">
    ```bash
    # Global endpoint
    openclaw onboard --auth-choice astraflow-api-key

    # China endpoint
    openclaw onboard --auth-choice astraflow-cn-api-key
    ```

  </Step>
  <Step title="Verify models are available">
    ```bash
    openclaw models list --provider astraflow
    # or
    openclaw models list --provider astraflow-cn
    ```
  </Step>
</Steps>

<AccordionGroup>
  <Accordion title="Non-interactive setup">
    For scripted or headless installations, pass all flags directly:

    ```bash
    # Global
    openclaw onboard --non-interactive \
      --mode local \
      --auth-choice astraflow-api-key \
      --astraflow-api-key "$ASTRAFLOW_API_KEY" \
      --skip-health \
      --accept-risk

    # China
    openclaw onboard --non-interactive \
      --mode local \
      --auth-choice astraflow-cn-api-key \
      --astraflow-cn-api-key "$ASTRAFLOW_CN_API_KEY" \
      --skip-health \
      --accept-risk
    ```

  </Accordion>
</AccordionGroup>

<Warning>
If the Gateway runs as a daemon (launchd/systemd), make sure `ASTRAFLOW_API_KEY`
or `ASTRAFLOW_CN_API_KEY` is available to that process (for example, in
`~/.openclaw/.env` or via `env.shellEnv`).
</Warning>

<Tip>
Base URLs can be overridden with `ASTRAFLOW_BASE_URL` (default:
`https://api-us-ca.umodelverse.ai/v1`) and `ASTRAFLOW_CN_BASE_URL` (default:
`https://api.modelverse.cn/v1`) for self-hosted or testing deployments.
</Tip>

## Built-in catalog

### Global catalog

| Model ref                       | Name                   | Input       | Context   | Max output |
| ------------------------------- | ---------------------- | ----------- | --------- | ---------- |
| `claude-opus-4-6`               | Claude Opus 4.6        | text, image | 1,000,000 | 128,000    |
| `claude-sonnet-4-6`             | Claude Sonnet 4.6      | text, image | 1,000,000 | 64,000     |
| `claude-haiku-4-5-20251001`     | Claude Haiku 4.5       | text, image | 200,000   | 64,000     |
| `gpt-5.4`                       | GPT-5.4                | text, image | 1,050,000 | 128,000    |
| `gpt-5.4-mini`                  | GPT-5.4 Mini           | text, image | 400,000   | 128,000    |
| `gpt-5.4-nano`                  | GPT-5.4 Nano           | text        | 400,000   | 128,000    |
| `gpt-5.3-chat-latest`           | GPT-5.3 Chat           | text, image | 128,000   | 16,384     |
| `gpt-5.2`                       | GPT-5.2                | text, image | 128,000   | 16,384     |
| `deepseek-ai/DeepSeek-V3.2`     | DeepSeek V3.2          | text        | 131,072   | 8,192      |
| `glm-5.1`                       | GLM 5.1                | text        | 202,800   | 131,100    |
| `glm-5-turbo`                   | GLM 5 Turbo            | text        | 202,800   | 131,100    |
| `glm-5v-turbo`                  | GLM 5V Turbo           | text, image | 202,800   | 131,100    |
| `zai-org/glm-5`                 | GLM 5                  | text        | 202,800   | 131,100    |
| `moonshot/kimi-k2.5`            | Kimi K2.5              | text        | 262,144   | 32,768     |
| `moonshotai/kimi-k2.5`          | Kimi K2.5 (MoonshotAI) | text        | 262,144   | 32,768     |
| `qwen3.6-plus`                  | Qwen 3.6 Plus          | text, image | 1,000,000 | 65,536     |
| `qwen3.5-plus`                  | Qwen 3.5 Plus          | text, image | 1,000,000 | 65,536     |
| `MiniMax-M2.7`                  | MiniMax M2.7           | text, image | 204,800   | 131,072    |
| `MiniMax-M2.7-highspeed`        | MiniMax M2.7 Highspeed | text        | 204,800   | 131,072    |
| `MiniMax-M2.5`                  | MiniMax M2.5           | text        | 204,800   | 131,072    |
| `MiniMax-M2.5-lightning`        | MiniMax M2.5 HighSpeed | text        | 204,800   | 131,072    |
| `gemini-3.1-pro-preview`        | Gemini 3.1 Pro         | text, image | 1,048,576 | 65,536     |
| `gemini-3.1-flash-lite-preview` | Gemini 3.1 Flash Lite  | text, image | 1,048,576 | 65,536     |

### China catalog

The China endpoint excludes Claude, GPT, and Gemini models:

| Model ref                   | Name                   | Input       | Context   | Max output |
| --------------------------- | ---------------------- | ----------- | --------- | ---------- |
| `deepseek-ai/DeepSeek-V3.2` | DeepSeek V3.2          | text        | 131,072   | 8,192      |
| `glm-5.1`                   | GLM 5.1                | text        | 202,800   | 131,100    |
| `glm-5-turbo`               | GLM 5 Turbo            | text        | 202,800   | 131,100    |
| `glm-5v-turbo`              | GLM 5V Turbo           | text, image | 202,800   | 131,100    |
| `zai-org/glm-5`             | GLM 5                  | text        | 202,800   | 131,100    |
| `moonshot/kimi-k2.5`        | Kimi K2.5              | text        | 262,144   | 32,768     |
| `moonshotai/kimi-k2.5`      | Kimi K2.5 (MoonshotAI) | text        | 262,144   | 32,768     |
| `qwen3.6-plus`              | Qwen 3.6 Plus          | text, image | 1,000,000 | 65,536     |
| `qwen3.5-plus`              | Qwen 3.5 Plus          | text, image | 1,000,000 | 65,536     |
| `MiniMax-M2.7`              | MiniMax M2.7           | text, image | 204,800   | 131,072    |
| `MiniMax-M2.7-highspeed`    | MiniMax M2.7 Highspeed | text        | 204,800   | 131,072    |
| `MiniMax-M2.5`              | MiniMax M2.5           | text        | 204,800   | 131,072    |
| `MiniMax-M2.5-lightning`    | MiniMax M2.5 HighSpeed | text        | 204,800   | 131,072    |

## Config example

```json5
{
  env: { ASTRAFLOW_API_KEY: "sk-..." },
  agents: {
    defaults: {
      model: { primary: "astraflow/claude-sonnet-4-6" },
    },
  },
}
```

## Related

<CardGroup cols={2}>
  <Card title="Model selection" href="/concepts/model-providers" icon="layers">
    Choosing providers, model refs, and failover behavior.
  </Card>
  <Card title="Configuration reference" href="/gateway/configuration-reference" icon="gear">
    Full config reference for agents, models, and providers.
  </Card>
</CardGroup>
