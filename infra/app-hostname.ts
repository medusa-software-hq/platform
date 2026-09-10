import * as cloudflare from '@pulumi/cloudflare';
import * as pulumi from '@pulumi/pulumi';
import { byAppEnvironment, type AppEnvironmentPair } from './model.ts';
import { organizationDomain } from './organization.ts';

/**
 * Where each app environment is served, and what answers there until the app does.
 *
 * The split is the same one the repository has: this stack decides that a hostname
 * exists and which Worker it reaches; the app decides what that Worker returns. Script
 * contents are ignored here for exactly that reason — the app replaces them on every
 * deploy, and two owners of one value would undo each other in turn.
 *
 * A custom domain rather than a route, because the Worker is the origin. Cloudflare
 * creates the DNS record and the certificate itself, so nothing here invents a record
 * pointing at an address that does not exist. The app never needs zone permissions at
 * all: it only replaces script contents, and that is an account-level operation.
 */

const config = new pulumi.Config();
const accountId = config.require('cloudflareAccountId');

/** Production is served bare; every other environment is suffixed with its own name. */
export const hostnameFor = ({ app, environment }: AppEnvironmentPair): string =>
  `${environment === 'production' ? app : `${app}-${environment}`}.${organizationDomain}`;

/** Owned by the app's own stack, which uploads over it. */
const REPLACED_BY_THE_APP = ['content', 'contentSha256'];

/**
 * Answers before the app has ever deployed. Deliberately not a 200: the hostname
 * resolving is worth proving, and pretending an app is there is not.
 */
const placeholder = (hostname: string): string =>
  `export default {
  fetch() {
    return new Response(${JSON.stringify(`${hostname} is provisioned. Nothing is deployed here yet.\n`)}, {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  },
};
`;

export const appScripts = byAppEnvironment((pair) => {
  const hostname = hostnameFor(pair);

  const script = new cloudflare.WorkersScript(
    pair.key,
    {
      accountId,
      scriptName: pair.key,
      mainModule: 'index.js',
      compatibilityDate: '2026-09-01',
      content: placeholder(hostname),
    },
    { ignoreChanges: REPLACED_BY_THE_APP },
  );

  // `service` is taken from the script rather than repeating its name, so the
  // dependency exists. With a bare string Pulumi sees no edge, creates both at once,
  // and Cloudflare rejects a domain for a Worker that does not exist yet.
  new cloudflare.WorkersCustomDomain(pair.key, {
    accountId,
    hostname,
    service: script.scriptName,
    zoneName: organizationDomain,
  });

  return script;
});

/** Where each app environment answers, for the app repositories to be told. */
export const appHostnames = byAppEnvironment(hostnameFor);
