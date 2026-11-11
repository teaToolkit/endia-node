import type { Operation } from "../contract/operations.js";
import type { DiskUsage, PruneResult } from "../contract/space.js";
import { Routes } from "../routes.js";
import type { ApiConnection } from "../transport/api-connection.js";
import { QueryText } from "../transport/query-text.js";
import type { OperationHandle, OperationsClient } from "./operations.js";

/** The disk space routes: what images, machines and volumes take, and the prune that deletes what nothing uses. */
export class SystemClient {
	private readonly connection: ApiConnection;
	private readonly operations: OperationsClient;

	/** @internal */
	constructor(connection: ApiConnection, operations: OperationsClient) {
		this.connection = connection;
		this.operations = operations;
	}

	/**
	 * Reads what images, machines, volumes and the build cache take on disk, and the free space: `endia system df`.
	 *
	 * @param signal - Cancels the request.
	 * @returns The disk use.
	 */
	diskUsage(signal?: AbortSignal): Promise<DiskUsage> {
		return this.connection.read(Routes.systemDf, signal);
	}

	/**
	 * Deletes what nothing uses: `endia system prune`. It deletes, in this order:
	 * 1. every machine in state `exited` or `created`;
	 * 2. every image with no tag, no children and no machine;
	 * 3. the unused build cache, the entries that `images.pruneBuildCache` deletes;
	 * 4. the finished operations older than the service's retention;
	 * 5. the host objects whose owner no longer exists.
	 *
	 * It deletes what every caller of the service made, not only this caller's.
	 *
	 * @param options - `all` deletes every image that no machine uses and no image is built on, tagged or not. `volumes` is Docker's
	 * option for anonymous volumes; EastIndia has none, so it deletes nothing more.
	 * @returns The prune's operation; its result names what was deleted.
	 */
	async prune(options: { readonly all?: boolean; readonly volumes?: boolean; readonly signal?: AbortSignal } = {}): Promise<OperationHandle<PruneResult>> {
		const query = new QueryText().addFlag("all", options.all).addFlag("volumes", options.volumes);
		const accepted = await this.connection.change<Operation>({ method: "POST", path: Routes.systemPrune + query.toString(), signal: options.signal });
		return this.operations.handle<PruneResult>(accepted);
	}
}
