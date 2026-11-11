import { readFileSync } from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import https from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { EastIndiaClient, type ClientOptions } from "../../src/eastindia-client.js";
import type { ApiConnection } from "../../src/transport/api-connection.js";
import type { TlsFiles } from "../../src/transport/tls-files.js";
import { parseServiceAddress, type ServiceAddress } from "../../src/transport/service-address.js";

/** The folder of the test certificates: `ca.pem`, `cert.pem` and `key.pem` for the caller, `server.*` and a stranger's set. */
export const TlsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "test", "fixtures", "tls");

/** Reads one test certificate file. */
export function tlsFile(name: string): string {
	return readFileSync(path.join(TlsFolder, name), "utf8");
}

/** One request the fake service received, with its body read. */
export interface ReceivedRequest {
	readonly method: string;
	readonly url: string;
	readonly headers: IncomingMessage["headers"];
	readonly body: Buffer;
}

/** Answers one request; the request's body has been read into `received.body`. */
export type RouteHandler = (received: ReceivedRequest, response: ServerResponse) => void | Promise<void>;

/** Answers one WebSocket opened on a route. */
export type SocketHandler = (socket: WebSocket, request: IncomingMessage) => void;

/** Which certificates the fake service presents and accepts. */
export interface FakeServiceTls {
	/** The server's certificate and key file names; `server` by default, `stranger-server` for a server the client must refuse. */
	readonly server?: "server" | "stranger-server";
}

/**
 * A stand-in for the EastIndia service, in one of two forms. Over HTTPS it asks for a client certificate issued by the test
 * authority in `TlsFolder`. Over a Unix socket it serves plain HTTP, as the service does on its Windows named pipe, which a Linux
 * test cannot open. Each test registers the answers it needs by method and path, and reads back the requests the client sent.
 */
export class FakeService {
	readonly requests: ReceivedRequest[] = [];
	private readonly routes = new Map<string, RouteHandler>();
	private readonly sockets = new Map<string, SocketHandler>();
	private readonly server: http.Server;
	private readonly webSockets = new WebSocketServer({ noServer: true });
	private socketPath: string | undefined;

	private constructor(server: http.Server) {
		this.server = server;
		server.on("request", (request: IncomingMessage, response: ServerResponse) => {
			void this.answer(request, response);
		});
		server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
			this.upgrade(request, socket, head);
		});
	}

	/** Starts a fake service over HTTPS on a free port of 127.0.0.1. */
	static async overHttps(tls: FakeServiceTls = {}): Promise<FakeService> {
		const server = https.createServer({
			cert: tlsFile(`${tls.server ?? "server"}.pem`),
			key: tlsFile(`${tls.server ?? "server"}.key`),
			ca: tlsFile("ca.pem"),
			requestCert: true,
			rejectUnauthorized: true,
		});
		const service = new FakeService(server);
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		return service;
	}

	/** Starts a fake service over plain HTTP on a Unix socket, the client's path for the named pipe. */
	static async overSocket(): Promise<FakeService> {
		const service = new FakeService(http.createServer());
		service.socketPath = path.join(tmpdir(), `eastindia-client-test-${String(process.pid)}-${String(Date.now())}.sock`);
		await new Promise<void>((resolve) => service.server.listen(service.socketPath, resolve));
		return service;
	}

	/** The `tcp://` address of the HTTPS fake service. */
	get host(): string {
		const address = this.server.address();
		if (address === null || typeof address === "string") {
			throw new Error("The fake service does not listen on a port.");
		}

		return `tcp://127.0.0.1:${String(address.port)}`;
	}

	/** A client of the HTTPS fake service, with the test caller's certificate unless other certificate files are given. */
	client(options: Partial<ClientOptions> = {}): EastIndiaClient {
		return new EastIndiaClient({ host: this.host, tls: callerTls(), requestRetryDelayMilliseconds: 10, ...options });
	}

	/**
	 * A connection to the fake service, for a test that builds the route group it exercises. Over a Unix socket it is the only way
	 * in, because the client's addresses name a socket only as a Windows named pipe.
	 */
	connection(options: Partial<ClientOptions> = {}): ApiConnection {
		const address: ServiceAddress = this.socketPath === undefined ? parseServiceAddress(this.host, "host") : { kind: "socket", path: this.socketPath };
		return EastIndiaClient.connect(address, { tls: callerTls(), requestRetryDelayMilliseconds: 10, ...options });
	}

	/** Answers every request with this method and path; the path is compared without its query. */
	on(method: string, pathname: string, handler: RouteHandler): this {
		this.routes.set(`${method} ${pathname}`, handler);
		return this;
	}

	/** Answers JSON with a status. */
	json(method: string, pathname: string, status: number, body: unknown): this {
		return this.on(method, pathname, (_received, response) => {
			response.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
		});
	}

	/** Accepts a WebSocket on a path. */
	onSocket(pathname: string, handler: SocketHandler): this {
		this.sockets.set(pathname, handler);
		return this;
	}

	/** Stops the fake service and closes every connection. */
	async close(): Promise<void> {
		this.webSockets.close();
		this.server.closeAllConnections();
		await new Promise<void>((resolve) => this.server.close(() => {
			resolve();
		}));
	}

	private async answer(request: IncomingMessage, response: ServerResponse): Promise<void> {
		const chunks: Buffer[] = [];
		for await (const chunk of request) {
			chunks.push(chunk as Buffer);
		}

		const received = { method: request.method ?? "", url: request.url ?? "", headers: request.headers, body: Buffer.concat(chunks) };
		this.requests.push(received);
		const handler = this.routes.get(`${received.method} ${decodeURIComponent(new URL(received.url, "http://fake").pathname)}`);
		if (handler === undefined) {
			response.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ code: "NOT_FOUND", message: `No route ${received.method} ${received.url}.`, fieldPath: null, details: null }));
			return;
		}

		await handler(received, response);
	}

	private upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
		const handler = this.sockets.get(new URL(request.url ?? "", "http://fake").pathname);
		if (handler === undefined) {
			socket.end("HTTP/1.1 404 Not Found\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n" + JSON.stringify({ code: "NOT_FOUND", message: "The exec does not exist.", fieldPath: null, details: null }));
			return;
		}

		this.webSockets.handleUpgrade(request, socket, head, (webSocket) => {
			handler(webSocket, request);
		});
	}
}

/** The test caller's certificate files, issued by the test authority. */
export function callerTls(): TlsFiles {
	return { ca: tlsFile("ca.pem"), cert: tlsFile("cert.pem"), key: tlsFile("key.pem") };
}
