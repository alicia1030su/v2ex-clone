/**
 * Small, dependency-free argv parser for WorkBuddy resource tools.
 *
 * Commands are always represented as arrays and spawned with `shell: false`.
 * The parser therefore never performs quoting, glob expansion, or command-line
 * interpolation.
 */

export class CliError extends Error {
  /**
   * @param {string} message
   * @param {number} [exitCode]
   */
  constructor(message, exitCode = 2) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}

/**
 * @typedef {Object} OptionSpec
 * @property {'string'|'boolean'|'multiple'} type
 * @property {string} [description]
 */

/**
 * Parse CLI arguments.
 *
 * @param {string[]} argv
 * @param {Record<string, OptionSpec>} spec
 * @returns {{options: Record<string, string|boolean|string[]|undefined>, positionals: string[], rest: string[]}}
 */
export function parseArgs(argv, spec) {
  /** @type {Record<string, string|boolean|string[]|undefined>} */
  const options = {};
  /** @type {string[]} */
  const positionals = [];
  /** @type {string[]} */
  const rest = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--') {
      rest.push(...argv.slice(index + 1));
      break;
    }
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const equalAt = token.indexOf('=');
    const name = token.slice(2, equalAt === -1 ? undefined : equalAt);
    const optionSpec = spec[name];
    if (!optionSpec) {
      throw new CliError(`unknown option: --${name}`);
    }

    if (optionSpec.type === 'boolean') {
      if (equalAt !== -1) {
        const raw = token.slice(equalAt + 1);
        if (raw !== 'true' && raw !== 'false') {
          throw new CliError(`--${name} expects true or false`);
        }
        options[name] = raw === 'true';
      } else {
        options[name] = true;
      }
      continue;
    }

    let value;
    if (equalAt !== -1) {
      value = token.slice(equalAt + 1);
    } else {
      index += 1;
      if (index >= argv.length) {
        throw new CliError(`--${name} requires a value`);
      }
      value = argv[index];
    }
    if (value.length === 0) {
      throw new CliError(`--${name} requires a non-empty value`);
    }

    if (optionSpec.type === 'multiple') {
      const current = options[name];
      if (current === undefined) {
        options[name] = [value];
      } else if (Array.isArray(current)) {
        current.push(value);
      } else {
        throw new CliError(`--${name} was declared as repeatable but received a scalar`);
      }
    } else {
      options[name] = value;
    }
  }

  return { options, positionals, rest };
}

/**
 * Read a required string option.
 *
 * @param {Record<string, string|boolean|string[]|undefined>} options
 * @param {string} name
 * @returns {string}
 */
export function requireString(options, name) {
  const value = options[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new CliError(`missing required option: --${name}`);
  }
  return value;
}

/**
 * Read an optional integer option with an inclusive range.
 *
 * @param {Record<string, string|boolean|string[]|undefined>} options
 * @param {string} name
 * @param {number} defaultValue
 * @param {number} minimum
 * @param {number} maximum
 * @returns {number}
 */
export function optionalInteger(options, name, defaultValue, minimum, maximum) {
  const value = options[name];
  if (value === undefined) return defaultValue;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new CliError(`--${name} expects an integer between ${minimum} and ${maximum}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new CliError(`--${name} expects an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

/**
 * Read an optional finite, non-negative numeric environment-like value.
 *
 * @param {string|undefined} value
 * @param {string} label
 * @returns {number|null}
 */
export function parseOptionalNonNegativeNumber(value, label) {
  if (value === undefined || value === '') return null;
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) {
    throw new Error(`${label} must be a finite non-negative number`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be a finite non-negative number`);
  }
  return parsed;
}
