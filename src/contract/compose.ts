/**
 * A resolved Compose model, as `endia compose config --format json` prints it: long syntax, every path absolute, and the project
 * name set. The service checks the whole model; this client reads only the parts that name files on the caller's side.
 */
export interface ComposeModel {
	/** The project name, which is the fleet's name. */
	readonly name: string;
	/** The services by name. */
	readonly services: Readonly<Record<string, ComposeService>>;
	readonly [member: string]: unknown;
}

/** The parts of one service of a resolved Compose model that name files on the caller's side. */
export interface ComposeService {
	readonly build?: { readonly context?: string; readonly dockerfile?: string; readonly [member: string]: unknown } | null;
	readonly volumes?: readonly { readonly type?: string; readonly source?: string; readonly [member: string]: unknown }[] | null;
	/** The services this one depends on: a map by service name in the resolved model, or a list of names. */
	readonly depends_on?: Readonly<Record<string, unknown>> | readonly string[] | null;
	readonly [member: string]: unknown;
}
