import { Readable, Writable } from "node:stream";
import type WebSocket from "ws";
import type { ExecDetail } from "../contract/execs.js";
import { decodeFrame, encodeFrame, FrameStream } from "./exec-frame.js";

/** What a session needs from the exec routes once its WebSocket is open: the exec's state at the end, and its console's size. */
export interface ExecRoutes {
	inspect(id: string, signal?: AbortSignal): Promise<ExecDetail>;
	resize(id: string, rows: number, columns: number, signal?: AbortSignal): Promise<void>;
}

/** How an attached exec was created, which decides how its WebSocket messages are read and written. */
export interface ExecSessionShape {
	/**
	 * Whether the program has a console. With a console, each WebSocket message carries raw bytes in both directions; without one,
	 * each WebSocket message is one frame.
	 */
	readonly tty: boolean;
	/** Whether the program's standard input stays open for what the caller sends. */
	readonly attachStdin: boolean;
}

/**
 * A program running in a machine with the caller attached: its standard output and standard error as readable streams, its standard
 * input as a writable stream, and its exit code once it has ended. `ExecsClient.spawn` starts one; `ExecsClient.run` starts one and
 * collects its output.
 *
 * The output streams are fed from the exec's WebSocket. While a stream's reader falls behind, the session stops reading the WebSocket.
 * The caller must therefore read both streams: an unread stream stops the program's output, and `wait` never resolves. When the
 * program has ended and its output has been sent, the service closes the WebSocket, both streams end, and `wait` reads the exec's
 * exit code.
 */
export class ExecSession {
	private readonly socket: WebSocket;
	private readonly routes: ExecRoutes;
	private readonly closed: Promise<void>;

	/** The exec ID: 32 lower-case hexadecimal digits. */
	readonly id: string;

	/** The program's standard output; with a console, all of its output. */
	readonly stdout: Readable;

	/** The program's standard error; with a console it stays empty, because the console carries both. */
	readonly stderr: Readable;

	/** The program's standard input when the exec attaches it, otherwise null. Ending it closes the program's standard input. */
	readonly stdin: Writable | null;

	/** @internal */
	constructor(id: string, socket: WebSocket, shape: ExecSessionShape, routes: ExecRoutes) {
		this.id = id;
		this.socket = socket;
		this.routes = routes;
		const resume = (): void => {
			socket.resume();
		};

		this.stdout = new Readable({ read: resume });
		this.stderr = new Readable({ read: resume });
		this.stdin = shape.attachStdin ? this.createInput(shape.tty) : null;
		this.closed = this.relayOutput(shape.tty);
	}

	/**
	 * Waits until the program has ended and its output has been sent, then reads the exec.
	 *
	 * @param signal - Cancels the read of the exec; the program keeps running.
	 * @returns The exec, with the program's exit code in full, such as 3010; null when Windows restarted before the program ended.
	 * A program that was not found ends with 127, and one that was found but could not start ends with 126 and a `startError`.
	 */
	async wait(signal?: AbortSignal): Promise<ExecDetail> {
		await this.closed;
		return this.routes.inspect(this.id, signal);
	}

	/**
	 * Changes the size of the program's console.
	 *
	 * @param rows - The number of rows.
	 * @param columns - The number of columns.
	 * @param signal - Cancels the request.
	 * @returns When the service has resized the console.
	 */
	resize(rows: number, columns: number, signal?: AbortSignal): Promise<void> {
		return this.routes.resize(this.id, rows, columns, signal);
	}

	/**
	 * Leaves the program running and stops relaying its streams: the WebSocket is closed and both output streams end. As in Docker,
	 * a program keeps running when its caller disconnects.
	 */
	detach(): void {
		this.socket.close();
	}

	// Feeds each message to its stream until the service closes the WebSocket. A message that is not a well-formed frame carries no
	// stream to feed, so it is skipped, as the eastindia CLI skips it. The promise rejects when the WebSocket fails before the service
	// closes it.
	private relayOutput(tty: boolean): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			let failure: Error | undefined;
			this.socket.on("message", (data: Buffer) => {
				const frame = tty ? { stream: FrameStream.stdout, payload: data } : decodeFrame(data);
				if (frame === undefined || frame.stream === FrameStream.stdin) {
					return;
				}

				const target = frame.stream === FrameStream.stderr ? this.stderr : this.stdout;
				if (!target.push(frame.payload)) {
					this.socket.pause();
				}
			});
			this.socket.once("error", (error) => {
				failure = error;
			});
			this.socket.once("close", () => {
				this.stdout.push(null);
				this.stderr.push(null);
				if (failure === undefined) {
					resolve();
				}
				else {
					this.stdout.destroy(failure);
					this.stderr.destroy(failure);
					reject(failure);
				}
			});
		});
	}

	// Without a console each write goes as one standard-input frame, and the end of the stream as an empty one, which closes the
	// program's standard input. With a console the bytes go as they are, and the end of the stream sends nothing.
	private createInput(tty: boolean): Writable {
		return new Writable({
			write: (chunk: Buffer, _encoding, done) => {
				this.socket.send(tty ? chunk : encodeFrame(FrameStream.stdin, chunk), { binary: true }, done);
			},
			final: (done) => {
				if (tty) {
					done();
				}
				else {
					this.socket.send(encodeFrame(FrameStream.stdin, Buffer.alloc(0)), { binary: true }, done);
				}
			},
		});
	}
}
