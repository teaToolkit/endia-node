import type { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { packFleet, selectServices } from "../archives/fleet-archive.js";
import type { ComposeModel } from "../contract/compose.js";
import type { FleetDetail, FleetDownResult, FleetDryRun, FleetMachinesResult, FleetSummary, FleetUpResult } from "../contract/fleets.js";
import type { MachineLogLine, MachineSummary } from "../contract/machines.js";
import type { Operation } from "../contract/operations.js";
import type { FleetPurpose, FleetPurposeResult } from "../contract/purposes.js";
import { MachineFailedError } from "../errors.js";
import { purposeBody, type PurposeBody } from "../purposes.js";
import { Routes } from "../routes.js";
import { jsonBody, tarBody, type ApiConnection, type RequestBody } from "../transport/api-connection.js";
import { QueryText } from "../transport/query-text.js";
import { addLogOptions, type LogOptions } from "./machines.js";
import type { OperationHandle, OperationsClient } from "./operations.js";

/** How `compose up` brings the fleet to the state its model describes, as the options of `endia compose up` choose it. */
export interface FleetUpOptions {
	/** The services to bring up, with the services they depend on; every service when undefined or empty. */
	readonly services?: readonly string[];
	/** The number of machines of some services, whatever the model says, each written `<service>=<n>`. */
	readonly scale?: readonly string[];
	/** When images are built: `always`, `never`, or `missing`, the default, which builds a service's image only when it does not exist. */
	readonly build?: "always" | "never" | "missing";
	/** When existing machines are recreated: `force`, `never`, or `changed`, the default, which recreates a machine whose service changed. */
	readonly recreate?: "force" | "never" | "changed";
	/** Whether machines of services no longer in the model are removed, rather than named in a warning. */
	readonly removeOrphans?: boolean;
	/** The time in seconds Windows has to shut down in machines being recreated or removed. */
	readonly timeout?: number;
	/** The Compose files the model came from, which the fleet's record keeps and `compose ls` shows. */
	readonly configFiles?: readonly string[];
	/** The folder against which the model's relative paths were resolved, which the fleet's record keeps. */
	readonly projectDirectory?: string;
	/** The fleet's purpose, what it is being used for, in one line of 1 to 200 characters: `--purpose`. The service stores it, replacing any purpose the fleet has, before any other work; undefined leaves the fleet's purpose as it is. It cannot be given with a `FleetArchive`, which carries its own `purpose.json` or none. */
	readonly purpose?: string;
	/** Markdown notes for that purpose, at most 65536 bytes in UTF-8: the text of the file `--purpose-file` names. It needs `purpose`. */
	readonly purposeDetail?: string;
	readonly signal?: AbortSignal;
}

/** The options of `wait`, as the options of `endia compose up --wait` choose them. */
export interface FleetWaitOptions {
	/** The services whose machines to wait for, with the services they depend on; every service when undefined or empty. */
	readonly services?: readonly string[];
	/** The longest wait in seconds, as `--wait-timeout`; no limit when undefined. */
	readonly timeout?: number;
	readonly signal?: AbortSignal;
}

/** How often `wait` reads the fleet, as `endia compose up --wait` does. */
const WaitPollMilliseconds = 1000;

/** The fleet's archive as the caller packed it, holding `compose.json` and every build context and bind mount source it needs. */
export interface FleetArchive {
	/** The fleet's name, which is the Compose project name. */
	readonly name: string;
	/** The archive: its bytes, or a function that opens it afresh, so that a retried request sends the same bytes. */
	readonly archive: Uint8Array | (() => Readable);
}

/** The options of `compose stop` and `compose restart`. */
export interface FleetServicesOptions {
	/** The services whose machines to act on; every service when undefined or empty. */
	readonly services?: readonly string[];
	/** The time in seconds Windows has to shut down before the virtual machine is turned off. */
	readonly timeout?: number;
	readonly signal?: AbortSignal;
}

/**
 * The fleet routes, which bring a Compose project up and down as `docker compose` does, and read, set and clear a fleet's purpose. The client does not read Compose files: `up`
 * takes the resolved model, as `endia compose config --format json` prints it, and packs it with the build contexts and bind mount
 * sources it names into the archive the service expects. The service changes a fleet in the background, so every method that changes
 * one returns a handle that follows that work and gives its result.
 */
export class FleetsClient {
	private readonly connection: ApiConnection;
	private readonly operations: OperationsClient;

	/** @internal */
	constructor(connection: ApiConnection, operations: OperationsClient) {
		this.connection = connection;
		this.operations = operations;
	}

	/**
	 * Brings a fleet to the state its resolved model describes: `endia compose up -d`. The fleet's name is the model's `name`.
	 *
	 * The operation succeeds once every machine it created, recreated or started is ready: its virtual machine runs and it was
	 * configured in this boot, and when its image signs a user in by itself, that user is signed in with the desktop helper ready.
	 * A machine whose user is not signed in within `desktopReadyTimeoutSeconds` fails the operation with `TIMEOUT`. A machine that
	 * was already running and is kept unchanged is not checked again. Health checks are not waited for; `wait` waits for them, and
	 * for kept machines, as `endia compose up --wait` does.
	 *
	 * @param model - The resolved model, as an object or as the JSON text `endia compose config --format json` prints; or an archive
	 * the caller packed.
	 * @param options - Which services, when to build and recreate, and the fleet's purpose.
	 * @returns The operation; its result says what was done to each machine, network and volume.
	 * @throws Error when `purposeDetail` is given without `purpose`, when `purpose` has a line break or `purposeDetail` is too long, or
	 * when a purpose is given with a `FleetArchive`. Nothing is sent then.
	 */
	async up(model: ComposeModel | string | FleetArchive, options: FleetUpOptions = {}): Promise<OperationHandle<FleetUpResult>> {
		const accepted = await this.sendFleet<Operation>(model, options, false);
		return this.operations.handle<FleetUpResult>(accepted);
	}

	/**
	 * Works out what `up` would do and changes nothing: `endia compose up --dry-run`.
	 *
	 * @param model - As for `up`.
	 * @param options - As for `up`. A purpose is checked and sent as `up` sends it.
	 * @returns The planned actions in order, and whether the host has the memory they need.
	 */
	dryRun(model: ComposeModel | string | FleetArchive, options: FleetUpOptions = {}): Promise<FleetDryRun> {
		return this.sendFleet<FleetDryRun>(model, options, true);
	}

	/**
	 * Removes a fleet's machines and networks: `endia compose down`.
	 *
	 * @param name - The fleet's name.
	 * @param options - `volumes` deletes the named volumes too; `removeOrphans` removes machines of services no longer in the model;
	 * `timeout` as for `stop`.
	 * @returns The operation; its result names what was removed.
	 */
	async down(name: string, options: { readonly volumes?: boolean; readonly removeOrphans?: boolean; readonly timeout?: number; readonly signal?: AbortSignal } = {}): Promise<OperationHandle<FleetDownResult>> {
		const query = new QueryText().addFlag("volumes", options.volumes).addFlag("removeOrphans", options.removeOrphans).add("timeout", options.timeout);
		const accepted = await this.connection.change<Operation>({ method: "DELETE", path: Routes.fleet(name) + query.toString(), signal: options.signal });
		return this.operations.handle<FleetDownResult>(accepted);
	}

	/**
	 * Shuts a fleet's machines down: `endia compose stop`.
	 *
	 * @param name - The fleet's name.
	 * @param options - The services, and the shutdown time.
	 * @returns The operation; its result names the machines stopped.
	 */
	stop(name: string, options: FleetServicesOptions = {}): Promise<OperationHandle<FleetMachinesResult>> {
		return this.sendAction(Routes.fleetStop(name), options.services, options.timeout, options.signal);
	}

	/**
	 * Starts a fleet's stopped machines: `endia compose start`.
	 *
	 * @param name - The fleet's name.
	 * @param options - The services.
	 * @returns The operation; its result names the machines started.
	 */
	start(name: string, options: { readonly services?: readonly string[]; readonly signal?: AbortSignal } = {}): Promise<OperationHandle<FleetMachinesResult>> {
		return this.sendAction(Routes.fleetStart(name), options.services, undefined, options.signal);
	}

	/**
	 * Restarts a fleet's machines: `endia compose restart`.
	 *
	 * @param name - The fleet's name.
	 * @param options - The services, and the shutdown time.
	 * @returns The operation; its result names the machines restarted.
	 */
	restart(name: string, options: FleetServicesOptions = {}): Promise<OperationHandle<FleetMachinesResult>> {
		return this.sendAction(Routes.fleetRestart(name), options.services, options.timeout, options.signal);
	}

	/**
	 * Lists fleets: `endia compose ls`.
	 *
	 * @param options - `all` includes fleets with no running machine.
	 * @returns The fleets.
	 */
	list(options: { readonly all?: boolean; readonly signal?: AbortSignal } = {}): Promise<FleetSummary[]> {
		return this.connection.read(Routes.fleets + new QueryText().addFlag("all", options.all).toString(), options.signal);
	}

	/**
	 * Reads one fleet with its machines: `endia compose ps`.
	 *
	 * @param name - The fleet's name.
	 * @param signal - Cancels the request.
	 * @returns The fleet.
	 */
	inspect(name: string, signal?: AbortSignal): Promise<FleetDetail> {
		return this.connection.read(Routes.fleet(name), signal);
	}

	/**
	 * Reads a fleet's purpose with every change to it while the fleet has existed: `endia purpose show`.
	 *
	 * @param name - The fleet's name.
	 * @param signal - Cancels the request.
	 * @returns The purpose, or null, and the history, oldest first.
	 */
	purpose(name: string, signal?: AbortSignal): Promise<FleetPurpose> {
		return this.connection.read(Routes.fleetPurpose(name), signal);
	}

	/**
	 * Replaces a fleet's whole purpose, which its machines without a purpose of their own have: `endia purpose set`.
	 *
	 * @param name - The fleet's name.
	 * @param title - What the fleet is being used for, in one line of 1 to 200 characters.
	 * @param options - `detail` is Markdown notes of at most 65536 bytes in UTF-8; without it the detail stored before is cleared.
	 * @returns The purpose now stored.
	 * @throws Error when the title has a line break or the detail is too long. Nothing is sent then.
	 */
	async setPurpose(name: string, title: string, options: { readonly detail?: string; readonly signal?: AbortSignal } = {}): Promise<FleetPurposeResult> {
		const body = purposeBody(title, options.detail);
		return await this.connection.change({ method: "PUT", path: Routes.fleetPurpose(name), body: jsonBody(body), signal: options.signal });
	}

	/**
	 * Removes a fleet's purpose: `endia purpose clear`. Clearing a fleet without a purpose changes nothing.
	 *
	 * @param name - The fleet's name.
	 * @param signal - Cancels the request.
	 * @returns The purpose now stored, which is null.
	 */
	clearPurpose(name: string, signal?: AbortSignal): Promise<FleetPurposeResult> {
		return this.connection.change({ method: "DELETE", path: Routes.fleetPurpose(name), signal });
	}

	/**
	 * Waits until a fleet's machines are running and ready, and healthy when they have a health check, as `endia compose up --wait`
	 * waits once its operation has succeeded. `up`'s result already comes only once every machine it created, recreated or started
	 * was made ready; this wait adds what `--wait` adds: it checks every selected machine, kept ones too, waits for health checks to
	 * pass, and fails when a machine exits or becomes unhealthy.
	 *
	 * @param name - The fleet's name.
	 * @param options - Which services, as `up` takes them, and the longest wait.
	 * @returns The machines waited for, as last read.
	 * @throws MachineFailedError when a machine exited or became unhealthy.
	 * @throws DOMException named `TimeoutError` when some machine was not yet running, ready and healthy when the time-out passed. The
	 * machines carry on.
	 * @throws Error when a named service is not in the fleet's model.
	 */
	async wait(name: string, options: FleetWaitOptions = {}): Promise<MachineSummary[]> {
		const deadline = options.timeout === undefined ? undefined : Date.now() + options.timeout * 1000;
		let selected: ReadonlySet<string> | undefined;
		for (;;) {
			const fleet = await this.inspect(name, options.signal);
			selected ??= selectServices(fleet.model as ComposeModel, options.services ?? []);
			const machines = fleet.machines.filter((machine) => selected?.has(machine.service) === true);
			const failed = machines.find(hasFailed);
			if (failed !== undefined) {
				throw new MachineFailedError(failed);
			}

			if (machines.every(isUp)) {
				return machines;
			}

			if (deadline !== undefined && Date.now() >= deadline) {
				throw new DOMException(`timed out after ${String(options.timeout)} seconds waiting for the machines to be running and healthy`, "TimeoutError");
			}

			await delay(WaitPollMilliseconds, undefined, { signal: options.signal });
		}
	}

	/**
	 * Reads the main-process output of a fleet's machines, each line naming its machine: `endia compose logs`.
	 *
	 * @param name - The fleet's name.
	 * @param options - Which lines; `services` limits them to some services, and `index` to one machine of each.
	 * @returns The lines, as they arrive.
	 */
	logs(name: string, options: LogOptions & { readonly services?: readonly string[]; readonly index?: number } = {}): AsyncGenerator<MachineLogLine, void, undefined> {
		const query = addLogOptions(new QueryText(), options).addEach("services", options.services).add("index", options.index);
		return this.connection.readLines(Routes.fleetLogs(name) + query.toString(), options.signal);
	}

	// Sends the archive with PUT /v1/fleets/{name}. A model is packed into a temporary archive, which is deleted once the service
	// has answered.
	private async sendFleet<TAnswer>(model: ComposeModel | string | FleetArchive, options: FleetUpOptions, dryRun: boolean): Promise<TAnswer> {
		const purpose = purposeOf(options);
		if (isFleetArchive(model)) {
			if (purpose !== undefined) {
				throw new Error("A purpose cannot be given with a packed archive; put purpose.json in the archive.");
			}

			const archive = model.archive;
			const body = tarBody(archive);
			return this.sendArchive<TAnswer>(model.name, body, options, dryRun);
		}

		const resolved = typeof model === "string" ? JSON.parse(model) as ComposeModel : model;
		const packed = await packFleet(resolved, typeof model === "string" ? model : JSON.stringify(model), options.services ?? [], purpose);
		try {
			return await this.sendArchive<TAnswer>(resolved.name, packed.body, options, dryRun);
		}
		finally {
			await packed.delete();
		}
	}

	private sendArchive<TAnswer>(name: string, body: RequestBody, options: FleetUpOptions, dryRun: boolean): Promise<TAnswer> {
		const query = new QueryText()
			.addEach("services", options.services)
			.addEach("scale", options.scale)
			.add("build", options.build)
			.add("recreate", options.recreate)
			.addFlag("removeOrphans", options.removeOrphans)
			.add("timeout", options.timeout)
			.addFlag("dryRun", dryRun)
			.addEach("configFiles", options.configFiles)
			.add("projectDirectory", options.projectDirectory);
		return this.connection.change<TAnswer>({ method: "PUT", path: Routes.fleet(name) + query.toString(), body, signal: options.signal }, false);
	}

	private async sendAction(path: string, services: readonly string[] | undefined, timeout: number | undefined, signal: AbortSignal | undefined): Promise<OperationHandle<FleetMachinesResult>> {
		const query = new QueryText().addEach("services", services).add("timeout", timeout);
		const accepted = await this.connection.change<Operation>({ method: "POST", path: path + query.toString(), signal });
		return this.operations.handle<FleetMachinesResult>(accepted);
	}
}

// Detail without a title is refused as the CLI refuses --purpose-file without --purpose.
function purposeOf(options: FleetUpOptions): PurposeBody | undefined {
	if (options.purpose === undefined) {
		if (options.purposeDetail !== undefined) {
			throw new Error("purposeDetail needs purpose.");
		}

		return undefined;
	}

	return purposeBody(options.purpose, options.purposeDetail);
}

function isFleetArchive(model: ComposeModel | string | FleetArchive): model is FleetArchive {
	return typeof model === "object" && "archive" in model && (model.archive instanceof Uint8Array || typeof model.archive === "function");
}

/** Whether a machine ends a wait in failure: it exited, or its health check made it unhealthy. */
function hasFailed(machine: MachineSummary): boolean {
	return machine.health === "unhealthy" || machine.state === "exited";
}

/** Whether a machine is what a wait waits for: running and ready, and healthy when it has a health check. */
function isUp(machine: MachineSummary): boolean {
	return machine.state === "running" && machine.ready && (machine.health === "none" || machine.health === "healthy");
}
