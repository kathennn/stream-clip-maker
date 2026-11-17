const FLAGS = new Set(["chat-only", "vertical", "help"]);
const VALUES = new Set(["out", "quality", "minutes", "slack", "offset", "max-disk-gb", "window", "lead", "tail", "max", "skip", "baseline", "ratio", "min"]);

export const LIVE_CONFIG_DEFAULTS = {
  out: "lab", quality: "best", minutes: 0, slack: 3, offset: 0, "max-disk-gb": 6, channels: [],
};

export function parseLiveArgs(argv) {
  const options = { ...LIVE_CONFIG_DEFAULTS, channels: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      options.channels.push(arg.toLowerCase());
      continue;
    }
    const key = arg.slice(2);
    if (FLAGS.has(key)) {
      options[key] = true;
      continue;
    }
    if (!VALUES.has(key)) throw new Error(`unknown option: ${arg}`);
    const value = argv[++i];
    if (value === undefined || value.startsWith("--")) throw new Error(`missing value for ${arg}`);
    options[key] = ["out", "quality"].includes(key) ? value : Number(value);
    if (typeof options[key] === "number" && !Number.isFinite(options[key])) throw new Error(`${arg} needs a finite number`);
  }

  if (options.help) return options;
  if (options.channels.some((name) => !/^[a-z0-9_]{1,25}$/.test(name))) {
    throw new Error("channel names must contain only letters, numbers and underscores (1-25 characters)");
  }
  options.channels = [...new Set(options.channels)];
  if (!options.out.trim()) throw new Error("--out needs a non-empty directory");
  if (!/^(best|worst|source|[0-9]{3,4}p[0-9]{0,2})$/.test(options.quality)) {
    throw new Error("--quality must be best, worst, source or a resolution such as 1080p60");
  }
  for (const key of ["minutes", "slack", "skip", "lead", "tail", "offset"]) {
    if (options[key] !== undefined && options[key] < 0 && key !== "offset") throw new Error(`--${key} cannot be negative`);
  }
  for (const key of ["window", "max", "baseline", "ratio", "max-disk-gb"]) {
    if (options[key] !== undefined && options[key] <= 0) throw new Error(`--${key} must be greater than zero`);
  }
  if (options.min !== undefined && (!Number.isInteger(options.min) || options.min < 1)) {
    throw new Error("--min must be a positive integer");
  }
  if (options.channels.length === 0) return options;
  return options;
}

export function assertAllowedChannels(channels, allowedCreators) {
  if (!Array.isArray(allowedCreators)) throw new Error("rules.json must contain an allowedCreators array");
  const allowed = new Set(allowedCreators.filter((name) => typeof name === "string").map((name) => name.toLowerCase()));
  const denied = channels.filter((name) => !allowed.has(name.toLowerCase()));
  if (denied.length) {
    throw new Error(`capture blocked for ${denied.join(", ")}: add only channels you have permission to clip to rules.json allowedCreators`);
  }
  return true;
}
