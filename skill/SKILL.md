---
name: image-gen
description: Use the globally installed `image` CLI for Gemini image-generation tasks, including prompt-based generation, reference images, global settings, and agent-friendly JSON output.
---

# Image generation with `image`

Use the `image` CLI when the user asks to create or edit a raster image through Gemini.

Before using unfamiliar options, run `image --help` or `image generate --help`.

## Authentication

The CLI only reads its saved default profile. It intentionally ignores `GEMINI_API_KEY` and other environment-based Gemini credentials.

```bash
image login status
image login
```

Never print, request in chat, expose, or commit the API key. Do not run interactive login on behalf of the user.

## Generation

```bash
image generate \
  --model <model> \
  --aspect-ratio <ratio> \
  --image-size <size> \
  --prompt "<prompt>" \
  --output <absolute-output-path> \
  --json
```

Supported image sizes are `512`, `1K`, `2K`, and `4K`. Aspect ratios use `WIDTH:HEIGHT`, such as `1:1`, `4:3`, `16:9`, or `9:16`. Add `--reference <path>` for a reference image.

CLI settings take precedence over global settings. Global settings are managed with `image settings list` and `image settings set <model|aspect-ratio|image-size> <value>`.

Prefer `--json` and an explicit absolute `--output` path. Parse the JSON result from stdout; stderr contains errors. Do not claim success until the command succeeds and the output path exists.
