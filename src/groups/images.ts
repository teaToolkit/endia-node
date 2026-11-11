import type { Readable } from "node:stream";
import { packBuildContext } from "../archives/build-context.js";
import type { Filters } from "../contract/common.js";
import type { BuildResult, ImageDetail, ImageSummary, RemovalEntry, TagResult } from "../contract/images.js";
import type { Operation } from "../contract/operations.js";
import type { BuilderPruneResult } from "../contract/space.js";
import { Routes } from "../routes.js";
import { jsonBody, tarBody, type ApiConnection, type RequestBody } from "../transport/api-connection.js";
import { QueryText } from "../transport/query-text.js";
import type { OperationHandle, OperationsClient } from "./operations.js";

/** What a build makes and how: the tags, the build arguments and labels, the stage to build, and the builder's resources. */
export interface BuildOptions {
	/** The tags the new image carries, such as `lab/dotnet:10`. */
	readonly tags?: readonly string[];
	/** The build arguments, by name. */
	readonly buildArgs?: Readonly<Record<string, string>>;
	/** The labels added to the image, by key. */
	readonly labels?: Readonly<Record<string, string>>;
	/**
	 * The recipe's stage to build, named by its `FROM ... AS`, as `endia build --target` names it; the tags name that stage's result.
	 * The stages it is built on are built too, or found in the cache. When undefined, the build makes the recipe's last stage.
	 *
	 * @example
	 * For the recipe
	 * ```
	 * FROM eastindia/development:latest AS tools
	 * RUN choco install -y git
	 *
	 * FROM tools AS app
	 * COPY publish/ C:/app/
	 * ```
	 * `client.images.build({ folder: "./lab-image" }, { target: "tools", tags: ["lab/tools:1"] })` builds and tags the first stage
	 * alone. A later build without `target` finds that stage in the cache and builds only `app`.
	 */
	readonly target?: string;
	/**
	 * Whether to build every stage even when an image with the same build key exists. The build key is a SHA-256 hash of everything that decides
	 * a build's result, such as the parent image, every step and the content of every copied file; a build that finds an image with
	 * its key reuses that image.
	 */
	readonly noCache?: boolean;
	/**
	 * The memory of the builder, the temporary machine that runs the recipe, in bytes; at least 2 GiB. When undefined, the service
	 * uses its configuration key `builderMemoryMiB`.
	 */
	readonly memory?: number;
	/** The builder's processors, from 0.01 to 64. When undefined, the service uses its configuration key `builderProcessorCount`. */
	readonly cpus?: number;
	readonly signal?: AbortSignal;
}

/** A build context folder, packed as the `endia` CLI packs it. */
export interface FolderContext {
	/** The context folder. */
	readonly folder: string;
	/** The recipe, inside the folder or outside it; when undefined, `Endiafile` in the folder when it exists, and `Dockerfile` otherwise. */
	readonly recipe?: string;
}

/** A build context the caller has already packed as a tar archive. */
export interface ArchiveContext {
	/** The archive: its bytes, or a function that opens it afresh, so that a retried request sends the same bytes. */
	readonly archive: Uint8Array | (() => Readable);
	/** The recipe's path inside the archive; when undefined, the service reads `Endiafile` at its root when it holds one, and `Dockerfile` otherwise. */
	readonly recipe?: string;
}

/**
 * The image routes: build, list, inspect, tag and remove, and the prune of the build cache that builds leave. A build and a prune
 * each return an `OperationHandle`, because the service does that work in the background.
 */
export class ImagesClient {
	private readonly connection: ApiConnection;
	private readonly operations: OperationsClient;

	/** @internal */
	constructor(connection: ApiConnection, operations: OperationsClient) {
		this.connection = connection;
		this.operations = operations;
	}

	/**
	 * Builds an image from a recipe and its context: `endia build`. A context folder is packed into a temporary archive as the CLI
	 * packs it, honouring its ignore file, and the archive is deleted once the service has accepted the build.
	 *
	 * @param context - A context folder with its recipe, or an archive the caller packed.
	 * @param options - The tags, build arguments, labels and resources.
	 * @returns The build's operation; its result is a `BuildResult`. Cancelling the request does not stop a build that has started.
	 */
	async build(context: FolderContext | ArchiveContext, options: BuildOptions = {}): Promise<OperationHandle<BuildResult>> {
		if ("archive" in context) {
			const archive = context.archive;
			const body = tarBody(archive);
			return this.sendBuild(body, context.recipe, options);
		}

		const packed = await packBuildContext(context.folder, context.recipe);
		try {
			return await this.sendBuild(packed.archive.body, packed.recipe, options);
		}
		finally {
			await packed.archive.delete();
		}
	}

	/**
	 * Lists images: `endia images`.
	 *
	 * @param options - `filters` such as `{ dangling: ["true"] }`, and a `reference` pattern such as `lab/*`.
	 * @returns The images.
	 */
	list(options: { readonly filters?: Filters; readonly reference?: string; readonly signal?: AbortSignal } = {}): Promise<ImageSummary[]> {
		const query = new QueryText().addJson("filters", options.filters).add("reference", options.reference);
		return this.connection.read(Routes.images + query.toString(), options.signal);
	}

	/**
	 * Reads one image: `endia image inspect`.
	 *
	 * @param reference - A reference such as `lab/dotnet:10`, a digest, or a unique prefix of an image ID.
	 * @param signal - Cancels the request.
	 * @returns The image.
	 */
	inspect(reference: string, signal?: AbortSignal): Promise<ImageDetail> {
		return this.connection.read(Routes.image(reference), signal);
	}

	/**
	 * Points a tag at an image: `endia tag`.
	 *
	 * @param source - The image's reference, digest or ID prefix.
	 * @param target - The new reference, such as `lab/dotnet:approved`.
	 * @param signal - Cancels the request.
	 * @returns The tag, the image it now names, and the image it named before.
	 */
	tag(source: string, target: string, signal?: AbortSignal): Promise<TagResult> {
		return this.connection.change({ method: "PUT", path: Routes.tag(target), body: jsonBody({ source }), signal });
	}

	/**
	 * Removes a tag, and the image once no tag names it: `endia rmi`.
	 *
	 * @param reference - The reference, digest or ID prefix.
	 * @param options - `force` removes an image that several tags name.
	 * @returns Each tag removed and each image deleted.
	 */
	remove(reference: string, options: { readonly force?: boolean; readonly signal?: AbortSignal } = {}): Promise<RemovalEntry[]> {
		const query = new QueryText().addFlag("force", options.force);
		return this.connection.change({ method: "DELETE", path: Routes.image(reference) + query.toString(), signal: options.signal });
	}

	/**
	 * Deletes the unused build cache: `endia builder prune`. A build-cache entry is the committed result of a recipe's stage that a
	 * build made below its target. An entry is unused when no image, machine or other entry is built on it and no running build has
	 * made or found it. The prune deletes every unused entry, repeating until none remains, and leaves the entries that running
	 * builds use.
	 *
	 * @param options - `all` is Docker's `--all`. It deletes the same entries, because once a build has finished the build cache holds
	 * nothing that a build still uses.
	 * @returns The prune's operation; its result names the entries deleted and the space freed.
	 */
	async pruneBuildCache(options: { readonly all?: boolean; readonly signal?: AbortSignal } = {}): Promise<OperationHandle<BuilderPruneResult>> {
		const query = new QueryText().addFlag("all", options.all);
		const accepted = await this.connection.change<Operation>({ method: "POST", path: Routes.builderPrune + query.toString(), signal: options.signal });
		return this.operations.handle<BuilderPruneResult>(accepted);
	}

	private async sendBuild(body: RequestBody, recipe: string | undefined, options: BuildOptions): Promise<OperationHandle<BuildResult>> {
		const query = new QueryText()
			.addEach("t", options.tags)
			.add("dockerfile", recipe)
			.addJson("buildargs", options.buildArgs)
			.addJson("labels", options.labels)
			.add("target", options.target)
			.add("memory", options.memory)
			.add("cpus", options.cpus)
			.addFlag("nocache", options.noCache);
		const accepted = await this.connection.change<Operation>({ method: "POST", path: Routes.build + query.toString(), body, signal: options.signal }, false);
		return this.operations.handle<BuildResult>(accepted);
	}
}
