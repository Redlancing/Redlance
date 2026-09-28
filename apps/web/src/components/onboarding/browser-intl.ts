"use client";

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
