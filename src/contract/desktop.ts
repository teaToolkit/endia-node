import type { Timestamp, WindowBounds } from "./common.js";
import type { ProcessWindow } from "./processes.js";

/** The body of `POST /v1/machines/{name}/desktop/click`: the element the pointer clicks at its centre. It exists for elements that answer only the mouse, which `invoke` cannot press, without the caller working out a point from the element's bounds. */
export interface ClickRequest {
	/** The ID of the process that owns the element's window. */
	readonly processId: number;
	/** The time the process must have started, or null to take whichever process has the ID. */
	readonly started?: Timestamp | null;
	/** The element selector; its first segment names one of the process's top-level windows. */
	readonly element: string;
	/** The button: `left`, `right` or `middle`. */
	readonly button?: string;
	/** Whether to click twice, as a double-click. */
	readonly doubleClick?: boolean;
}

/** The body of `POST /v1/machines/{name}/desktop/inspect`: the process whose UI tree to read, and optionally one of its windows. */
export interface DesktopInspectRequest {
	/** The process ID. */
	readonly processId: number;
	/** The time the process must have started, or null to take whichever process has the ID. */
	readonly started?: Timestamp | null;
	/** One window's handle as hexadecimal text, or null for every visible top-level window of the process. */
	readonly window?: string | null;
}

/** The body of `POST /v1/machines/{name}/desktop/launch`, which `endia desktop launch` sends: the program to start in the desktop user's session. */
export interface DesktopLaunchRequest {
	/** The program: a full path, or a file name Windows looks for on the desktop user's `PATH`. */
	readonly program: string;
	/** The arguments, each passed to the program as one argument. */
	readonly args?: readonly string[];
	/** The working folder, or null for the folder the guest service chooses. */
	readonly workingDir?: string | null;
	/** Extra environment variables, each `NAME=value`, added to the desktop user's own. */
	readonly env?: readonly string[];
	/** Whether to start the program with the desktop user's linked administrator token. */
	readonly elevated?: boolean;
}

/** The body of `POST /v1/machines/{name}/desktop/wait`: the element to wait for, and whether to wait for it to appear or to go. Without this route a caller would poll `desktop inspect` in a loop of its own. */
export interface DesktopWaitRequest {
	/** The ID of the process that owns the element's window. */
	readonly processId: number;
	/** The time the process must have started, or null to take whichever process has the ID. */
	readonly started?: Timestamp | null;
	/** The element selector; its first segment names one of the process's top-level windows, and a selector of that one segment waits for the window itself. */
	readonly element: string;
	/** Whether to wait until the selector names no element, instead of until it names exactly one. */
	readonly gone?: boolean;
	/** The longest wait in seconds, or null for `desktopActionTimeoutSeconds`. */
	readonly timeoutSeconds?: number | null;
}

/** The body of `POST /v1/machines/{name}/desktop/invoke`: the element whose Invoke pattern to use, such as a button to press. */
export interface InvokeRequest {
	/** The ID of the process that owns the element's window. */
	readonly processId: number;
	/** The time the process must have started, or null to take whichever process has the ID. */
	readonly started?: Timestamp | null;
	/** The element selector, for example `Window[Trainee]/Button[Send diagnostics]`; its first segment names one of the process's top-level windows. */
	readonly element: string;
}

/** The body of `POST /v1/machines/{name}/desktop/keys`: keys to press, or text to type, in the process's main window. Exactly one of `Keys` and `Text` is given. */
export interface KeysRequest {
	/** The ID of the process whose main window receives the input. */
	readonly processId: number;
	/** The time the process must have started, or null to take whichever process has the ID. */
	readonly started?: Timestamp | null;
	/** Chords separated by spaces, such as `ctrl+s` or `alt+f4 enter`; or null when `Text` is given. */
	readonly keys?: string | null;
	/** Text typed literally as Unicode characters; or null when `Keys` is given. */
	readonly text?: string | null;
}

/** The body of `POST /v1/machines/{name}/desktop/pointer`: what the pointer does, and where: in a process's main window, or on the screen when no process is named. */
export interface PointerRequest {
	/** The ID of the process whose main window the pointer acts in, or null to act at a point on the screen. */
	readonly processId?: number | null;
	/** The time the process must have started, or null to take whichever process has the ID. */
	readonly started?: Timestamp | null;
	/** The action: `move`, `click`, `double-click` or `scroll`. */
	readonly action: string;
	/** The distance in physical pixels from the left edge of the window's client area, or of the screen when no process is named. */
	readonly x: number;
	/** The distance in physical pixels from the top edge of the window's client area, or of the screen when no process is named. */
	readonly y: number;
	/** The button a click uses: `left`, `right` or `middle`. */
	readonly button?: string;
	/** The wheel notches a scroll turns; positive scrolls up, negative down. */
	readonly delta?: number;
}

/** The body of `POST /v1/machines/{name}/desktop/screenshot`: the whole desktop, or the largest visible window of one process. */
export interface ScreenshotRequest {
	/** The process whose largest visible top-level window to capture, or null for the whole desktop. */
	readonly processId?: number | null;
}

/** The body of `POST /v1/machines/{name}/desktop/set-value`: the element whose Value pattern to set, the value, and whether the value is a secret. */
export interface SetValueRequest {
	/** The ID of the process that owns the element's window. */
	readonly processId: number;
	/** The time the process must have started, or null to take whichever process has the ID. */
	readonly started?: Timestamp | null;
	/** The element selector; its first segment names one of the process's top-level windows. */
	readonly element: string;
	/** The value to set. */
	readonly value: string;
	/** Whether the value is a secret, such as a password: it may then go into a password field, it is never logged, recorded or printed, and it is not read back. */
	readonly secret?: boolean;
}

/** The body of `POST /v1/machines/{name}/desktop/tray/click`: which notification-area icon the pointer clicks, and how. */
export interface TrayClickRequest {
	/** The start of the icon's name, compared with case; exactly one icon's name must start with it. */
	readonly icon: string;
	/** The button: `left`, `right` or `middle`. */
	readonly button?: string;
	/** Whether to click twice, as a double-click. */
	readonly doubleClick?: boolean;
}

/** The body of `POST /v1/machines/{name}/desktop/uac`, which `endia desktop uac` sends: which program's elevation prompt to wait for, and how to answer it. The password is used for this one action: the service writes it to no log, record or stored reply, which is why this route ignores an `Idempotency-Key`. */
export interface UacRequest {
	/** The file name of the program the prompt must name, for example `diagnostics.exe`, compared without regard to case. */
	readonly expectedProgram: string;
	/** How to answer: `credentials`, `consent` or `cancel`. */
	readonly action: string;
	/** The account to choose for `credentials`; otherwise null. */
	readonly user?: string | null;
	/** The account's password for `credentials`; otherwise null. */
	readonly password?: string | null;
	/** The seconds to wait for the prompt, or null for `desktopActionTimeoutSeconds`. */
	readonly timeoutSeconds?: number | null;
}

/** The answer to `endia desktop inspect`: the UI tree of each window read, as UI Automation's control view shows it. */
export interface DesktopInspectResult {
	/** The windows, the frontmost first. */
	readonly windows: readonly InspectedWindow[];
}

/** The answer to `endia desktop launch`, given once the process exists and without waiting for a window: the real process ID and the facts that name the process safely afterwards. */
export interface DesktopLaunchResult {
	/** The process ID. */
	readonly processId: number;
	/** When the process started; `--started` takes this value. */
	readonly started: Timestamp;
	/** The desktop user's Windows session. */
	readonly sessionId: number;
	/** The account the process runs as. */
	readonly user: string;
	/** The integrity level of the process's token: `low`, `medium`, `high` or `system`. */
	readonly integrityLevel: string;
	/** The windows the process had shown when it was found to exist; usually none yet. */
	readonly windows: readonly ProcessWindow[];
}

/** The answer of `POST /v1/machines/{name}/desktop/wait`: the element the wait found, and the window that holds it, so that the caller can act on the element without reading the tree again. Both are null when the wait was for the element to go. */
export interface DesktopWaitResult {
	/** The handle, in hexadecimal, of the window that holds the element, or null when the element has gone. */
	readonly window: string | null;
	/** The element found, without its children, or null when the element has gone. */
	readonly element: UiElement | null;
}

/** The answer to `endia desktop invoke`. */
export interface InvokeResult {
	/** Whether the element was invoked; always true, because a failure is a refusal. */
	readonly invoked: boolean;
}

/** The answer to `endia desktop keys`. */
export interface KeysResult {
	/** The number of input events sent: a press and a release for each key. */
	readonly sent: number;
}

/** The answer to `endia desktop pointer`: where on the screen the pointer acted, and the window it acted on. */
export interface PointerResult {
	/** The distance in physical pixels from the left edge of the screen. */
	readonly screenX: number;
	/** The distance in physical pixels from the top edge of the screen. */
	readonly screenY: number;
	/** The handle of the top-level window under the point, as hexadecimal text; null when the guest did not report it. */
	readonly window: string | null;
	/** The ID of the process that owns that window; null when the guest did not report it. */
	readonly processId: number | null;
}

/** The answer to `endia desktop set-value`. */
export interface SetValueResult {
	/** The element's value read back after it was set, or null when the element no longer gives one. */
	readonly value: string | null;
}

/** The answer of `POST /v1/machines/{name}/desktop/tray/click`: the full name of the icon clicked, which may carry more than the start the caller gave, and the screen point the pointer clicked. */
export interface TrayClickResult {
	/** The full name of the icon clicked. */
	readonly name: string;
	/** The horizontal screen position clicked, in physical pixels. */
	readonly screenX: number;
	/** The vertical screen position clicked, in physical pixels. */
	readonly screenY: number;
}

/** The answer to `endia desktop uac`: what became of the prompt, what it showed, and the desktop before and after the answer. Whether the program then ran elevated is not reported; the caller checks that through its workload. */
export interface UacResult {
	/** The outcome: `accepted` when the prompt closed after Yes, `credentialsRefused` when it still shows after Yes and is left open, or `cancelled` after No. */
	readonly outcome: string;
	/** What the prompt showed. */
	readonly prompt: UacPromptDetail;
	/** A PNG of the desktop before the answer, base64 encoded. */
	readonly screenshotBefore: string;
	/** A PNG of the desktop, base64 encoded. It is taken after the answer, once the wait that the host's configuration sets in `uacSettleSeconds` has passed. */
	readonly screenshotAfter: string;
}

/** One element of a window's UI tree, with what an element selector matches on (its control type, name and automation ID) and what an action needs to know (whether it is enabled, its value and the patterns it supports). */
export interface UiElement {
	/** UI Automation's control type without `ControlType.`, for example `Button`. */
	readonly controlType: string;
	/** The element's name, or null when it has none. */
	readonly name: string | null;
	/** The element's automation ID, or null when it has none. */
	readonly automationId: string | null;
	/** The element's window class name, or null when it has none. */
	readonly className: string | null;
	/** The element's value, or null when it has no value or is a password field, whose value is never read. */
	readonly value: string | null;
	/** Whether the element accepts input. */
	readonly enabled: boolean;
	/** Whether the element is on screen. */
	readonly visible: boolean;
	/** Whether the element is a password field. */
	readonly isPassword: boolean;
	/** Where the element is, in physical pixels from the top-left corner of its window, or null when it has no size. */
	readonly bounds: WindowBounds | null;
	/** Where the element is, in physical pixels from the top-left corner of the screen, or null when it has no size. A point inside it is where `desktop pointer --screen` acts on the element, if no other window covers it. */
	readonly screenBounds: WindowBounds | null;
	/** The UI Automation patterns the element supports, for example `Invoke` or `Value`. */
	readonly patterns: readonly string[];
	/** The child elements, in document order. */
	readonly children: readonly UiElement[];
}

/** One window and its UI tree. */
export interface InspectedWindow {
	/** The window handle as hexadecimal text. */
	readonly handle: string;
	/** The title bar text; empty when the window has none. */
	readonly title: string;
	/** The window's own element, with its descendants. */
	readonly root: UiElement;
}

/** One visible top-level window on a machine's desktop, as `endia desktop windows` lists it, with the process that owns it. */
export interface DesktopWindow {
	/** The ID of the process that owns the window, which the other desktop commands take. */
	readonly processId: number;
	/** The name of that process's program, without its extension; empty when the desktop helper may not read it. */
	readonly processName: string;
	/** The window handle as hexadecimal text, for example `0x2a0b4c`, which `desktop inspect --window` takes. */
	readonly handle: string;
	/** The title bar text; empty when the window has none. */
	readonly title: string;
	/** The window class name. */
	readonly className: string;
	/** Where the window is, in physical pixels from the top-left corner of the screen. */
	readonly bounds: WindowBounds;
}

/** One icon of the notification area, as `GET /v1/machines/{name}/desktop/tray` lists it. The icon belongs to Windows' taskbar, not to the program that put it there, so the window and element commands, which name a process, cannot reach it. */
export interface TrayIcon {
	/** The name Windows shows for the icon, usually the program's tooltip. */
	readonly name: string;
	/** Whether Windows has moved the icon behind the "Show hidden icons" button. */
	readonly hidden: boolean;
	/** Where the icon is on the screen, in physical pixels from the top-left corner of the primary screen, or null for a hidden icon. */
	readonly screenBounds: WindowBounds | null;
}

/** What an elevation prompt showed. */
export interface UacPromptDetail {
	/** The program the prompt asked to elevate. */
	readonly program: string;
	/** The publisher the prompt showed, or null when it showed none. */
	readonly publisher: string | null;
	/** The accounts the prompt offered; empty on a consent prompt. */
	readonly accounts: readonly string[];
}
