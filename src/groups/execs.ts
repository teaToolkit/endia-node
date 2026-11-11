import type { ExecCreated, ExecCreateRequest, ExecDetail, ExecStarted } from "../contract/execs.js";
import { ExecSession } from "../exec/exec-session.js";
import { Routes } from "../routes.js";
import { jsonBody, type ApiConnection } from "../transport/api-connection.js";
import { QueryText } from "../transport/query-text.js";

/** What `ExecsClient.run` sends to the program and how it decodes what the program writes. */
export interface RunOptions {
	/** Text or bytes sent to the program's standard input, which is then closed. The standard input is attached only when this is given. */
	readonly input?: string | Uint8Array;
	/** Cancels the requests; the program keeps running. */
	readonly signal?: AbortSignal;
}

/** A program that has run to its end, with everything it wrote. */
export interface ExecResult {
	/** The program's exit code in full, such as 3010; null when Windows restarted before the program ended. 127 means the program was not found, and 126 that it was found but could not start. */
	readonly exitCode: number | null;
	/** Why the program could not start, or null. */
	readonly startError: string | null;
	/** Everything the program wrote to standard output, decoded as UTF-8; with a console, all of its output. */
	readonly stdout: string;
	/** Everything the program wrote to standard error, decoded as UTF-8; empty with a console. */
	readonly stderr: string;
	/** The exec as the service recorded it at the end. */
	readonly exec: ExecDetail;
}

/** A program started without the caller attached, as `endia exec -d` starts it. */
export interface DetachedExec extends ExecStarted {
	/** The exec ID, which `inspect` takes. */
	readonly id: string;
}

/**
 * The exec routes, which run a program in a running machine as `docker exec` does: create the exec, then start it attached over a
 * WebSocket or detached. `run`, `spawn` and `start` do both steps; `create`, `attach`, `startDetached`, `inspect` and `resize` are the
 * single routes.
 */
export class ExecsClient {
	private readonly connection: ApiConnection;

	/** @internal */
	constructor(connection: ApiConnection) {
		this.connection = connection;
	}

	/**
	 * Runs a program to its end and collects its output: `endia exec`.
	 *
	 * @param machine - The machine name or a unique prefix of its ID.
	 * @param request - The program and its arguments in `cmd`, and how to run it.
	 * @param options - `input` is sent to the program's standard input.
	 * @returns The exit code in full and the output.
	 */
	async run(machine: string, request: ExecCreateRequest, options: RunOptions = {}): Promise<ExecResult> {
		const session = await this.spawn(machine, { ...request, attachStdin: options.input !== undefined }, options.signal);
		session.stdin?.end(options.input);
		const [stdout, stderr] = await Promise.all([collect(session.stdout), collect(session.stderr)]);
		const exec = await session.wait(options.signal);
		return { exitCode: exec.exitCode, startError: exec.startError, stdout, stderr, exec };
	}

	/**
	 * Starts a program with the caller attached to its streams: `endia exec` without collecting.
	 *
	 * @param machine - The machine name or a unique prefix of its ID.
	 * @param request - The program and its arguments in `cmd`, and how to run it. With `attachStdin`, the session's `stdin` is open.
	 * @param signal - Cancels the requests; the program keeps running once it has started.
	 * @returns The running program's streams; read both output streams.
	 */
	async spawn(machine: string, request: ExecCreateRequest, signal?: AbortSignal): Promise<ExecSession> {
		const created = await this.create(machine, request, signal);
		return this.attach(created.id, { tty: request.tty ?? false, attachStdin: request.attachStdin ?? false }, signal);
	}

	/**
	 * Starts a program and returns at once: `endia exec -d`. The program's output is kept in the machine for
	 * `ProcessesClient.logs`.
	 *
	 * @param machine - The machine name or a unique prefix of its ID.
	 * @param request - The program and its arguments in `cmd`, and how to run it.
	 * @param signal - Cancels the requests.
	 * @returns The exec ID and the process the program runs in, which the process routes take.
	 */
	async start(machine: string, request: ExecCreateRequest, signal?: AbortSignal): Promise<DetachedExec> {
		const created = await this.create(machine, request, signal);
		return { id: created.id, ...await this.startDetached(created.id, signal) };
	}

	/**
	 * Creates an exec without starting it: `POST /v1/machines/{name}/exec`.
	 *
	 * @param machine - The machine name or a unique prefix of its ID.
	 * @param request - The program and its arguments in `cmd`, and how to run it.
	 * @param signal - Cancels the request.
	 * @returns The new exec's ID.
	 */
	create(machine: string, request: ExecCreateRequest, signal?: AbortSignal): Promise<ExecCreated> {
		return this.connection.change({ method: "POST", path: Routes.machineExec(machine), body: jsonBody(request), signal });
	}

	/**
	 * Starts a created exec with the caller attached, over a WebSocket: `GET /v1/execs/{id}/start`.
	 *
	 * @param id - The exec ID.
	 * @param shape - Whether the exec was created with `tty` and with `attachStdin`, which decides how its messages are read and written.
	 * @param signal - Cancels the opening.
	 * @returns The running program's streams.
	 */
	async attach(id: string, shape: { readonly tty: boolean; readonly attachStdin: boolean }, signal?: AbortSignal): Promise<ExecSession> {
		const socket = await this.connection.openWebSocket(Routes.execStart(id), signal);
		return new ExecSession(id, socket, shape, this);
	}

	/**
	 * Starts a created exec without the caller attached: `POST /v1/execs/{id}/start` with `{ "detach": true }`.
	 *
	 * @param id - The exec ID.
	 * @param signal - Cancels the request.
	 * @returns The process the program runs in.
	 */
	startDetached(id: string, signal?: AbortSignal): Promise<ExecStarted> {
		return this.connection.change({ method: "POST", path: Routes.execStart(id), body: jsonBody({ detach: true }), signal });
	}

	/**
	 * Reads an exec: what was asked for, its process, and its exit code once it has ended.
	 *
	 * @param id - The exec ID.
	 * @param signal - Cancels the request.
	 * @returns The exec.
	 */
	inspect(id: string, signal?: AbortSignal): Promise<ExecDetail> {
		return this.connection.read(Routes.exec(id), signal);
	}

	/**
	 * Changes the size of an exec's console.
	 *
	 * @param id - The exec ID.
	 * @param rows - The number of rows.
	 * @param columns - The number of columns.
	 * @param signal - Cancels the request.
	 * @returns When the service has resized the console.
	 */
	resize(id: string, rows: number, columns: number, signal?: AbortSignal): Promise<void> {
		const query = new QueryText().add("h", rows).add("w", columns);
		return this.connection.changeWithoutAnswer({ method: "POST", path: Routes.execResize(id) + query.toString(), signal });
	}
}

async function collect(stream: AsyncIterable<Buffer>): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of stream) {
		chunks.push(chunk);
	}

	return Buffer.concat(chunks).toString("utf8");
}
