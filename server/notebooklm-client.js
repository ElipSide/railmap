import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const NOTEBOOKLM_MODE_MANUAL = "manual";
const NOTEBOOKLM_MODE_PYTHON = "python";

function asText(value) {
  return String(value ?? "").trim();
}

function normalizeMode(value) {
  const normalized = asText(value).toLowerCase();
  if (
    normalized === NOTEBOOKLM_MODE_PYTHON ||
    normalized === "py" ||
    normalized === "notebooklm-py"
  ) {
    return NOTEBOOKLM_MODE_PYTHON;
  }
  return NOTEBOOKLM_MODE_MANUAL;
}

function stripCodeFences(value) {
  const text = asText(value);
  if (!text) return "";
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : text;
}

function tryJsonParse(value) {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractBalancedJsonFragment(text) {
  const source = stripCodeFences(text);
  if (!source) return null;

  const starts = [];
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === "[" || char === "{") starts.push(i);
  }

  for (const start of starts) {
    let depth = 0;
    let inString = false;
    let escapeNext = false;

    for (let i = start; i < source.length; i += 1) {
      const char = source[i];

      if (inString) {
        if (escapeNext) {
          escapeNext = false;
        } else if (char === "\\") {
          escapeNext = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }

      if (char === "[" || char === "{") {
        depth += 1;
      } else if (char === "]" || char === "}") {
        depth -= 1;
        if (depth === 0) {
          return source.slice(start, i + 1);
        }
      }
    }
  }

  return null;
}

export function extractNotebookLmJson(rawValue) {
  if (Array.isArray(rawValue)) {
    return { parse_ok: true, parsed_json: rawValue, raw_text: JSON.stringify(rawValue, null, 2) };
  }

  if (rawValue && typeof rawValue === "object") {
    if (Array.isArray(rawValue.market_signals) || Array.isArray(rawValue.signals)) {
      return {
        parse_ok: true,
        parsed_json: rawValue,
        raw_text: JSON.stringify(rawValue, null, 2),
      };
    }

    return {
      parse_ok: true,
      parsed_json: rawValue,
      raw_text: JSON.stringify(rawValue, null, 2),
    };
  }

  const rawText = stripCodeFences(rawValue);
  if (!rawText) {
    return { parse_ok: false, parsed_json: null, raw_text: "" };
  }

  const direct = tryJsonParse(rawText);
  if (direct != null) {
    return { parse_ok: true, parsed_json: direct, raw_text: rawText };
  }

  const fragment = extractBalancedJsonFragment(rawText);
  if (fragment) {
    const parsed = tryJsonParse(fragment);
    if (parsed != null) {
      return { parse_ok: true, parsed_json: parsed, raw_text: rawText };
    }
  }

  return { parse_ok: false, parsed_json: null, raw_text: rawText };
}

function tokenizeCommand(command) {
  const text = asText(command) || "python";
  const tokens = [];
  let current = "";
  let quote = null;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) tokens.push(current);
  return tokens.length > 0 ? tokens : ["python"];
}

function normalizePythonPayload(payload, fallbackRawText = "") {
  if (!payload || typeof payload !== "object") {
    return extractNotebookLmJson(fallbackRawText);
  }

  const rawText =
    asText(payload.answer) ||
    asText(payload.raw_text) ||
    asText(payload.output) ||
    fallbackRawText;

  const extracted = extractNotebookLmJson(rawText);

  return {
    raw_text: extracted.raw_text || rawText,
    parsed_json: extracted.parsed_json,
    parse_ok: extracted.parse_ok,
    provider_payload: payload,
  };
}

function buildPythonConfig() {
  const notebookId = asText(process.env.NOTEBOOKLM_NOTEBOOK_ID);
  const pythonCmd = asText(process.env.NOTEBOOKLM_PYTHON_CMD || process.env.PYTHON_BIN || "python");
  const scriptPath = path.resolve(
    process.cwd(),
    asText(process.env.NOTEBOOKLM_SCRIPT_PATH || "./server/ask_notebooklm.py")
  );
  const storagePath = asText(process.env.NOTEBOOKLM_STORAGE_PATH);

  return {
    mode: NOTEBOOKLM_MODE_PYTHON,
    provider: NOTEBOOKLM_MODE_PYTHON,
    python_cmd: pythonCmd,
    script_path: scriptPath,
    script_exists: existsSync(scriptPath),
    storage_path: storagePath || null,
    storage_exists: storagePath ? existsSync(storagePath) : null,
    notebook_id: notebookId || null,
  };
}

export function getNotebookLmConfig() {
  const inferredMode = process.env.NOTEBOOKLM_MODE || (process.env.NOTEBOOKLM_NOTEBOOK_ID ? "python" : "manual");
  const mode = normalizeMode(inferredMode);

  if (mode === NOTEBOOKLM_MODE_PYTHON) {
    const config = buildPythonConfig();
    const directQueryEnabled = Boolean(
      config.python_cmd && config.script_exists && config.notebook_id
    );

    return {
      ...config,
      direct_query_enabled: directQueryEnabled,
      configured: directQueryEnabled,
      manual_fallback: !directQueryEnabled,
    };
  }

  return {
    mode: NOTEBOOKLM_MODE_MANUAL,
    provider: NOTEBOOKLM_MODE_MANUAL,
    direct_query_enabled: false,
    configured: true,
    manual_fallback: true,
    notebook_id: asText(process.env.NOTEBOOKLM_NOTEBOOK_ID) || null,
    storage_path: asText(process.env.NOTEBOOKLM_STORAGE_PATH) || null,
  };
}

function runPythonHelper({ config, input }) {
  const [command, ...baseArgs] = tokenizeCommand(config.python_cmd);
  const args = [...baseArgs, config.script_path];

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PYTHONUTF8: process.env.PYTHONUTF8 || "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let finished = false;

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      if (finished) return;
      finished = true;
      reject(error);
    });

    child.on("close", (code) => {
      if (finished) return;
      finished = true;
      if (code !== 0) {
        const error = new Error(
          stderr.trim() || stdout.trim() || `Python helper exited with code ${code}`
        );
        error.code = "NOTEBOOKLM_PYTHON_FAILED";
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }

      resolve({ stdout, stderr });
    });

    child.stdin.write(JSON.stringify(input));
    child.stdin.end();
  });
}

export async function queryNotebookLm({
  prompt,
  notebookId,
  mode,
  product,
  volumeTons,
  limit,
  extra = {},
}) {
  const config = getNotebookLmConfig();

  if (!config.direct_query_enabled || config.provider !== NOTEBOOKLM_MODE_PYTHON) {
    const error = new Error(
      "NotebookLM direct query is not configured. Set NOTEBOOKLM_MODE=python, NOTEBOOKLM_NOTEBOOK_ID and ensure the Python helper is available."
    );
    error.code = "NOTEBOOKLM_NOT_CONFIGURED";
    throw error;
  }

  const helperInput = {
    prompt: asText(prompt),
    notebook_id: asText(notebookId || config.notebook_id),
    storage_path: config.storage_path || undefined,
    timeout_sec: Number(process.env.NOTEBOOKLM_PYTHON_TIMEOUT_SEC || 120),
    mode: asText(mode),
    product: asText(product),
    volume_tons: Number(volumeTons || 0),
    limit: Number(limit || 0),
    extra,
  };

  const { stdout } = await runPythonHelper({ config, input: helperInput });

  let payload;
  try {
    payload = JSON.parse(stdout);
  } catch (error) {
    const parseError = new Error(`Failed to parse Python helper JSON: ${error.message}`);
    parseError.code = "NOTEBOOKLM_BAD_HELPER_JSON";
    parseError.response_text = stdout;
    throw parseError;
  }

  if (!payload?.ok) {
    const helperError = new Error(
      asText(payload?.error) || "NotebookLM Python helper returned an error"
    );
    helperError.code = asText(payload?.code) || "NOTEBOOKLM_PYTHON_FAILED";
    helperError.response_text = stdout;
    throw helperError;
  }

  const normalized = normalizePythonPayload(payload, payload.answer || "");

  return {
    integration_mode: NOTEBOOKLM_MODE_PYTHON,
    provider: NOTEBOOKLM_MODE_PYTHON,
    direct_query_enabled: true,
    notebook_id: payload.notebook_id || helperInput.notebook_id,
    raw_text: normalized.raw_text,
    parsed_json: normalized.parsed_json,
    parse_ok: normalized.parse_ok,
    proxy_payload: payload,
    references: Array.isArray(payload.references) ? payload.references : [],
  };
}
