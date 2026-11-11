import type { BaseImportRequest, BaseImportResult, BasePrepareRequest } from "../contract/bases.js";
import type { Operation } from "../contract/operations.js";
import { Routes } from "../routes.js";
import { jsonBody, type ApiConnection } from "../transport/api-connection.js";
import type { OperationHandle, OperationsClient } from "./operations.js";

/**
 * The base routes, which make the images that have no parent: import a Windows disk already on the host, or install Windows from an
 * installation disc. The service does this work in the background, so each method returns a handle on the operation, which follows
 * the work and gives its result, the new image's description.
 */
export class BasesClient {
	private readonly connection: ApiConnection;
	private readonly operations: OperationsClient;

	/** @internal */
	constructor(connection: ApiConnection, operations: OperationsClient) {
		this.connection = connection;
		this.operations = operations;
	}

	/**
	 * Imports a Windows disk on the host as an image: `endia import`.
	 *
	 * @param request - The disk's path on the host, the reference the image will carry, and the configuration changes.
	 * @param signal - Cancels the request.
	 * @returns The import's operation; its result is a `BaseImportResult`.
	 */
	async import(request: BaseImportRequest, signal?: AbortSignal): Promise<OperationHandle<BaseImportResult>> {
		const accepted = await this.connection.change<Operation>({ method: "POST", path: Routes.baseImport, body: jsonBody(request), signal });
		return this.operations.handle<BaseImportResult>(accepted);
	}

	/**
	 * Installs Windows from an installation disc on the host and imports the result: `endia base prepare`. The request carries a
	 * password, so it is sent once, without an `Idempotency-Key` and without a retry.
	 *
	 * @param request - The disc, the tag, the accounts and their password.
	 * @param signal - Cancels the request.
	 * @returns The preparation's operation; its result is a `BaseImportResult`.
	 */
	async prepare(request: BasePrepareRequest, signal?: AbortSignal): Promise<OperationHandle<BaseImportResult>> {
		const accepted = await this.connection.sendOnce<Operation>({ method: "POST", path: Routes.basePrepare, body: jsonBody(request), signal });
		return this.operations.handle<BaseImportResult>(accepted);
	}
}
