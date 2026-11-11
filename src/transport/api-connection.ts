import { randomUUID } from "node:crypto";
import http, { type IncomingHttpHeaders, type IncomingMessage } from "node:http";
import https from "node:https";
import net from "node:net";
import type { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";
import type { ApiError } from "../contract/common.js";
import { EastIndiaApiError, EastIndiaConnectionError } from "../errors.js";
import { Headers, MediaTypes } from "../routes.js";
import { classifyConnectionFailure } from "./connection-failures.js";
import { readJsonLines } from "./json-lines.js";
import { describeServiceAddress, type ServiceAddress } from "./service-address.js";
import type { TlsFiles } from "./tls-files.js";

/** How the connection reaches the service and how patient it is. */
export interface ConnectionSettings {
	readonly address: ServiceAddress;
	/** The certificate files; required over HTTPS, unused on a local socket. */
	readonly tls: TlsFiles | undefined;
	readonly requestTimeoutMilliseconds: number;
	readonly requestRetries: number;
	readonly requestRetryDelayMilliseconds: number;
}

/** A request body: bytes held in memory, or a stream opened afresh for each attempt, so that a retried request sends the same bytes. */
export type RequestBody =
	| { readonly contentType: string; readonly bytes: Uint8Array }
	| { readonly contentType: string; readonly open: () => Readable; readonly length?: number };

/** One request to the service. */
export interface Exchange {
	readonly method: "GET" | "HEAD" | "POST" | "PUT" | "DELETE";
	/** The route's path with its query. */
	readonly path: string;
	readonly body?: RequestBody;
	/** Cancels the request; the promise then rejects with the signal's reason. */
	readonly signal?: AbortSignal | undefined;
}

/** A whole answer, read into memory. */
export interface Answer {
	readonly status: number;
	readonly headers: IncomingHttpHeaders;
	readonly body: Buffer;
}

/** How one request is sent: whether it carries an `Idempotency-Key` and is sent again after a failed connection, and whether the client's time limit applies. */
interface Sending {
	readonly keyed: boolean;
	readonly timed: boolean;
}

/**
 * The one connection the route groups share, over HTTPS with mutual TLS or over a local socket. Without it each group would repeat
 * three rules that every request follows. A changing request carries an `Idempotency-Key`, and it is sent again with the same key
 * when its connection fails before any reply. A refusal becomes a `EastIndiaApiError` with the service's error. A request that gets
 * no answer becomes a `EastIndiaConnectionError` that says why.
 *
 * Over HTTPS the client presents the caller's certificate and accepts the server only when its certificate chains to `ca.pem`, is
 * meant for server authentication and names the address: Node's TLS checks all three when `ca.pem` is the only authority given.
 */
export class ApiConnection {
	private readonly settings: ConnectionSettings;
	private readonly agent: http.Agent;
	private readonly addressText: string;

	/**
	 * Opens the connection; no request is sent until a route group sends one.
	 *
	 * @param settings - The address, certificate files and patience.
	 * @throws Error when an HTTPS address comes without the certificate files.
	 */
	constructor(settings: ConnectionSettings) {
		this.settings = settings;
		this.addressText = describeServiceAddress(settings.address);
		this.agent = ApiConnection.createAgent(settings);
	}

	/**
	 * Reads a route's JSON answer. A read is sent once: it changes nothing, so a failed connection is reported rather than retried.
	 *
	 * @param path - The route's path with its query.
	 * @param signal - Cancels the request.
	 * @returns The parsed answer.
	 */
	async read<T>(path: string, signal?: AbortSignal): Promise<T> {
		return parseJson(await this.send({ method: "GET", path, signal }, { keyed: false, timed: true })) as T;
	}

	/**
	 * Sends a request that changes something and reads its JSON answer. It carries a new `Idempotency-Key`, and when its connection
	 * fails before any reply it is sent again with the same key, so that the service does the work once.
	 *
	 * @param exchange - The request.
	 * @param timed - Whether the client's time limit applies; false for an upload and for a wait the service answers only when it ends.
	 * @returns The parsed answer.
	 */
	async change<T>(exchange: Exchange, timed = true): Promise<T> {
		return parseJson(await this.send(exchange, { keyed: true, timed })) as T;
	}

	/**
	 * Sends a request that changes something and answers without a body, with the key and retries of `change`.
	 *
	 * @param exchange - The request.
	 * @returns When the service has answered with success.
	 */
	async changeWithoutAnswer(exchange: Exchange): Promise<void> {
		await this.send(exchange, { keyed: true, timed: true });
	}

	/**
	 * Sends a request exactly once, without an `Idempotency-Key`, without a retry and without the client's time limit, and reads its
	 * JSON answer. A request whose body carries a password goes this way, because the service must never store it and a repeat could
	 * answer a prompt twice; so does a request whose answer carries a private key.
	 *
	 * @param exchange - The request.
	 * @returns The parsed answer.
	 */
	async sendOnce<T>(exchange: Exchange): Promise<T> {
		return parseJson(await this.send(exchange, { keyed: false, timed: false })) as T;
	}

	/**
	 * Sends a request that changes nothing although it is a `POST`, such as a screenshot, without an `Idempotency-Key`, and gives the
	 * whole answer, for an answer that is not JSON.
	 *
	 * @param exchange - The request.
	 * @returns The answer.
	 */
	sendWithoutKey(exchange: Exchange): Promise<Answer> {
		return this.send(exchange, { keyed: false, timed: true });
	}

	/**
	 * Sends a request that has no body and whose answer has none, such as a HEAD, and gives the answer's headers.
	 *
	 * @param path - The route's path with its query.
	 * @param signal - Cancels the request.
	 * @returns The answer's headers.
	 */
	async head(path: string, signal?: AbortSignal): Promise<IncomingHttpHeaders> {
		return (await this.send({ method: "HEAD", path, signal }, { keyed: false, timed: true })).headers;
	}

	/**
	 * Sends a request whose answer is streamed, such as a followed log, and gives the answer once its headers have arrived. The client's
	 * time limit does not apply, because a followed stream stays open for as long as the service has more to send.
	 *
	 * @param exchange - The request.
	 * @returns The answer's body as it arrives; the caller reads it to its end or destroys it.
	 */
	async openStream(exchange: Exchange): Promise<IncomingMessage> {
		const response = await this.dispatch(exchange, undefined, exchange.signal);
		if (exchange.signal !== undefined) {
			const signal = exchange.signal;
			const stop = (): void => {
				response.destroy(signal.reason instanceof Error ? signal.reason : undefined);
			};

			signal.addEventListener("abort", stop, { once: true });
			response.once("close", () => {
				signal.removeEventListener("abort", stop);
			});
		}

		return response;
	}

	/**
	 * Reads a route whose answer is a stream of JSON objects, one per line, such as a machine's log or its readings. The request is
	 * sent when the iteration starts, and stopping the iteration early ends it.
	 *
	 * @param path - The route's path with its query.
	 * @param signal - Ends the request.
	 * @returns The objects, as their lines arrive.
	 */
	async *readLines<T>(path: string, signal?: AbortSignal): AsyncGenerator<T, void, undefined> {
		yield* readJsonLines<T>(await this.openStream({ method: "GET", path, signal }));
	}

	/**
	 * Opens a route as a WebSocket, with the same certificate and the same server check as every other request.
	 *
	 * @param path - The route, such as `/v1/execs/{id}/start`.
	 * @param signal - Cancels the opening.
	 * @returns The open WebSocket; the caller closes it.
	 * @throws EastIndiaApiError when the service refuses the upgrade, with the error its answer carries.
	 * @throws EastIndiaConnectionError when no answer came.
	 */
	openWebSocket(path: string, signal?: AbortSignal): Promise<WebSocket> {
		signal?.throwIfAborted();
		const socket = this.createWebSocket(path);
		return new Promise<WebSocket>((resolve, reject) => {
			const abort = (): void => {
				socket.terminate();
				reject(signal?.reason);
			};

			signal?.addEventListener("abort", abort, { once: true });
			const settle = (): void => {
				signal?.removeEventListener("abort", abort);
				socket.removeAllListeners("open").removeAllListeners("unexpected-response").removeAllListeners("error");
			};

			socket.once("open", () => {
				settle();
				resolve(socket);
			});
			// A refused upgrade is answered like any other refusal, with the error as its body. The ws package hands that answer to this
			// listener and leaves the upgrade request open, so the listener reads the body and then destroys the request.
			socket.once("unexpected-response", (request, response) => {
				settle();
				readAll(response).then(
					(body) => {
						reject(new EastIndiaApiError(response.statusCode ?? 0, readError({ status: response.statusCode ?? 0, headers: response.headers, body })));
					},
					(error: unknown) => {
						reject(this.connectionError(error));
					},
				).finally(() => {
					request.destroy();
				});
			});
			socket.once("error", (error) => {
				settle();
				reject(this.connectionError(error));
			});
		});
	}

	/** Closes the connections kept open for later requests. A request sent afterwards opens a new one. */
	close(): void {
		this.agent.destroy();
	}

	private async send(exchange: Exchange, sending: Sending): Promise<Answer> {
		if (!sending.keyed) {
			return this.sendAttempt(exchange, undefined, sending.timed);
		}

		// Every attempt of one changing request carries the same key, so that the service does the work once.
		const key = randomUUID().replaceAll("-", "");
		for (let attempt = 0; ; attempt++) {
			try {
				return await this.sendAttempt(exchange, key, sending.timed);
			}
			catch (error) {
				if (!(error instanceof EastIndiaConnectionError) || error.failure !== "unreachable" || attempt >= this.settings.requestRetries) {
					throw error;
				}

				await delay(this.settings.requestRetryDelayMilliseconds, undefined, { signal: exchange.signal });
			}
		}
	}

	// One attempt, read to the end of its answer. The client's time limit covers both the reply and the reading of its body; when it
	// passes, the request is abandoned and reported as timedOut, while the caller's own signal rejects with the caller's reason.
	private async sendAttempt(exchange: Exchange, key: string | undefined, timed: boolean): Promise<Answer> {
		const limit = timed ? AbortSignal.timeout(this.settings.requestTimeoutMilliseconds) : undefined;
		const signal = combine(exchange.signal, limit);
		try {
			const response = await this.dispatch(exchange, key, signal);
			const body = await readAll(response, signal).catch((error: unknown) => {
				throw signal?.aborted === true ? error : this.connectionError(error);
			});
			return { status: response.statusCode ?? 0, headers: response.headers, body };
		}
		catch (error) {
			if (limit?.aborted === true && exchange.signal?.aborted !== true) {
				throw new EastIndiaConnectionError(this.addressText, "timedOut", error);
			}

			throw error;
		}
	}

	// Sends the request and gives the answer once its headers have arrived. A refusal is read to its end and thrown as
	// EastIndiaApiError; an error before any answer is thrown as EastIndiaConnectionError, unless the signal ended the request.
	private dispatch(exchange: Exchange, key: string | undefined, signal: AbortSignal | undefined): Promise<IncomingMessage> {
		signal?.throwIfAborted();
		return new Promise<IncomingMessage>((resolve, reject) => {
			const request = this.createRequest(exchange, key);
			const abort = (): void => {
				request.destroy(signal?.reason instanceof Error ? signal.reason : undefined);
				reject(signal?.reason);
			};

			signal?.addEventListener("abort", abort, { once: true });
			request.once("response", (response) => {
				signal?.removeEventListener("abort", abort);
				const status = response.statusCode ?? 0;
				if (status < 400) {
					resolve(response);
					return;
				}

				readAll(response, signal).then(
					(body) => {
						reject(new EastIndiaApiError(status, readError({ status, headers: response.headers, body })));
					},
					(error: unknown) => {
						reject(signal?.aborted === true ? signal.reason : this.connectionError(error));
					},
				);
			});
			request.once("error", (error) => {
				signal?.removeEventListener("abort", abort);
				reject(signal?.aborted === true ? signal.reason : this.connectionError(error));
			});
			this.writeBody(request, exchange.body);
		});
	}

	private createRequest(exchange: Exchange, key: string | undefined): http.ClientRequest {
		const headers: Record<string, string> = {};
		if (key !== undefined) {
			headers[Headers.idempotencyKey] = key;
		}

		if (exchange.body !== undefined) {
			headers["Content-Type"] = exchange.body.contentType;
			const length = "bytes" in exchange.body ? exchange.body.bytes.byteLength : exchange.body.length;
			if (length !== undefined) {
				headers["Content-Length"] = String(length);
			}
		}

		const address = this.settings.address;
		const options: http.RequestOptions = { method: exchange.method, path: exchange.path, headers, agent: this.agent };
		return address.kind === "https"
			? https.request({ ...options, host: address.hostname, port: address.port })
			: http.request({ ...options, socketPath: address.path, host: "localhost" });
	}

	private writeBody(request: http.ClientRequest, body: RequestBody | undefined): void {
		if (body === undefined) {
			request.end();
			return;
		}

		if ("bytes" in body) {
			request.end(body.bytes);
			return;
		}

		const stream = body.open();
		stream.once("error", (error) => request.destroy(error));
		stream.pipe(request);
	}

	private createWebSocket(path: string): WebSocket {
		const address = this.settings.address;
		if (address.kind === "socket") {
			return new WebSocket(`ws://localhost${path}`, { createConnection: () => net.connect(address.path) });
		}

		const tls = this.settings.tls;
		const host = address.hostname.includes(":") ? `[${address.hostname}]` : address.hostname;
		return new WebSocket(`wss://${host}:${String(address.port)}${path}`, { ca: tls?.ca, cert: tls?.cert, key: tls?.key });
	}

	private connectionError(error: unknown): EastIndiaConnectionError {
		return error instanceof EastIndiaConnectionError
			? error
			: new EastIndiaConnectionError(this.addressText, classifyConnectionFailure(error, this.settings.address.kind === "socket"), error);
	}

	private static createAgent(settings: ConnectionSettings): http.Agent {
		if (settings.address.kind === "socket") {
			return new http.Agent({ keepAlive: true });
		}

		if (settings.tls === undefined) {
			throw new Error("A connection over HTTPS needs the certificate files: ca, cert and key.");
		}

		return new https.Agent({ keepAlive: true, ca: settings.tls.ca, cert: settings.tls.cert, key: settings.tls.key });
	}
}

/**
 * Writes a JSON request body. Members whose value is undefined are left out, so that the service applies their defaults; the service
 * refuses a member it does not know.
 *
 * @param value - The body.
 * @returns The body as UTF-8 JSON.
 */
export function jsonBody(value: object): RequestBody {
	return { contentType: MediaTypes.json, bytes: Buffer.from(JSON.stringify(value), "utf8") };
}

/**
 * Writes a tar archive the caller packed as a request body.
 *
 * @param archive - The archive's bytes, or a function that opens it afresh, so that a retried request sends the same bytes.
 * @returns The body, of type `application/x-tar`.
 */
export function tarBody(archive: Uint8Array | (() => Readable)): RequestBody {
	return archive instanceof Uint8Array ? { contentType: MediaTypes.tar, bytes: archive } : { contentType: MediaTypes.tar, open: archive };
}

/**
 * Reads the error of a refusal: the JSON body, or, for an answer without a body such as a HEAD's, the `X-EastIndia-Error` header,
 * which holds the same JSON in Base64. Gives null when neither holds a readable error.
 *
 * @param answer - The refusal.
 * @returns The error, or null.
 */
export function readError(answer: Answer): ApiError | null {
	const fromBody = tryParseError(answer.body.toString("utf8"));
	if (fromBody !== null) {
		return fromBody;
	}

	const header = answer.headers[Headers.error.toLowerCase()];
	return typeof header === "string" ? tryParseError(Buffer.from(header, "base64").toString("utf8")) : null;
}

/**
 * Reads a JSON value that the API sends Base64-encoded in a header, such as `X-EastIndia-Path-Stat`.
 *
 * @param headers - The answer's headers.
 * @param name - The header's name.
 * @returns The value, or undefined when the header is absent or not Base64 of JSON.
 */
export function readHeaderJson(headers: IncomingHttpHeaders, name: string): unknown {
	const text = headers[name.toLowerCase()];
	if (typeof text !== "string") {
		return undefined;
	}

	try {
		return JSON.parse(Buffer.from(text, "base64").toString("utf8"));
	}
	catch {
		return undefined;
	}
}

function tryParseError(text: string): ApiError | null {
	try {
		const value: unknown = JSON.parse(text);
		return typeof value === "object" && value !== null && "code" in value && "message" in value ? (value as ApiError) : null;
	}
	catch {
		return null;
	}
}

function parseJson(answer: Answer): unknown {
	if (answer.body.length === 0) {
		throw new Error(`The service answered ${String(answer.status)} without the JSON body the route promises.`);
	}

	return JSON.parse(answer.body.toString("utf8"));
}

/**
 * Reads a body to its end.
 *
 * @param stream - The body.
 * @param signal - Stops the reading; the promise then rejects with the signal's reason.
 * @returns The bytes.
 */
export async function readAll(stream: Readable, signal?: AbortSignal): Promise<Buffer> {
	const chunks: Buffer[] = [];
	const stop = (): void => {
		stream.destroy(signal?.reason instanceof Error ? signal.reason : undefined);
	};

	signal?.addEventListener("abort", stop, { once: true });
	try {
		for await (const chunk of stream) {
			chunks.push(chunk as Buffer);
		}
	}
	catch (error) {
		throw signal?.aborted === true ? signal.reason : error;
	}
	finally {
		signal?.removeEventListener("abort", stop);
	}

	return Buffer.concat(chunks);
}

function combine(first: AbortSignal | undefined, second: AbortSignal | undefined): AbortSignal | undefined {
	return first === undefined ? second : second === undefined ? first : AbortSignal.any([first, second]);
}
