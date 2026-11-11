import type { Filters } from "../contract/common.js";
import type { VolumeDetail } from "../contract/volumes.js";
import { Routes } from "../routes.js";
import type { ApiConnection } from "../transport/api-connection.js";
import { QueryText } from "../transport/query-text.js";

/** The named volume routes: list, inspect and remove. A fleet creates its named volumes when it comes up. */
export class VolumesClient {
	private readonly connection: ApiConnection;

	/** @internal */
	constructor(connection: ApiConnection) {
		this.connection = connection;
	}

	/**
	 * Lists named volumes: `endia volume ls`.
	 *
	 * @param options - `filters` such as `{ label: ["team=qa"] }`.
	 * @returns The volumes.
	 */
	list(options: { readonly filters?: Filters; readonly signal?: AbortSignal } = {}): Promise<VolumeDetail[]> {
		return this.connection.read(Routes.volumes + new QueryText().addJson("filters", options.filters).toString(), options.signal);
	}

	/**
	 * Reads one named volume: `endia volume inspect`.
	 *
	 * @param name - The volume's name.
	 * @param signal - Cancels the request.
	 * @returns The volume.
	 */
	inspect(name: string, signal?: AbortSignal): Promise<VolumeDetail> {
		return this.connection.read(Routes.volume(name), signal);
	}

	/**
	 * Deletes a named volume and its disk: `endia volume rm`.
	 *
	 * @param name - The volume's name.
	 * @param options - `force` is sent as `endia volume rm -f` sends it.
	 * @returns When the service has deleted the volume. A volume attached to a machine is refused with `RESOURCE_IN_USE`, with or
	 * without `force`.
	 */
	remove(name: string, options: { readonly force?: boolean; readonly signal?: AbortSignal } = {}): Promise<void> {
		return this.connection.changeWithoutAnswer({ method: "DELETE", path: Routes.volume(name) + new QueryText().addFlag("force", options.force).toString(), signal: options.signal });
	}
}
