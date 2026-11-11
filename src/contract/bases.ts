/** The JSON body of `POST /v1/bases/import`, which `endia import` sends. The import makes a Windows disk that is already on the host into an image with no parent. The request names the disk, the reference the image will carry, whether to move or copy the disk into the image folder, and the recipe instructions that set the image's configuration, as `docker import --change` does. */
export interface BaseImportRequest {
	/** The full path of the disk on the host, for example `M:/eastindia/win11-desktop.vhdx`. */
	readonly path: string;
	/** The name and optional tag that the image will carry, for example `lab/windows-desktop:approved`; without a tag, `latest`. */
	readonly reference: string;
	/** Whether to move the disk into the image folder; when false, the disk is copied there. */
	readonly move?: boolean;
	/** The recipe instructions applied to the image's configuration, in order, each one line such as `ENV LANG=en-GB`. Only `LABEL`, `ENV`, `WORKDIR`, `CMD`, `ENTRYPOINT` and `EXPOSE` are accepted. */
	readonly changes?: readonly string[];
}

/** The JSON body of `POST /v1/bases/prepare`, which `endia base prepare` sends: install Windows from an installation disc on the host, with EastIndia's guest programs and SSH, and import the result as a base. The password reaches only the answer file inside the new Windows and the service's memory; the service writes it nowhere else. */
export interface BasePrepareRequest {
	/** The full path on the host of the Windows installation disc, an ISO file, for example `M:/eastindia/windows11.iso`. */
	readonly iso: string;
	/** The tag that the base will carry, for example `lab/windows-desktop:approved`. */
	readonly tag: string;
	/** The number of the Windows edition on the disc, counted from 1 as Windows Setup counts them. */
	readonly imageIndex?: number;
	/** The standard account that Windows signs in automatically at every start. */
	readonly desktopUser?: string;
	/** The administrator account whose name and password answer an elevation prompt. */
	readonly adminUser?: string;
	/** The password of both accounts. */
	readonly password: string;
}

/** The result of a finished import: the digest and reference of the new image, the path of its disk, how the disk came into the image folder, and what the import check found when the import started a virtual machine from the disk. */
export interface BaseImportResult {
	/** The image's digest, which is the SHA-256 of its disk; `endia import` prints it. */
	readonly digest: string;
	/** The reference that names the image, in the form `name:tag`. */
	readonly reference: string;
	/** The full path of the disk in the image folder. */
	readonly diskPath: string;
	/** How the disk came into the image folder: `inPlace` when it was already there and is used where it is, `copied` when a copy was made and the original left where it was, or `moved` when the original was renamed into the folder, or copied and then deleted. */
	readonly broughtIn: string;
	/** The checks of the import check, in the order they ran. A finished import passed every one. */
	readonly checks: readonly BaseCheckReport[];
}

/** The outcome of one check that an import makes on a virtual machine it starts from the imported disk. Together these checks are the import check. */
export interface BaseCheckReport {
	/** The fixed name of the check: `guest-service`, `fast-startup`, `desktop`, `ssh`, `evaluation` or `shutdown`. */
	readonly name: string;
	/** Whether the check passed. */
	readonly passed: boolean;
	/** What the check saw, as text, such as the banner that the SSH server sent. */
	readonly detail: string;
}
