import type { Timestamp } from "../contract/common.js";
import type {
	ClickRequest,
	DesktopInspectRequest,
	DesktopInspectResult,
	DesktopLaunchRequest,
	DesktopLaunchResult,
	DesktopWaitRequest,
	DesktopWaitResult,
	DesktopWindow,
	InvokeRequest,
	InvokeResult,
	KeysRequest,
	KeysResult,
	PointerRequest,
	PointerResult,
	SetValueRequest,
	SetValueResult,
	TrayClickRequest,
	TrayClickResult,
	TrayIcon,
	UacRequest,
	UacResult,
} from "../contract/desktop.js";
import { Headers, Routes, type DesktopAction } from "../routes.js";
import { jsonBody, type Answer, type ApiConnection } from "../transport/api-connection.js";

/** A picture of the desktop user's screen, or of one process's windows. */
export interface DesktopScreenshot {
	/** The picture as PNG bytes. */
	readonly png: Buffer;
	readonly width: number;
	readonly height: number;
	/** The Windows session the picture was taken in. */
	readonly sessionId: number;
	readonly taken: Timestamp;
}

/**
 * The desktop routes of a running machine, which drive the signed-in desktop user's session through UI Automation, the Windows
 * interface that reads and operates the controls of other programs' windows. A program is launched with `launch`; its controls are
 * then found by a selector whose first segment names one of the program's top-level windows, and operated with `invoke`, `click`,
 * `setValue` and `keys`.
 */
export class DesktopClient {
	private readonly connection: ApiConnection;

	/** @internal */
	constructor(connection: ApiConnection) {
		this.connection = connection;
	}

	/**
	 * Starts a program in the desktop user's session: `endia desktop launch`.
	 *
	 * @param machine - The machine name or a unique prefix of its ID.
	 * @param request - The program, its arguments, and whether to start it elevated.
	 * @param signal - Cancels the request.
	 * @returns The process and its windows; its `processId` and `started` name the process in the other desktop requests.
	 */
	launch(machine: string, request: DesktopLaunchRequest, signal?: AbortSignal): Promise<DesktopLaunchResult> {
		return this.send(machine, "launch", request, signal);
	}

	/**
	 * Takes a picture of the screen: `endia desktop screenshot`. It changes nothing, so it carries no `Idempotency-Key`.
	 *
	 * @param machine - The machine name or a unique prefix of its ID.
	 * @param options - `processId` limits the picture to that process's windows.
	 * @returns The picture.
	 */
	async screenshot(machine: string, options: { readonly processId?: number; readonly signal?: AbortSignal } = {}): Promise<DesktopScreenshot> {
		const answer = await this.connection.sendWithoutKey({
			method: "POST",
			path: Routes.desktop(machine, "screenshot"),
			body: jsonBody({ processId: options.processId }),
			signal: options.signal,
		});
		return {
			png: answer.body,
			width: Number(header(answer, Headers.screenshotWidth)),
			height: Number(header(answer, Headers.screenshotHeight)),
			sessionId: Number(header(answer, Headers.screenshotSession)),
			taken: header(answer, Headers.screenshotTaken),
		};
	}

	/**
	 * Reads the tree of controls in a process's windows: `endia desktop inspect`.
	 *
	 * @param machine - The machine name or a unique prefix of its ID.
	 * @param request - The process, and optionally one of its windows.
	 * @param signal - Cancels the request.
	 * @returns Each window with its tree of elements.
	 */
	inspect(machine: string, request: DesktopInspectRequest, signal?: AbortSignal): Promise<DesktopInspectResult> {
		return this.send(machine, "inspect", request, signal);
	}

	/**
	 * Waits until a selector names exactly one element, or with `gone` until it names none: `endia desktop wait`. The service
	 * answers only when the wait ends, so the client's own time limit does not apply; `timeoutSeconds` limits the wait.
	 *
	 * @param machine - The machine name or a unique prefix of its ID.
	 * @param request - The process, the selector and the longest wait.
	 * @param signal - Cancels the request.
	 * @returns The element and its window; both null after a wait for `gone`.
	 */
	wait(machine: string, request: DesktopWaitRequest, signal?: AbortSignal): Promise<DesktopWaitResult> {
		return this.connection.change({ method: "POST", path: Routes.desktop(machine, "wait"), body: jsonBody(request), signal }, false);
	}

	/**
	 * Uses an element's Invoke pattern, as pressing a button does: `endia desktop invoke`.
	 *
	 * @param machine - The machine name or a unique prefix of its ID.
	 * @param request - The process and the selector.
	 * @param signal - Cancels the request.
	 * @returns Whether the element was invoked.
	 */
	invoke(machine: string, request: InvokeRequest, signal?: AbortSignal): Promise<InvokeResult> {
		return this.send(machine, "invoke", request, signal);
	}

	/**
	 * Clicks the pointer at an element's centre: `endia desktop click`.
	 *
	 * @param machine - The machine name or a unique prefix of its ID.
	 * @param request - The process, the selector and the button.
	 * @param signal - Cancels the request.
	 * @returns The point clicked on the screen.
	 */
	click(machine: string, request: ClickRequest, signal?: AbortSignal): Promise<PointerResult> {
		return this.send(machine, "click", request, signal);
	}

	/**
	 * Sets an element's value, such as a text box's text: `endia desktop set-value`. A secret value, such as a password, is sent
	 * once, without an `Idempotency-Key` and without a retry, so that the service never stores it.
	 *
	 * @param machine - The machine name or a unique prefix of its ID.
	 * @param request - The process, the selector, the value, and whether it is secret.
	 * @param signal - Cancels the request.
	 * @returns The value read back, or null for a secret value.
	 */
	setValue(machine: string, request: SetValueRequest, signal?: AbortSignal): Promise<SetValueResult> {
		const exchange = { method: "POST", path: Routes.desktop(machine, "set-value"), body: jsonBody(request), signal } as const;
		return request.secret === true ? this.connection.sendOnce(exchange) : this.connection.change(exchange);
	}

	/**
	 * Types keys or text into a process's main window: `endia desktop keys`. The service brings the window to the foreground and
	 * checks that it is there before sending anything; otherwise it refuses the request with `FOCUS_REFUSED`.
	 *
	 * @param machine - The machine name or a unique prefix of its ID.
	 * @param request - The process, and `keys` as space-separated chords such as `ctrl+s`, or `text` to type as it is.
	 * @param signal - Cancels the request.
	 * @returns The number of input events sent.
	 */
	keys(machine: string, request: KeysRequest, signal?: AbortSignal): Promise<KeysResult> {
		return this.send(machine, "keys", request, signal);
	}

	/**
	 * Moves, clicks or scrolls the pointer at a point: `endia desktop pointer`.
	 *
	 * @param machine - The machine name or a unique prefix of its ID.
	 * @param request - The action, the point, and optionally the process whose window the point is relative to.
	 * @param signal - Cancels the request.
	 * @returns The point on the screen, and the window under it.
	 */
	pointer(machine: string, request: PointerRequest, signal?: AbortSignal): Promise<PointerResult> {
		return this.send(machine, "pointer", request, signal);
	}

	/**
	 * Lists the visible top-level windows of the desktop user's session: `endia desktop windows`.
	 *
	 * @param machine - The machine name or a unique prefix of its ID.
	 * @param signal - Cancels the request.
	 * @returns The windows.
	 */
	windows(machine: string, signal?: AbortSignal): Promise<DesktopWindow[]> {
		return this.connection.read(Routes.desktop(machine, "windows"), signal);
	}

	/**
	 * Lists the icons of the notification area: `endia desktop tray ls`.
	 *
	 * @param machine - The machine name or a unique prefix of its ID.
	 * @param signal - Cancels the request.
	 * @returns The icons.
	 */
	tray(machine: string, signal?: AbortSignal): Promise<TrayIcon[]> {
		return this.connection.read(Routes.desktop(machine, "tray"), signal);
	}

	/**
	 * Clicks an icon of the notification area: `endia desktop tray click`.
	 *
	 * @param machine - The machine name or a unique prefix of its ID.
	 * @param request - The icon's name and the button.
	 * @param signal - Cancels the request.
	 * @returns The icon and the point clicked.
	 */
	trayClick(machine: string, request: TrayClickRequest, signal?: AbortSignal): Promise<TrayClickResult> {
		return this.send(machine, "tray/click", request, signal);
	}

	/**
	 * Answers an elevation prompt for an expected program: `endia desktop uac`. The request may carry a password, so it is sent
	 * once, without an `Idempotency-Key`, without a retry and without the client's time limit.
	 *
	 * @param machine - The machine name or a unique prefix of its ID.
	 * @param request - The program the prompt must name, and how to answer it.
	 * @param signal - Cancels the request.
	 * @returns The outcome, the prompt as read, and pictures of the screen before and after.
	 */
	answerPrompt(machine: string, request: UacRequest, signal?: AbortSignal): Promise<UacResult> {
		return this.connection.sendOnce({ method: "POST", path: Routes.desktop(machine, "uac"), body: jsonBody(request), signal });
	}

	private send<TAnswer>(machine: string, action: DesktopAction, request: object, signal: AbortSignal | undefined): Promise<TAnswer> {
		return this.connection.change({ method: "POST", path: Routes.desktop(machine, action), body: jsonBody(request), signal });
	}
}

function header(answer: Answer, name: string): string {
	const value = answer.headers[name.toLowerCase()];
	if (typeof value !== "string") {
		throw new Error(`The service's screenshot came without the header ${name}.`);
	}

	return value;
}
