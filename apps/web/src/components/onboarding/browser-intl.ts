"use client";

import { COUNTRY_CODES } from "@redlance/core";
import { useSyncExternalStore } from "react";

// Client-only values (null during SSR): the server's ICU data can differ from the browser's,
// which would otherwise cause hydration mismatches.
let zones: readonly string[] | undefined;
const noopSubscribe = () => () => {};
const getZones = () => (zones ??= Intl.supportedValuesOf("timeZone"));
const getZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const none = () => null;

export const useBrowserTimeZones = () => useSyncExternalStore(noopSubscribe, getZones, none);
export const useBrowserTimeZone = () => useSyncExternalStore(noopSubscribe, getZone, none);

export type CountryOption = { code: string; name: string };

/** Sorted country list built once from the browser's own ICU data. */
export function buildCountryOptions(
  codes: readonly string[],
  names: { of(code: string): string | undefined },
): CountryOption[] {
  return codes
    .map((code) => ({ code, name: names.of(code) ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
}

let countries: CountryOption[] | undefined;
const getCountries = () =>
  (countries ??= buildCountryOptions(COUNTRY_CODES, new Intl.DisplayNames(["en"], { type: "region" })));

export const useCountryOptions = () => useSyncExternalStore(noopSubscribe, getCountries, none);
