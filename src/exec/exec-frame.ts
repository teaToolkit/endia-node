/**
 * The stream a frame carries bytes for; the value is the frame's first byte.
 */
export const FrameStream = {
	stdin: 0,
	stdout: 1,
	stderr: 2,
} as const;

/** One of the three streams a frame can carry. */
export type FrameStream = (typeof FrameStream)[keyof typeof FrameStream];

/** One message of an attached exec without a console: which stream the bytes belong to, and the bytes. */
export interface ExecFrame {
	readonly stream: FrameStream;
	readonly payload: Buffer;
}

/** The length of a frame's header, in bytes. */
const HeaderLength = 8;

/** Where the payload's length starts in the header. */
const LengthOffset = 4;

/**
 * Writes one frame in Docker's multiplexed format, the form in which an attached exec without a console carries its streams over
 * one WebSocket. The frame is an eight-byte header followed by the payload:
 *
 * - byte 0 is the stream: 0 standard input, 1 standard output, 2 standard error;
 * - bytes 1 to 3 are zero;
 * - bytes 4 to 7 are the payload's length as a big-endian unsigned integer.
 *
 * When the client sends a standard-input frame with an empty payload, the service closes the program's standard input.
 *
 * @param stream - The stream the payload belongs to.
 * @param payload - The bytes.
 * @returns The header followed by the payload.
 */
export function encodeFrame(stream: FrameStream, payload: Uint8Array): Buffer {
	const frame = Buffer.alloc(HeaderLength + payload.byteLength);
	frame[0] = stream;
	frame.writeUInt32BE(payload.byteLength, LengthOffset);
	frame.set(payload, HeaderLength);
	return frame;
}

/**
 * Reads one whole WebSocket message as one frame, the reverse of `encodeFrame`.
 *
 * @param message - One whole binary message.
 * @returns The frame; undefined when the message is not exactly one frame with a header naming a known stream, bytes 1 to 3 zero,
 * and as many payload bytes as the header gives.
 */
export function decodeFrame(message: Buffer): ExecFrame | undefined {
	if (message.length < HeaderLength || message[1] !== 0 || message[2] !== 0 || message[3] !== 0) {
		return undefined;
	}

	const stream = message[0];
	if (stream !== FrameStream.stdin && stream !== FrameStream.stdout && stream !== FrameStream.stderr) {
		return undefined;
	}

	return message.readUInt32BE(LengthOffset) === message.length - HeaderLength ? { stream, payload: message.subarray(HeaderLength) } : undefined;
}
