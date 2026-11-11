import type { ApiError, Timestamp } from "./common.js";
import type { PurposeDetail, PurposeSource, PurposeSummary } from "./purposes.js";

/** One machine as `endia ps` and `endia compose ps` list it: what it is, which fleet and service it belongs to, what it runs, and its state, readiness and health as Hyper-V and its record give them now. */
export interface MachineSummary {
	/** The machine ID: the Hyper-V ID of its virtual machine, as a lower-case GUID with hyphens. */
	readonly id: string;
	/** The machine name, for example `classroom-server-1`. */
	readonly name: string;
	/** The name of the fleet the machine belongs to. */
	readonly fleet: string;
	/** The Compose service the machine runs. */
	readonly service: string;
	/** The machine's number among the replicas of its service, from 1. */
	readonly index: number;
	/** The image as the service names it, for example `lab/dotnet:10`. */
	readonly image: string;
	/** The digest of the image the machine was made from. */
	readonly imageDigest: string;
	/** The main process's command line, its words joined by spaces; empty when the machine has no main process. */
	readonly command: string;
	/** When the machine was created. */
	readonly created: Timestamp;
	/** The machine's state: `created`, `running`, `restarting`, `exited` or `removing`. */
	readonly state: string;
	/** The state in Docker's words, such as `Up 3 minutes (healthy)`, as `MachineStatusText` words it. */
	readonly status: string;
	/** The exit code of the machine's last stop, or null when none is recorded. */
	readonly exitCode: number | null;
	/** Whether the machine is ready: its virtual machine runs, it was configured in this boot, and nothing has failed since. */
	readonly ready: boolean;
	/** The machine's health: `none`, `starting`, `healthy` or `unhealthy`. */
	readonly health: string;
	/** The machine's ports published on the host. */
	readonly ports: readonly PortBinding[];
	/** What the machine is being used for: its own purpose, else its fleet's, else null. */
	readonly purpose: PurposeSummary | null;
	/** Where `purpose` comes from, or null when there is none. */
	readonly purposeSource: PurposeSource | null;
}

/** One port of a machine published on the host: a program on the host that connects to `HostIp` and `Published` reaches `Target` inside the machine. */
export interface PortBinding {
	/** The host address the port listens on: `127.0.0.1`. */
	readonly hostIp: string;
	/** The port on the host. */
	readonly published: number;
	/** The TCP port inside the machine. */
	readonly target: number;
}

/** One machine in full, as `endia inspect` prints it: the machine's record with what was created for it and what has happened to it since, and what its virtual machine and guest service report now: its addresses, its boot, and its desktop user. */
export interface MachineDetail {
	/** The machine ID: the Hyper-V ID of its virtual machine, as a lower-case GUID with hyphens. */
	readonly id: string;
	/** The machine name. */
	readonly name: string;
	/** The name of the fleet the machine belongs to. */
	readonly fleet: string;
	/** The Compose service the machine runs. */
	readonly service: string;
	/** The machine's number among the replicas of its service, from 1. */
	readonly index: number;
	/** The image as the service names it. */
	readonly image: string;
	/** The digest of the image the machine was made from. */
	readonly imageDigest: string;
	/** The service's resolved definition the machine was created with, as `compose config --format json` prints a service. */
	readonly definition: unknown;
	/** When the machine was created. */
	readonly created: Timestamp;
	/** The Windows computer name inside the machine. */
	readonly computerName: string;
	/** The most memory the machine may grow to, in bytes: its service's memory limit, or the configured ceiling when the service sets none. */
	readonly memoryBytes: number;
	/** The memory the machine starts with, in bytes. A machine whose record was written when machines had static memory starts with all of `memoryBytes`, and gives that figure here. */
	readonly startupMemoryBytes: number;
	/** The machine's number of virtual processors. */
	readonly processors: number;
	/** The machine's network cards. */
	readonly cards: readonly MachineCardDetail[];
	/** The named volumes attached to the machine. */
	readonly volumes: readonly MachineVolumeDetail[];
	/** The machine's ports published on the host. */
	readonly ports: readonly PortBinding[];
	/** The machine's state: `created`, `running`, `restarting`, `exited` or `removing`. */
	readonly state: string;
	/** Whether the machine is ready, as `MachineSummary.ready` says. When its image signs a user in by itself, ready also means that user was signed in with the desktop helper ready. */
	readonly ready: boolean;
	/** Whether a user stopped the machine, which the restart policy `unless-stopped` respects. */
	readonly stoppedByUser: boolean;
	/** How many times EastIndia has started the machine again under its restart policy. */
	readonly restartCount: number;
	/** When the machine last started, or null when it never has. */
	readonly started: Timestamp | null;
	/** When the machine last stopped, or null when it never has. */
	readonly exited: Timestamp | null;
	/** The exit code of the machine's last stop, or null when none is recorded. */
	readonly exitCode: number | null;
	/** The guest service's boot ID: from the guest service while the machine runs and answers, otherwise the one last recorded, or null. */
	readonly bootId: string | null;
	/** The boot ID of the boot in which the machine was last made ready, or null when it never was. The machine is ready while it runs, has no last error, and this ID equals the boot ID recorded for its current boot. */
	readonly readyBootId: string | null;
	/** The machine's main process as last recorded, or null when it has none or it has not started. */
	readonly mainProcess: MainProcessDetail | null;
	/** The machine's health checks: their status, failing streak and last results. */
	readonly health: MachineHealthDetail;
	/** The error that last stopped the machine or kept it from starting, or null. */
	readonly lastError: ApiError | null;
	/** The machine's IPv4 addresses by network: each fleet network's static address under the network's name, and the address Hyper-V reports for the `internet` card under `internet` while the machine runs. */
	readonly addresses: Readonly<Record<string, string>>;
	/** The account signed in on the machine's desktop, or null when none is or the guest service does not answer. */
	readonly desktopUser: string | null;
	/** Whether the desktop helper in that account's session has reported ready. */
	readonly desktopReady: boolean;
	/** Whether the elevation prompt can be automated, which is when `PromptOnSecureDesktop` is 0 in the machine; null while the guest service does not report that value. */
	readonly uacPromptAutomation: boolean | null;
	/** What the machine is being used for, in full: its own purpose, else its fleet's, else null. */
	readonly purpose: PurposeDetail | null;
	/** Where `purpose` comes from, or null when there is none. */
	readonly purposeSource: PurposeSource | null;
}

/** One network card of a machine: the network and switch it is on, and the addresses it was given. */
export interface MachineCardDetail {
	/** The name of the fleet network the card is on, or `internet` for the card on the host's internet switch. */
	readonly network: string;
	/** The name of the Hyper-V switch the card is connected to. */
	readonly switchName: string;
	/** The card's MAC address. */
	readonly macAddress: string;
	/** The card's static IPv4 address on a fleet network, or null for the `internet` card, which takes its address by DHCP. */
	readonly ipv4Address: string | null;
}

/** One named volume attached to a machine: where its disk is attached and where the guest service mounts it. */
export interface MachineVolumeDetail {
	/** The volume's name. */
	readonly name: string;
	/** The folder inside the machine where the volume is mounted, for example `C:\data`. */
	readonly target: string;
	/** Whether the volume is mounted read-only. */
	readonly readOnly: boolean;
	/** The location on SCSI controller 0 where the volume's disk is attached: 1 for the first volume, 2 for the next, and so on. */
	readonly scsiLocation: number;
}

/** A machine's main process as last recorded: its process ID and start time, and once it has exited, its exit code and exit time. */
export interface MainProcessDetail {
	/** The process ID inside the machine. */
	readonly pid: number;
	/** When the process started. */
	readonly started: Timestamp;
	/** The process's exit code, or null while it runs. */
	readonly exitCode: number | null;
	/** When the process exited, or null while it runs. */
	readonly exited: Timestamp | null;
}

/** A machine's health checks as `endia inspect` shows them: the status they have given it, how many have failed in a row, and the last results, so that a caller can see why a machine is unhealthy. */
export interface MachineHealthDetail {
	/** The status: `none`, `starting`, `healthy` or `unhealthy`. */
	readonly status: string;
	/** How many checks in a row have failed since the last success. */
	readonly failingStreak: number;
	/** The last five results at most, oldest first. */
	readonly log: readonly HealthCheckRunDetail[];
}

/** One run of a machine's health check: when it ran, how it exited and what it printed. */
export interface HealthCheckRunDetail {
	/** When the check started. */
	readonly start: Timestamp;
	/** When the check ended. */
	readonly end: Timestamp;
	/** The check's exit code; 0 is a success. */
	readonly exitCode: number;
	/** What the check printed, cut to 4096 bytes. */
	readonly output: string;
}

/** One line of a machine's main process output, as the log routes stream it, one JSON object per line of `application/x-ndjson`. A fleet's log route names the machine of each line; a machine's own log route does not. */
export interface MachineLogLine {
	/** The machine that wrote the line; present only in a fleet's log. */
	readonly machine?: string | null;
	/** When the line was written. */
	readonly time: Timestamp;
	/** The output the line came from: `stdout` or `stderr`. */
	readonly stream: string;
	/** The text of the line, without its line ending. */
	readonly line: string;
}

/** The result of `endia start` and `endia stop`: the machines the operation acted on. */
export interface MachinesResult {
	/** The names of the machines started or stopped. */
	readonly machines: readonly string[];
}

/** The result of `endia restart` for one machine: the boot it left, the boot it reached, and whether its virtual machine had to be turned off. */
export interface MachineRestartResult {
	/** The machine's name. */
	readonly name: string;
	/** The guest service's boot ID before the restart, or null when the machine was not running. */
	readonly previousBootId: string | null;
	/** The guest service's boot ID after the restart, which a restart that succeeds always has. */
	readonly bootId: string;
	/** Whether the virtual machine was turned off rather than Windows restarting in an orderly way. */
	readonly turnedOff: boolean;
}
