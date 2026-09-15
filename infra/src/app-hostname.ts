import * as cloudflare from '@pulumi/cloudflare';
import * as pulumi from '@pulumi/pulumi';
import { hostnameFor, type AppEnvironmentPair } from './model.ts';
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

/**
 * Owned by the app's own stack, which uploads over them.
 *
 * The runtime fields belong with the contents: which entry module to run, which
 * compatibility date to run it under, and what the code is handed when it runs are
 * properties of the code, and the code is the app's. What stays here is that the
 * Worker exists under a known name, which is all the custom domain needs.
 *
 * `bindings` is here for a sharper reason than the rest. A refresh reads back whatever
 * the app last uploaded, so a binding the app added would show up as something this
 * stack is missing — and this stack would helpfully take it away again, along with the
 * app's contents, since an upload replaces the whole Worker at once.
 */
const REPLACED_BY_THE_APP = [
  'content',
  'contentSha256',
  'mainModule',
  'compatibilityDate',
  'bindings',
];

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

export interface AppHostname {
  /** Where the environment answers. */
  readonly hostname: string;

  /** The Worker that answers there, holding a placeholder until the app deploys over it. */
  readonly script: cloudflare.WorkersScript;
}

/** An app environment's hostname, and the Worker it reaches. */
export const appHostname = (
  pair: AppEnvironmentPair,
  options: pulumi.CustomResourceOptions,
): AppHostname => {
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
    { ...options, ignoreChanges: REPLACED_BY_THE_APP },
  );

  /**
   * The custom domain as the only way in.
   *
   * Access guards hostnames. A Worker also answers at its `workers.dev` address and at a
   * preview address per version, and neither is a hostname Access was told about — a
   * request there would reach the app with nobody signed in. So neither exists.
   */
  new cloudflare.WorkersScriptSubdomain(
    pair.key,
    {
      accountId,
      scriptName: script.scriptName,
      enabled: false,
      previewsEnabled: false,
    },
    options,
  );

  // `service` is taken from the script rather than repeating its name, so the
  // dependency exists. With a bare string Pulumi sees no edge, creates both at once,
  // and Cloudflare rejects a domain for a Worker that does not exist yet.
  new cloudflare.WorkersCustomDomain(
    pair.key,
    {
      accountId,
      hostname,
      service: script.scriptName,
      zoneName: organizationDomain,
    },
    options,
  );

  return { hostname, script };
};
