import type { ClientCertificateSummary, IssuedClientCertificate } from "../contract/clients.js";
import { Routes } from "../routes.js";
import { jsonBody, type ApiConnection } from "../transport/api-connection.js";

/**
 * The client certificate routes: issue, list and revoke the certificates that callers over HTTPS present. The service answers them
 * only on its named pipe, and refuses a caller over HTTPS with `PERMISSION_DENIED`.
 */
export class CertificatesClient {
	private readonly connection: ApiConnection;

	/** @internal */
	constructor(connection: ApiConnection) {
		this.connection = connection;
	}

	/**
	 * Issues a client certificate: `endia context export`. The answer holds the new certificate's private key, and the service
	 * keeps no copy of it to replay. The request is therefore sent once, without an `Idempotency-Key` and without a retry.
	 *
	 * @param name - The certificate's name, which the service records as the caller of each request made with it.
	 * @param signal - Cancels the request.
	 * @returns The authority, the certificate and its private key, as PEM text.
	 */
	issue(name: string, signal?: AbortSignal): Promise<IssuedClientCertificate> {
		return this.connection.sendOnce({ method: "POST", path: Routes.clients, body: jsonBody({ name }), signal });
	}

	/**
	 * Lists the issued client certificates: `endia cert ls`.
	 *
	 * @param signal - Cancels the request.
	 * @returns The certificates, without their keys.
	 */
	list(signal?: AbortSignal): Promise<ClientCertificateSummary[]> {
		return this.connection.read(Routes.clients, signal);
	}

	/**
	 * Revokes a client certificate, after which the service refuses it: `endia cert rm`.
	 *
	 * @param name - The certificate's name.
	 * @param signal - Cancels the request.
	 * @returns The certificate as revoked.
	 */
	revoke(name: string, signal?: AbortSignal): Promise<ClientCertificateSummary> {
		return this.connection.change({ method: "DELETE", path: Routes.client(name), signal });
	}
}
