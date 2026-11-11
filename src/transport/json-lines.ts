import { createInterface } from "node:readline";
import type { Readable } from "node:stream";

/**
 * Reads a stream of JSON objects, one per line (`application/x-ndjson`), which is how the service answers its log and readings
 * routes. The generator yields each object as soon as its line arrives. Blank lines are skipped. Stopping the iteration early destroys the stream, which
 * ends the request.
 *
 * @param stream - The answer's body.
 * @returns The objects, in the order the lines arrive.
 */
export async function* readJsonLines<T>(stream: Readable): AsyncGenerator<T, void, undefined> {
	const lines = createInterface({ input: stream, crlfDelay: Infinity });
	try {
		for await (const line of lines) {
			if (line.length > 0) {
				yield JSON.parse(line) as T;
			}
		}
	}
	finally {
		lines.close();
		stream.destroy();
	}
}
