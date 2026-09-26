/**
 * Cookie that marks a signed-in browser. The proxy only checks that it exists;
 * pages and API routes verify it. Becomes the Cognito token cookie with the login spec.
 */
export const SESSION_COOKIE = "rl_dev_session";
