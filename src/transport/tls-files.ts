/** The PEM text of the three files a caller over HTTPS holds. */
export interface TlsFiles {
	/** EastIndia's certificate authority, `ca.pem`: the only authority the client trusts for the server's certificate. */
	readonly ca: string | Buffer;
	/** The client certificate EastIndia issued, `cert.pem`. */
	readonly cert: string | Buffer;
	/** The client certificate's private key, `key.pem`. */
	readonly key: string | Buffer;
}
