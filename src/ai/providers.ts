import { Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import { tmpdir } from 'os';
import OpenAI from 'openai';

/**
 * One text completion. Both providers are asked for JSON and both are unreliable
 * about wrapping it in prose or a code fence, so callers parse defensively
 * (`parseJsonObject` below) rather than trusting the shape.
 */
export interface AiProvider {
  readonly name: string;
  /** Why this provider can't run, or null when it can. */
  unavailableReason(): Promise<string | null>;
  complete(system: string, user: string, model: string): Promise<string | null>;
}

const REQUEST_TIMEOUT_MS = 60_000;
/** Everything that could read, write or reach the network from the server box. */
const DISALLOWED_TOOLS = [
  'Bash', 'Read', 'Write', 'Edit', 'NotebookEdit',
  'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Task',
];
/** A wedged or chatty CLI shouldn't be able to grow the server's heap. */
const MAX_STDOUT_BYTES = 1 << 20;
/** How long a *failed* availability probe is trusted before asking again. */
const AVAILABILITY_RECHECK_MS = 60_000;

function safeParse(stdout: string): { result?: unknown; is_error?: boolean } | null {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as { result?: unknown; is_error?: boolean }) : null;
  } catch {
    return null;
  }
}

export class OpenAiProvider implements AiProvider {
  readonly name = 'openai';
  private readonly client: OpenAI | null;

  constructor(apiKey: string) {
    this.client = apiKey ? new OpenAI({ apiKey }) : null;
  }

  async unavailableReason(): Promise<string | null> {
    return this.client ? null : 'OPENAI_API_KEY is not set';
  }

  async complete(system: string, user: string, model: string): Promise<string | null> {
    if (!this.client) return null;
    const response = await this.client.chat.completions.create(
      {
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: { type: 'json_object' },
      },
      // The SDK defaults to a 600s timeout with two retries, so one slow step
      // could hold an HTTP request open for half an hour and a whole chat for
      // hours. Match the CLI path's bound instead.
      { timeout: REQUEST_TIMEOUT_MS, maxRetries: 1 },
    );
    return response.choices[0]?.message?.content ?? null;
  }
}

/**
 * Runs the Claude Code CLI as a subprocess.
 *
 * The appeal is that it needs no API key of its own — it uses whatever the
 * machine is already signed in with — so a self-hosted server can have AI
 * features without the operator provisioning billing for them. The cost is that
 * it's a process per call, which is why the timeout is generous and every
 * failure is non-fatal to the caller.
 *
 * `-p` is print mode (one prompt, one answer, no session) and
 * `--output-format json` makes the CLI's own envelope parseable, so a failure to
 * launch is distinguishable from the model declining to answer.
 */
export class ClaudeCodeProvider implements AiProvider {
  readonly name = 'claude-code';
  private readonly logger = new Logger(ClaudeCodeProvider.name);
  private cachedAvailability: string | null | undefined;
  private recheckAfter = 0;

  constructor(
    private readonly binaryPath: string,
    /** Whatever the operator selected — probing a different model proves nothing. */
    private readonly probeModel: string,
  ) {}

  /**
   * Actually asks the CLI a question, rather than only running `--version`.
   *
   * `--version` succeeds on an unauthenticated machine, so the status said
   * "Ready" right up until the first real call answered "Not logged in · Please
   * run /login" — the one thing an operator needed to know, hidden behind the
   * one thing that never fails. The probe is a two-token prompt, cached: a
   * success for the life of the process, a failure for a minute, so fixing the
   * login shows up without a restart and a broken setup isn't re-probed on every
   * dashboard poll.
   */
  async unavailableReason(): Promise<string | null> {
    if (this.cachedAvailability === null) return null;
    if (this.cachedAvailability !== undefined && Date.now() < this.recheckAfter) {
      return this.cachedAvailability;
    }

    const version = await this.run(['--version'], 10_000);
    if (!version.ok) {
      return this.cache(`Claude Code CLI not usable at "${this.binaryPath}" (${version.error ?? 'unknown error'})`);
    }

    try {
      await this.complete('Reply with the single word ok.', 'ping', this.probeModel);
      return this.cache(null);
    } catch (e) {
      return this.cache(`Claude Code CLI: ${(e as Error).message}`);
    }
  }

  private cache(reason: string | null): string | null {
    this.cachedAvailability = reason;
    this.recheckAfter = Date.now() + AVAILABILITY_RECHECK_MS;
    return reason;
  }

  async complete(system: string, user: string, model: string): Promise<string | null> {
    // The CLI takes one prompt, so the system instructions are folded in above
    // the user's message rather than sent as a separate role.
    const prompt = `${system}\n\n---\n\n${user}`;
    const result = await this.run(
      [
        '-p', prompt,
        '--model', model,
        '--output-format', 'json',
        // The prompt contains user chat text and track titles taken from
        // uploaded filenames, so it must be assumed hostile. In print mode the
        // CLI's read-side tools need no approval, which would let injected text
        // walk it into .env, the SQLite file or the JWT secret and hand the
        // contents back inside `reply`. It has no use for any tool here — it is
        // being asked to turn text into JSON — so all of them are refused.
        '--disallowed-tools', DISALLOWED_TOOLS.join(','),
        '--permission-mode', 'default',
      ],
      REQUEST_TIMEOUT_MS,
    );

    // The CLI reports its own failures in the envelope on stdout, not on stderr:
    // an unauthenticated machine exits 1 with `result: "Not logged in · Please
    // run /login"`, which is the only message worth showing anyone.
    const envelope = safeParse(result.stdout);
    if (envelope?.is_error) {
      throw new Error(typeof envelope.result === 'string' ? envelope.result : 'Claude Code returned an error');
    }
    if (!result.ok) throw new Error(result.error ?? 'Claude Code failed');

    if (envelope) {
      // A successful envelope without a string result is a failure we can't
      // name; returning the envelope itself would hand the caller garbage to
      // parse as metadata.
      return typeof envelope.result === 'string' ? envelope.result : null;
    }
    // Older builds print the answer bare.
    return result.stdout.trim() || null;
  }

  private run(args: string[], timeoutMs: number): Promise<{ ok: boolean; stdout: string; error?: string }> {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = (value: { ok: boolean; stdout: string; error?: string }) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      let proc;
      try {
        proc = spawn(this.binaryPath, args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          // Its own process group, so a timeout can take the helpers it spawned
          // with it instead of orphaning them.
          detached: true,
          // Nowhere interesting to look, and nothing worth reading in the
          // environment — belt and braces behind the refused tools above.
          cwd: tmpdir(),
          env: {
            PATH: process.env.PATH ?? '',
            HOME: process.env.HOME ?? tmpdir(),
            ...(process.env.ANTHROPIC_API_KEY ? { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY } : {}),
          },
        });
      } catch (e) {
        finish({ ok: false, stdout: '', error: (e as Error).message });
        return;
      }

      const killTree = () => {
        try {
          if (proc.pid) process.kill(-proc.pid, 'SIGKILL');
        } catch {
          proc.kill('SIGKILL');
        }
      };

      const timer = setTimeout(() => {
        killTree();
        finish({ ok: false, stdout, error: `timed out after ${timeoutMs}ms` });
      }, timeoutMs);
      timer.unref();

      proc.stdout.on('data', (chunk: Buffer) => {
        if (stdout.length > MAX_STDOUT_BYTES) {
          killTree();
          finish({ ok: false, stdout, error: 'output exceeded 1MB' });
          return;
        }
        stdout += chunk.toString();
      });
      proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) finish({ ok: true, stdout });
        else finish({ ok: false, stdout, error: stderr.trim().slice(-300) || `exit ${code}` });
      });
      proc.on('error', (e) => {
        clearTimeout(timer);
        finish({ ok: false, stdout: '', error: e.message });
      });
    });
  }
}

/**
 * Pulls the first JSON object out of a model's reply.
 *
 * Models asked for JSON still return it fenced, prefaced, or followed by a
 * sentence, and that varies by provider and by model — so the text is scanned
 * for the outermost braces rather than parsed whole.
 */
export function parseJsonObject<T>(raw: string | null): T | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // Fall through to brace-scanning.
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
