import type { Timestamp } from "./common.js";

/** One issued client certificate as `GET /v1/clients` lists it and `DELETE /v1/clients/{name}` answers it: the record in `clients.json`, without any key. */
export interface ClientCertificateSummary {
	/** The certificate's name, its common name. */
	readonly name: string;
	/** `valid`, `expired` or `revoked`. */
	readonly state: string;
	/** The certificate's serial number, in hexadecimal. */
	readonly serialNumber: string;
	/** When the certificate was issued. */
	readonly issued: Timestamp;
	/** When the certificate stops being valid. */
	readonly expires: Timestamp;
	/** When the certificate was revoked, or null. */
	readonly revoked: Timestamp | null;
}

/** The answer of `POST /v1/clients`: the three files a caller over HTTPS holds, as PEM text. The service keeps the certificate's record in `clients.json` and does not keep the private key. */
export interface IssuedClientCertificate {
	/** The certificate's name, its common name. */
	readonly name: string;
	/** When the certificate stops being valid. */
	readonly expires: Timestamp;
	/** `ca.pem`: the authority that signed the service's server certificate. */
	readonly authority: string;
	/** `cert.pem`: the client certificate. */
	readonly certificate: string;
	/** `key.pem`: the client certificate's private key, unencrypted PKCS#8. */
	readonly key: string;
}
