# image-gen

Small CLI for generating images with Gemini.

## Usage

Install the package globally:

```bash
npm install -g .
```

Save the default Gemini API profile:

```bash
image-gen login
```

Generate an image:

```bash
image-gen generate \
  --model gemini-3.1-flash-preview \
  --aspect-ratio 16:9 \
  --image-size 1K \
  --prompt "A cinematic mountain landscape" \
  --output mountain.png
```

Add a reference image with `--reference path/to/reference.png`.

Set global defaults for `generate`:

```bash
node bin/image-gen.js settings set model gemini-3.1-flash-preview
node bin/image-gen.js settings set aspect-ratio 16:9
node bin/image-gen.js settings set image-size 1K
node bin/image-gen.js settings list
```

Values passed directly to `generate` always override global settings.

For automation, set `GEMINI_API_KEY` and request JSON output:

```bash
GEMINI_API_KEY=... image-gen generate \
  --model gemini-3.1-flash-preview \
  --aspect-ratio 1:1 \
  --image-size 512 \
  --prompt "A friendly robot mascot" \
  --output robot.png \
  --json
```

With `--json`, stdout contains the result object and errors are written to stderr.

The default profile is stored in `bin/credentials.json`, next to the installed CLI executable. The file is created with owner-only permissions and is excluded from npm packaging and version control.
