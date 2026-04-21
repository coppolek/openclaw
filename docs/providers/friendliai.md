---
title: "FriendliAI"
summary: "FriendliAI setup (auth + model selection)"
read_when:
  - You want to use FriendliAI with OpenClaw
  - You need the FriendliAI API key env var or default model id
---

# FriendliAI

[FriendliAI](https://friendli.ai) provides serverless inference for popular open-weight models through an OpenAI-compatible API. OpenClaw includes a bundled FriendliAI provider plugin.

| Property      | Value                                   |
| ------------- | --------------------------------------- |
| Provider      | `friendliai`                            |
| Auth          | `FRIENDLIAI_API_KEY`                    |
| API           | OpenAI-compatible chat/completions      |
| Base URL      | `https://api.friendli.ai/serverless/v1` |
| Default model | `friendliai/zai-org/GLM-5.1`            |

## Getting started

<Steps>
  <Step title="Set up FriendliAI auth through onboarding">
    ```bash
    openclaw onboard --auth-choice friendliai-api-key
    ```

    This stores your FriendliAI API key in OpenClaw config and sets GLM-5.1 as the default model.

  </Step>
  <Step title="Verify the model is available">
    ```bash
    openclaw models list --provider friendliai
    ```
  </Step>
</Steps>

## Non-interactive example

For scripted or CI setups, pass all values on the command line:

```bash
openclaw onboard --non-interactive \
  --mode local \
  --auth-choice friendliai-api-key \
  --friendliai-api-key "$FRIENDLIAI_API_KEY" \
  --skip-health \
  --accept-risk
```

## Built-in catalog

Pricing is per 1M tokens (input / cached input / output).

| Model ref                                       | Name                     | Input | Context | Max output | Cost (in/out per 1M) |
| ----------------------------------------------- | ------------------------ | ----- | ------- | ---------- | -------------------- |
| `friendliai/meta-llama/Llama-3.3-70B-Instruct`  | Llama 3.3 70B Instruct   | text  | 131,072 | 131,072    | $0.60 / $0.60        |
| `friendliai/meta-llama/Llama-3.1-8B-Instruct`   | Llama 3.1 8B Instruct    | text  | 131,072 | 8,000      | $0.10 / $0.10        |
| `friendliai/deepseek-ai/DeepSeek-V3.2`          | DeepSeek V3.2            | text  | 163,840 | 163,840    | $0.50 / $1.50        |
| `friendliai/MiniMaxAI/MiniMax-M2.5`             | MiniMax M2.5             | text  | 196,608 | 196,608    | $0.30 / $1.20        |
| `friendliai/Qwen/Qwen3-235B-A22B-Instruct-2507` | Qwen3 235B A22B Instruct | text  | 262,144 | 262,144    | $0.20 / $0.80        |
| `friendliai/zai-org/GLM-5`                      | GLM-5                    | text  | 202,752 | 202,752    | $1.00 / $3.20        |
| `friendliai/zai-org/GLM-5.1`                    | GLM-5.1                  | text  | 202,752 | 202,752    | $1.40 / $4.40        |
| `friendliai/LGAI-EXAONE/K-EXAONE-236B-A23B`     | K-EXAONE 236B A23B       | text  | 262,144 | 262,144    | $0.20 / $0.80        |

<Tip>
FriendliAI publishes new models regularly. You can use any model listed on their platform directly without waiting for a catalog update — just prefix the model id with `friendliai/`.
</Tip>

## Custom FriendliAI model ids

OpenClaw accepts dynamic FriendliAI model ids. Use the exact model id shown on the FriendliAI platform and prefix it with `friendliai/`.

```json5
{
  agents: {
    defaults: {
      model: {
        primary: "friendliai/zai-org/GLM-5.1",
      },
    },
  },
}
```

<AccordionGroup>
  <Accordion title="How model id prefixing works">
    Every FriendliAI model ref in OpenClaw starts with `friendliai/` followed by the exact model id from the FriendliAI platform. For example:

    - `friendliai/zai-org/GLM-5.1`
    - `friendliai/deepseek-ai/DeepSeek-V3.2`
    - `friendliai/Qwen/Qwen3-235B-A22B-Instruct-2507`

    OpenClaw strips the `friendliai/` prefix when building the API request and sends the remaining path to the FriendliAI endpoint.

  </Accordion>

  <Accordion title="Environment note">
    If the Gateway runs outside your interactive shell, make sure `FRIENDLIAI_API_KEY` is available to that process too.

    <Warning>
    A token sitting only in `~/.profile` will not help a launchd/systemd daemon unless that environment is imported there as well. Set the token in `~/.openclaw/.env` or via `env.shellEnv` to ensure the gateway process can read it.
    </Warning>

  </Accordion>
</AccordionGroup>

## Related

<CardGroup cols={2}>
  <Card title="Model selection" href="/concepts/model-providers" icon="layers">
    Choosing providers, model refs, and failover behavior.
  </Card>
  <Card title="Troubleshooting" href="/help/troubleshooting" icon="wrench">
    General troubleshooting and FAQ.
  </Card>
</CardGroup>
