import type { Filters } from "../contract/common.js";

/** A value a query parameter takes: text, a number, or a boolean written `true` or `false`. */
type QueryValue = string | number | boolean;

/**
 * Builds a route's query string as the API reads it. A parameter whose value is undefined is left out, so that the service applies
 * its default; the service refuses a parameter it does not know, so nothing else is ever added.
 */
export class QueryText {
	private readonly parameters = new URLSearchParams();

	/**
	 * Adds one parameter, unless its value is undefined.
	 *
	 * @param name - The parameter's name, as the API spells it.
	 * @param value - The value; undefined leaves the parameter out.
	 * @returns This query.
	 */
	add(name: string, value: QueryValue | undefined): this {
		if (value !== undefined) {
			this.parameters.append(name, String(value));
		}

		return this;
	}

	/**
	 * Adds a boolean parameter only when it is true: false is every route's default for its boolean parameters.
	 *
	 * @param name - The parameter's name.
	 * @param value - The value; false or undefined leaves the parameter out.
	 * @returns This query.
	 */
	addFlag(name: string, value: boolean | undefined): this {
		return value === true ? this.add(name, true) : this;
	}

	/**
	 * Adds a list, which the API reads as the parameter repeated once per value.
	 *
	 * @param name - The parameter's name.
	 * @param values - The values; none leaves the parameter out.
	 * @returns This query.
	 */
	addEach(name: string, values: readonly string[] | undefined): this {
		for (const value of values ?? []) {
			this.add(name, value);
		}

		return this;
	}

	/**
	 * Adds an object the API reads as URL-encoded JSON, such as `filters`, `buildargs` or `labels`.
	 *
	 * @param name - The parameter's name.
	 * @param value - The object; undefined or an object without members leaves the parameter out.
	 * @returns This query.
	 */
	addJson(name: string, value: Filters | Readonly<Record<string, string>> | undefined): this {
		return value === undefined || Object.keys(value).length === 0 ? this : this.add(name, JSON.stringify(value));
	}

	/**
	 * Writes the query.
	 *
	 * @returns The query with its leading `?`, or an empty string when it has no parameter.
	 */
	toString(): string {
		const text = this.parameters.toString();
		return text === "" ? "" : `?${text}`;
	}
}
