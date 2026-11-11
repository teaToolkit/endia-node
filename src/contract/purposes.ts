import type { Timestamp } from "./common.js";

/** Where the purpose in effect for a machine comes from: `machine`, its own purpose, or `fleet`, the purpose of its fleet because it has none of its own. */
export type PurposeSource = "machine" | "fleet";

/** A purpose without its detail, as the lists of fleets and machines carry it. */
export interface PurposeSummary {
	/** What the fleet or machine is being used for, in one line. */
	readonly title: string;
	/** The caller who stored the purpose: the client certificate's name over HTTPS, or `npipe:` followed by the Windows account. */
	readonly setBy: string;
	/** When the service stored the purpose. */
	readonly set: Timestamp;
}

/** A whole purpose: what a caller said a fleet or machine is being used for, with the caller's notes. EastIndia stores and shows it and does nothing else with it. */
export interface PurposeDetail extends PurposeSummary {
	/** The caller's notes in Markdown, exactly as received, or null for none. A sandbox agent may have written them, so a program that renders them should fetch no remote image, open a link only when a person clicks it, and show raw HTML as text. */
	readonly detail: string | null;
}

/** One change to the purpose of a fleet or machine. */
export interface PurposeHistoryEntry {
	/** When the service made the change. */
	readonly time: Timestamp;
	/** What the change did: `set`, when a caller stored a purpose whether or not one was stored before, or `cleared`, when a caller removed the purpose that was stored. */
	readonly action: "set" | "cleared";
	/** The title that was set, or null for a clearing. */
	readonly title: string | null;
	/** The detail that was set, or null for a clearing or a purpose set without detail. */
	readonly detail: string | null;
	/** The caller who made the change, named as `PurposeSummary.setBy` names callers. */
	readonly setBy: string;
}

/** A fleet's purpose with every change to it while the fleet has existed: `endia purpose show`. */
export interface FleetPurpose {
	/** The fleet's purpose, or null when none is set. */
	readonly purpose: PurposeDetail | null;
	/** The changes, oldest first. */
	readonly history: readonly PurposeHistoryEntry[];
}

/** A fleet's purpose once a change is stored. */
export interface FleetPurposeResult {
	/** The purpose just set, or null after a clearing. */
	readonly purpose: PurposeDetail | null;
}

/** A machine's own purpose with every change to it, and the purpose in effect for the machine: `endia purpose show`. */
export interface MachinePurpose {
	/** The machine's own purpose, or null when it has none. */
	readonly purpose: PurposeDetail | null;
	/** The changes to the machine's own purpose, oldest first. Changes to its fleet's purpose are in the fleet's history. */
	readonly history: readonly PurposeHistoryEntry[];
	/** The machine's own purpose, else its fleet's, else null. */
	readonly effective: PurposeDetail | null;
	/** Where `effective` comes from, or null when no purpose is in effect. */
	readonly purposeSource: PurposeSource | null;
}

/** A machine's own purpose once a change is stored, and the purpose in effect then. */
export interface MachinePurposeResult {
	/** The machine's own purpose just set, or null after a clearing. */
	readonly purpose: PurposeDetail | null;
	/** The machine's own purpose, else its fleet's, else null; after a clearing it is the fleet's. */
	readonly effective: PurposeDetail | null;
	/** Where `effective` comes from, or null when no purpose is in effect. */
	readonly purposeSource: PurposeSource | null;
}
