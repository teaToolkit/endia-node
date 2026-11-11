import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeFrame, encodeFrame, FrameStream } from "../../src/exec/exec-frame.js";

describe("exec frames", () => {
	// Examples of use. The bytes are written out from Docker's multiplexed format: the stream, three zero bytes, the payload's
	// length as a big-endian 32-bit integer, then the payload.

	it("encodeFrame_StandardInput_WritesTheHeaderThenThePayload", () => {
		assert.deepEqual(encodeFrame(FrameStream.stdin, Buffer.from("dir\r\n")), Buffer.from([0, 0, 0, 0, 0, 0, 0, 5, 0x64, 0x69, 0x72, 0x0d, 0x0a]));
	});

	it("encodeFrame_EmptyStandardInput_IsTheFrameThatClosesIt", () => {
		assert.deepEqual(encodeFrame(FrameStream.stdin, Buffer.alloc(0)), Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]));
	});

	it("decodeFrame_StandardError_GivesItsStreamAndPayload", () => {
		const frame = decodeFrame(Buffer.from([2, 0, 0, 0, 0, 0, 0, 3, 0x6e, 0x6f, 0x21]));
		assert.equal(frame?.stream, FrameStream.stderr);
		assert.equal(frame.payload.toString("utf8"), "no!");
	});

	it("decodeFrame_PayloadOfMoreThan255Bytes_ReadsTheWholeLength", () => {
		const payload = Buffer.alloc(70_000, 0x61);
		const frame = decodeFrame(Buffer.concat([Buffer.from([1, 0, 0, 0, 0x00, 0x01, 0x11, 0x70]), payload]));
		assert.equal(frame?.payload.length, 70_000);
	});

	// Examples of misuse

	for (const [situation, message] of [
		["ShorterThanAHeader", [1, 0, 0, 0, 0, 0]],
		["UnknownStream", [3, 0, 0, 0, 0, 0, 0, 0]],
		["NonZeroPadding", [1, 0, 1, 0, 0, 0, 0, 0]],
		["LengthLongerThanThePayload", [1, 0, 0, 0, 0, 0, 0, 2, 0x61]],
		["LengthShorterThanThePayload", [1, 0, 0, 0, 0, 0, 0, 1, 0x61, 0x62]],
	] as const) {
		it(`decodeFrame_${situation}_IsNotAFrame`, () => {
			assert.equal(decodeFrame(Buffer.from(message)), undefined);
		});
	}
});
