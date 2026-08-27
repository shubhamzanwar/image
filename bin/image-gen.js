#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { Command, InvalidArgumentError } = require("commander");

const CREDENTIALS_PATH = path.join(__dirname, "credentials.json");
const SETTINGS_PATH = path.join(__dirname, "settings.json");

const SETTING_DEFINITIONS = {
  model: {
    flag: "--model",
    description: "Gemini image model",
    validate: (value) => requiredPositiveString(value, "model"),
  },
  aspectRatio: {
    flag: "--aspect-ratio",
    description: "Image aspect ratio",
    validate: (value) => {
      const normalized = requiredPositiveString(value, "aspect ratio");
      if (!/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(normalized)) {
        throw new Error("aspect ratio must use the form WIDTH:HEIGHT, for example 16:9");
      }
      return normalized;
    },
  },
  imageSize: {
    flag: "--image-size",
    description: "Gemini image size",
    validate: (value) => {
      const normalized = requiredPositiveString(value, "image size").toUpperCase();
      if (!["512", "1K", "2K", "4K"].includes(normalized)) {
        throw new Error("image size must be one of: 512, 1K, 2K, 4K");
      }
      return normalized;
    },
  },
};
function readCredentials() {
  if (!fs.existsSync(CREDENTIALS_PATH)) return { profiles: {} };
  const parsed = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8"));
  return { profiles: parsed.profiles || {} };
}

function writeCredentials(credentials) {
  fs.mkdirSync(__dirname, { recursive: true });
  fs.writeFileSync(CREDENTIALS_PATH, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(CREDENTIALS_PATH, 0o600);
}

function readSettings() {
  if (!fs.existsSync(SETTINGS_PATH)) return {};
  const parsed = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
  return parsed && typeof parsed === "object" ? parsed : {};
}

function writeSettings(settings) {
  fs.mkdirSync(__dirname, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(SETTINGS_PATH, 0o600);
}

function requiredPositiveString(value, optionName) {
  if (!value || !value.trim()) {
    throw new InvalidArgumentError(`${optionName} cannot be empty`);
  }
  return value.trim();
}

function settingDefinition(flag) {
  const normalized = flag.replace(/^--?/, "");
  const key = Object.keys(SETTING_DEFINITIONS).find((candidate) => {
    return candidate === normalized || SETTING_DEFINITIONS[candidate].flag.slice(2) === normalized;
  });
  if (!key) {
    throw new Error("unknown setting. Choose one of: model, aspect-ratio, image-size");
  }
  return { key, definition: SETTING_DEFINITIONS[key] };
}

function validatedSettings(settings) {
  const result = {};
  for (const [key, definition] of Object.entries(SETTING_DEFINITIONS)) {
    if (settings[key] !== undefined) result[key] = definition.validate(settings[key]);
  }
  return result;
}

function readSecret(question) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return new Promise((resolve, reject) => {
      let value = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => { value += chunk; });
      process.stdin.on("end", () => resolve(value.trim()));
      process.stdin.on("error", reject);
    });
  }

  return new Promise((resolve, reject) => {
    const input = process.stdin;
    const output = process.stdout;
    output.write(question);
    input.setRawMode(true);
    input.resume();
    input.setEncoding("utf8");

    let value = "";
    const onData = (chunk) => {
      if (chunk === "\u0003") {
        cleanup();
        reject(new Error("Cancelled"));
      } else if (chunk === "\r" || chunk === "\n") {
        cleanup();
        output.write("\n");
        resolve(value.trim());
      } else if (chunk === "\u007f") {
        value = value.slice(0, -1);
      } else {
        value += chunk;
      }
    };
    const cleanup = () => {
      input.setRawMode(false);
      input.pause();
      input.removeListener("data", onData);
    };
    input.on("data", onData);
  });
}

function mimeTypeForImage(imagePath) {
  const extension = path.extname(imagePath).toLowerCase();
  if ([".jpg", ".jpeg"].includes(extension)) return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  if (extension === ".avif") return "image/avif";
  return "image/png";
}

function referencePart(imagePath) {
  if (!fs.existsSync(imagePath)) throw new Error(`Reference image not found: ${imagePath}`);
  return {
    inlineData: {
      mimeType: mimeTypeForImage(imagePath),
      data: fs.readFileSync(imagePath).toString("base64"),
    },
  };
}

function extractImage(responseJson) {
  for (const candidate of responseJson.candidates || []) {
    for (const part of candidate.content?.parts || []) {
      const data = part.inlineData || part.inline_data;
      if (data?.data) {
        return {
          buffer: Buffer.from(data.data, "base64"),
          mimeType: data.mimeType || data.mime_type || "image/png",
          usageMetadata: responseJson.usageMetadata || responseJson.usage_metadata || null,
        };
      }
    }
  }
  return null;
}

async function generateImage({ apiKey, model, aspectRatio, imageSize, prompt, reference }) {
  const parts = [];
  if (reference) parts.push(referencePart(path.resolve(reference)));
  parts.push({ text: prompt });

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig: { aspectRatio, imageSize },
        },
      }),
    },
  );

  const responseText = await response.text();
  if (!response.ok) throw new Error(`Gemini request failed (${response.status}): ${responseText}`);

  const image = extractImage(JSON.parse(responseText));
  if (!image) throw new Error("Gemini returned no image.");
  return image;
}

function extensionForMimeType(mimeType) {
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/webp") return ".webp";
  return ".png";
}

const program = new Command();
program
  .name("image")
  .description("Generate images with Gemini")
  .version("0.1.0")
  .addHelpText("after", `
Examples:
  $ image login
  $ image login status
  $ image generate --model gemini-3.1-flash-preview --aspect-ratio 16:9 --image-size 1K --prompt "A cinematic mountain landscape" --output mountain.png

Credentials:
  login stores the API key in the default profile at bin/credentials.json.
`);

const loginCommand = program
  .command("login")
  .description("Save a Gemini API key to the default profile")
  .addHelpText("after", `
The API key is entered without being echoed and is stored with owner-only
file permissions in bin/credentials.json.
`)
  .action(async () => {
    const apiKey = await readSecret("Gemini API key: ");
    if (!apiKey) throw new Error("API key cannot be empty.");
    const credentials = readCredentials();
    credentials.profiles.default = { apiKey };
    writeCredentials(credentials);
    console.log(`Saved the default profile to ${CREDENTIALS_PATH}`);
  });

loginCommand
  .command("status")
  .description("Show whether a Gemini API key is available")
  .action(() => {
    const credentials = readCredentials();
    if (credentials.profiles.default?.apiKey) {
      console.log(`Logged in via the default profile (${CREDENTIALS_PATH})`);
      return;
    }

    console.error("Not logged in. Run `image login` first.");
    process.exitCode = 1;
  });

const settingsCommand = program
  .command("settings")
  .description("View and update global generate settings")
  .addHelpText("after", `
Global settings are used by generate when the corresponding command-line
option is omitted. Command-line options always take precedence.

Examples:
  $ image settings list
  $ image settings set model gemini-3.1-flash-preview
  $ image settings set aspect-ratio 16:9
  $ image settings set image-size 1K
`);

settingsCommand
  .command("list")
  .description("Show all global generate settings")
  .action(() => {
    const settings = readSettings();
    for (const [key, definition] of Object.entries(SETTING_DEFINITIONS)) {
      console.log(`${definition.flag}: ${settings[key] ?? "<unset>"}`);
    }
  });

settingsCommand
  .command("set <flag> <value>")
  .description("Set a global generate setting")
  .action((flag, value) => {
    const { key, definition } = settingDefinition(flag);
    const settings = readSettings();
    settings[key] = definition.validate(value);
    writeSettings(settings);
    console.log(`Set ${definition.flag} to ${settings[key]}`);
  });

program
  .command("generate")
  .description("Generate one image")
  .option("--model <model>", "Gemini image model (falls back to global setting)")
  .option("--aspect-ratio <ratio>", "Aspect ratio, for example 1:1, 4:3, 16:9, or 9:16 (falls back to global setting)")
  .option("--image-size <size>", "Image size: 512, 1K, 2K, or 4K (falls back to global setting)")
  .requiredOption("--prompt <text>", "Text description of the image to generate")
  .option("--reference <path>", "Optional reference image")
  .option("--output <path>", "Output file path (default: generated image name)")
  .option("--json", "Print a machine-readable JSON result")
  .addHelpText("after", `
The reference image is sent to Gemini alongside the prompt for visual guidance.
The command writes an image file and prints its absolute path after success.
With --json, stdout contains only a JSON result; progress and errors go to stderr.

Examples:
  $ image generate \\
      --model gemini-3.1-flash-preview \\
      --aspect-ratio 16:9 \\
      --image-size 1K \\
      --prompt "A cinematic mountain landscape" \\
      --output mountain.png

  $ image generate \\
      --model gemini-3.1-flash-preview \\
      --aspect-ratio 1:1 \\
      --image-size 512 \\
      --prompt "A friendly robot mascot" \\
      --reference ./style.png \\
      --json
`)
  .action(async (options) => {
    const credentials = readCredentials();
    const apiKey = credentials.profiles.default?.apiKey;
    if (!apiKey) throw new Error("No default profile found. Run `image login` first.");

    const prompt = requiredPositiveString(options.prompt, "--prompt");
    const globalSettings = validatedSettings(readSettings());
    const generationOptions = {
      ...globalSettings,
      ...Object.fromEntries(Object.entries(options).filter(([key, value]) => value !== undefined)),
    };
    for (const [key, definition] of Object.entries(SETTING_DEFINITIONS)) {
      if (generationOptions[key] === undefined) {
        throw new Error(`${definition.flag} is required. Pass it to generate or set it with 'image settings set ${definition.flag.slice(2)} <value>'.`);
      }
      generationOptions[key] = definition.validate(generationOptions[key]);
    }
    const image = await generateImage({ apiKey, ...generationOptions, prompt });
    const output = path.resolve(options.output || `image-${Date.now()}${extensionForMimeType(image.mimeType)}`);
    fs.writeFileSync(output, image.buffer);
    if (options.json) {
      console.log(JSON.stringify({
        success: true,
        path: output,
        model: options.model,
        mimeType: image.mimeType,
        usageMetadata: image.usageMetadata,
      }));
    } else {
      console.log(`Saved ${output}`);
    }
  });

program.parseAsync().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
