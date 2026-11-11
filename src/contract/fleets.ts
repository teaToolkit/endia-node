import type { Timestamp } from "./common.js";
import type { MachineSummary } from "./machines.js";
import type { PurposeDetail, PurposeSummary } from "./purposes.js";

/** One planned action in a dry run: what would be done, to what, and why. */
export interface DryRunAction {
	/** What would be done: `createNetwork`, `createVolume`, `build`, `create`, `recreate`, `start`, `remove` or `keep`. */
	readonly action: string;
	/** What it would be done to: a network or volume name, a service name for a build, or a machine name. */
	readonly target: string;
	/** Why, in words for the caller, such as `no machine has index 3`. */
	readonly reason: string;
}

/** One fleet as `endia compose ps` reads it: the fleet's record, with each of its machines as `endia ps` lists one. */
export interface FleetDetail {
	/** The fleet name, which is the Compose project name. */
	readonly name: string;
	/** The paths of the Compose files as the CLI sent them with the last `compose up`. */
	readonly configFiles: readonly string[];
	/** The folder against which the CLI resolved relative paths. */
	readonly projectDirectory: string;
	/** The resolved Compose model of the last `compose up`, as `compose config --format json` prints it. */
	readonly model: unknown;
	/** The fleet's private networks. */
	readonly networks: readonly FleetNetworkDetail[];
	/** The names of the named volumes the fleet declares. */
	readonly volumes: readonly string[];
	/** The fleet's machines, sorted by service and then by index. */
	readonly machines: readonly MachineSummary[];
	/** When the fleet was first brought up. */
	readonly created: Timestamp;
	/** When the fleet's record was last changed. */
	readonly updated: Timestamp;
	/** What the fleet is being used for, in full, or null when it has no purpose. Each machine without a purpose of its own has it. */
	readonly purpose: PurposeDetail | null;
}

/** What `compose down` removed, as its operation's result, with the warnings for the caller. */
export interface FleetDownResult {
	/** The fleet name. */
	readonly fleet: string;
	/** The machines removed, in the order they were removed: dependants before the services they depend on. */
	readonly machines: readonly string[];
	/** The networks whose switches were removed. */
	readonly networks: readonly string[];
	/** The named volumes whose disks were deleted. */
	readonly volumes: readonly string[];
	/** The warnings, in Docker Compose's words where Docker Compose has them. */
	readonly warnings: readonly string[];
}

/** The answer to `compose up --dry-run`: what `compose up` would do, in order, and whether the host has the memory the machines it would start need. Nothing is changed to give it. */
export interface FleetDryRun {
	/** The planned actions, in the order `compose up` would perform them. */
	readonly actions: readonly DryRunAction[];
	/** The memory, in bytes, of the machines the plan would start: those it creates, recreates or starts. */
	readonly memoryRequiredBytes: number;
	/** The host's free memory, in bytes, less `hostReserveMiB`. */
	readonly memoryAvailableBytes: number;
}

/** The result of `compose stop`, `compose start` and `compose restart`: the machines acted on, in the order they were acted on, and the warnings for the caller. */
export interface FleetMachinesResult {
	/** The fleet name. */
	readonly fleet: string;
	/** The machines stopped, started or restarted, in order. */
	readonly machines: readonly string[];
	/** The warnings, in Docker Compose's words where Docker Compose has them. */
	readonly warnings: readonly string[];
}

/** One private network of a fleet: the Hyper-V switch that carries it, its address range and each machine's address on it. */
export interface FleetNetworkDetail {
	/** The network's key in the Compose model, for example `backend`. */
	readonly key: string;
	/** The network's name: its `name` in the Compose model, or else `<fleet>_<key>`. */
	readonly name: string;
	/** The name of the private Hyper-V switch. */
	readonly switchName: string;
	/** Hyper-V's identifier of the switch. */
	readonly switchId: string;
	/** The address range in CIDR form, for example `10.231.0.0/24`. */
	readonly subnet: string;
	/** Whether the network is internal: its machines have no card on the host's internet switch. */
	readonly internal: boolean;
	/** The IPv4 address of each machine on the network, by machine name. */
	readonly addresses: Readonly<Record<string, string>>;
}

/** One fleet as `endia compose ls` lists it: its name, how many of its machines are in each state, and the Compose files its last `compose up` came from. */
export interface FleetSummary {
	/** The fleet name, which is the Compose project name. */
	readonly name: string;
	/** The number of machines in each state, as Docker Compose words it: each state with its count in brackets, the states sorted by name and joined by a comma and a space, such as `exited(1), running(3)`; empty for a fleet without machines. A listing that does not ask for every fleet counts only running and restarting machines. */
	readonly status: string;
	/** The paths of the Compose files as the CLI sent them with the last `compose up`. */
	readonly configFiles: readonly string[];
	/** What the fleet is being used for, or null when it has no purpose. */
	readonly purpose: PurposeSummary | null;
}

/** What `compose up` did, as its operation's result: each machine, network and volume of the fleet with what was done to it, and the warnings for the caller. */
export interface FleetUpResult {
	/** The fleet name. */
	readonly fleet: string;
	/** Each machine the plan acted on or kept, in the order of the plan. */
	readonly machines: readonly MachineOutcome[];
	/** Each network the selected services join, in the order the project declares them. */
	readonly networks: readonly NetworkOutcome[];
	/** Each named volume the selected services mount, in the order the project declares them. */
	readonly volumes: readonly VolumeOutcome[];
	/** The warnings, in Docker Compose's words where Docker Compose has them, such as the list of orphan machines. */
	readonly warnings: readonly string[];
}

/** One machine in the result of `compose up`: what was done to it, and its state and health once the operation finished. */
export interface MachineOutcome {
	/** The machine name, such as `classroom-trainee-2`. */
	readonly name: string;
	/** The machine's service. */
	readonly service: string;
	/** What was done: `created`, `recreated`, `started`, `removed` or `unchanged`. */
	readonly action: string;
	/** The machine's state as its record holds it, such as `running`; `removed` for a machine that no longer exists. */
	readonly state: string;
	/** The machine's health: `none`, `starting`, `healthy` or `unhealthy`. */
	readonly health: string;
}

/** One network in the result of `compose up`: its name, its subnet and whether this run created it. */
export interface NetworkOutcome {
	/** The network's name, such as `classroom_classroom`. */
	readonly name: string;
	/** The subnet in CIDR form, such as `10.231.10.0/24`. */
	readonly subnet: string;
	/** `created` or `unchanged`. */
	readonly action: string;
}

/** One named volume in the result of `compose up`: its name and whether this run created its disk. */
export interface VolumeOutcome {
	/** The volume's name, such as `classroom_server-data`. */
	readonly name: string;
	/** `created` or `unchanged`. */
	readonly action: string;
}
