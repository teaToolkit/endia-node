/**
 * The paths of the API's routes, each built from its parts with every name escaped. One place builds them, so that a route group
 * cannot misspell a path or forget to escape a name.
 */
export const Routes = {
	version: "/v1/version",
	info: "/v1/info",
	hostStats: "/v1/host/stats",
	systemDf: "/v1/system/df",
	systemPrune: "/v1/system/prune",
	builderPrune: "/v1/builder/prune",
	images: "/v1/images",
	build: "/v1/images/build",
	baseImport: "/v1/bases/import",
	basePrepare: "/v1/bases/prepare",
	clients: "/v1/clients",
	operations: "/v1/operations",
	fleets: "/v1/fleets",
	machines: "/v1/machines",
	volumes: "/v1/volumes",

	// An image reference may hold "/", and the route takes the rest of the path, so each part is escaped on its own.
	image: (reference: string) => `/v1/images/${escapeEachPart(reference)}`,
	tag: (target: string) => `/v1/images/tags/${escapeEachPart(target)}`,

	operation: (id: string) => `/v1/operations/${encodeURIComponent(id)}`,
	operationLog: (id: string) => `${Routes.operation(id)}/log`,
	operationCancel: (id: string) => `${Routes.operation(id)}/cancel`,

	fleet: (name: string) => `/v1/fleets/${encodeURIComponent(name)}`,
	fleetLogs: (name: string) => `${Routes.fleet(name)}/logs`,
	fleetStop: (name: string) => `${Routes.fleet(name)}/stop`,
	fleetStart: (name: string) => `${Routes.fleet(name)}/start`,
	fleetRestart: (name: string) => `${Routes.fleet(name)}/restart`,
	fleetPurpose: (name: string) => `${Routes.fleet(name)}/purpose`,

	machine: (name: string) => `/v1/machines/${encodeURIComponent(name)}`,
	machineStart: (name: string) => `${Routes.machine(name)}/start`,
	machineStop: (name: string) => `${Routes.machine(name)}/stop`,
	machineRestart: (name: string) => `${Routes.machine(name)}/restart`,
	machineLogs: (name: string) => `${Routes.machine(name)}/logs`,
	machinePurpose: (name: string) => `${Routes.machine(name)}/purpose`,
	machineStats: (name: string) => `${Routes.machine(name)}/stats`,
	machineExec: (name: string) => `${Routes.machine(name)}/exec`,
	machineArchive: (name: string, path: string) => `${Routes.machine(name)}/archive?path=${encodeURIComponent(path)}`,

	processes: (machine: string) => `${Routes.machine(machine)}/processes`,
	process: (machine: string, processId: number) => `${Routes.processes(machine)}/${String(processId)}`,
	processWait: (machine: string, processId: number) => `${Routes.process(machine, processId)}/wait`,
	processStop: (machine: string, processId: number) => `${Routes.process(machine, processId)}/stop`,
	processLogs: (machine: string, processId: number) => `${Routes.process(machine, processId)}/logs`,

	desktop: (machine: string, action: DesktopAction) => `${Routes.machine(machine)}/desktop/${action}`,

	exec: (id: string) => `/v1/execs/${encodeURIComponent(id)}`,
	execStart: (id: string) => `${Routes.exec(id)}/start`,
	execResize: (id: string) => `${Routes.exec(id)}/resize`,

	client: (name: string) => `/v1/clients/${encodeURIComponent(name)}`,
	volume: (name: string) => `/v1/volumes/${encodeURIComponent(name)}`,
} as const;

/** The last part of each desktop route's path, after `/v1/machines/{name}/desktop/`. */
export type DesktopAction =
	| "launch"
	| "screenshot"
	| "inspect"
	| "wait"
	| "invoke"
	| "click"
	| "set-value"
	| "keys"
	| "pointer"
	| "windows"
	| "tray"
	| "tray/click"
	| "uac";

/** The media types of the bodies the client sends and reads. */
export const MediaTypes = {
	json: "application/json",
	tar: "application/x-tar",
} as const;

/** The headers the API defines beyond HTTP's own. */
export const Headers = {
	idempotencyKey: "Idempotency-Key",
	/** A HEAD answer's error, as Base64 of the error's JSON, because a HEAD answer has no body. */
	error: "X-EastIndia-Error",
	/** A path's description on the archive routes, as Base64 of its JSON. */
	pathStat: "X-EastIndia-Path-Stat",
	screenshotWidth: "X-EastIndia-Width",
	screenshotHeight: "X-EastIndia-Height",
	screenshotSession: "X-EastIndia-Session",
	screenshotTaken: "X-EastIndia-Taken",
} as const;

function escapeEachPart(reference: string): string {
	return reference.split("/").map(encodeURIComponent).join("/");
}
