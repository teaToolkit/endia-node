import type { Timestamp } from "./common.js";

/** One reading of the host, as `endia stats --host` shows it above the machines: its processor use, its memory, the memory EastIndia keeps free and the memory the running machines hold, so that one command shows how much room is left. */
export interface HostStats {
	/** When the reading was taken. */
	readonly read: Timestamp;
	/** The host's number of logical processors. */
	readonly logicalProcessors: number;
	/** The share of all the host's logical processors in use during the last interval, from 0 to 100; null when not taken. */
	readonly cpuPercent: number | null;
	/** The host's physical memory; null when not taken. */
	readonly memoryTotalBytes: number | null;
	/** The host's available memory; null when not taken. */
	readonly memoryAvailableBytes: number | null;
	/** The memory that must remain free after a virtual machine starts: `hostReserveMiB`. */
	readonly memoryReserveBytes: number;
	/** The memory that every running virtual machine EastIndia owns started with. */
	readonly machinesMemoryBytes: number;
	/** Each reading that is null, with the reason. */
	readonly unavailable: readonly UnavailableReading[];
}

/** One reading of a machine, as `endia stats` shows it in a row, as `docker stats` shows a container's: processor use, memory, network and disk traffic and the number of processes. The hypervisor measures the processors, the cards and the disks from outside; the guest service reports memory in use and the processes from inside. */
export interface MachineStats {
	/** When the reading was taken. */
	readonly read: Timestamp;
	/** The machine ID. */
	readonly id: string;
	/** The machine name. */
	readonly name: string;
	/** The machine's state, as `endia ps` shows it. */
	readonly state: string;
	/** The machine's number of virtual processors. */
	readonly processors: number;
	/** The processor time the machine's virtual processors used during the last interval, as a percentage of one host logical processor, so that a machine keeping two processors busy shows 200, as Docker shows it on Linux; null when not taken. */
	readonly cpuPercent: number | null;
	/** The memory in use inside Windows (physical memory less available memory, as Task Manager counts it); null when not taken. */
	readonly memoryUsageBytes: number | null;
	/** The most memory the machine may grow to. */
	readonly memoryLimitBytes: number;
	/** The bytes all the machine's cards received since its virtual machine started; null when not taken. */
	readonly networkReceivedBytes: number | null;
	/** The bytes all the machine's cards sent since its virtual machine started; null when not taken. */
	readonly networkSentBytes: number | null;
	/** The bytes read from all the machine's disks since its virtual machine started; null when not taken. */
	readonly diskReadBytes: number | null;
	/** The bytes written to all the machine's disks since its virtual machine started; null when not taken. */
	readonly diskWrittenBytes: number | null;
	/** The number of processes in Windows; null when not taken. */
	readonly processes: number | null;
	/** Each reading that is null, with the reason. */
	readonly unavailable: readonly UnavailableReading[];
}

/** A reading that could not be taken, and why. A reading is never shown as zero when it was not taken: its member is null and an entry of this kind names it. */
export interface UnavailableReading {
	/** The member that is null, for example `cpuPercent`. */
	readonly reading: string;
	/** Why, for example `A rate needs two samples; this is the first.` */
	readonly reason: string;
}
