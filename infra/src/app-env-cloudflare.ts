import * as cloudflare from '@pulumi/cloudflare';
import type * as pulumi from '@pulumi/pulumi';
import { cloudflareAccountId as accountId } from './config.ts';
import { hostnameFor, type AppEnvironmentPair } from './model.ts';
import { organizationDomain } from './organization.ts';
import { WEBHOOKS_PATH } from './platform-cloudflare.ts';
import type { PlatformResources } from './platform.ts';

/**
 * What an app may do in Cloudflare: replace the contents of a Worker, and nothing else.
 *
 * Cloudflare scopes this permission to an account and offers nothing finer — no
 * per-script grant exists. So an app can in principle overwrite a sibling's code. That
 * is accepted deliberately: the boundary worth holding is the zone, and no app has any
 * zone permission at all, so none can create, move or repoint a hostname.
 *
 * The identifier rather than a lookup: these are Cloudflare-wide constants, and the
 * data source returns no permission groups whether the name filter is URL-encoded or
 * not. Read back from the account's own list, where it is named `Workers Scripts Write`.
 */
const WORKERS_SCRIPTS_WRITE = 'e086da7e2179491d91ee5f35b3ca210a';

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

export interface AppEnvCloudflareResources {
  /** The app's own credential, narrower than the one this stack holds. */
  apiToken: cloudflare.AccountToken;

  /** The Access application for the environment's whole hostname, whose audience its tokens carry. */
  accessApplication: cloudflare.ZeroTrustAccessApplication;
}

/**
 * An app environment's Cloudflare: where it is served, who may reach it, and the credential the
 * app replaces its Worker's contents with.
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
export const provisionAppEnvCloudflareResources = (
  { pair, platform }: { pair: AppEnvironmentPair; platform: PlatformResources },
  options: pulumi.CustomResourceOptions,
): AppEnvCloudflareResources => {
  const hostname = hostnameFor(pair);
  const { identityProvider, organizationMembers, webhookSenders, deploySmokeTest } =
    platform.cloudflare;

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

  /**
   * The webhook path, carved out.
   *
   * A separate application rather than a second policy on the one below: Access picks
   * the most specific application matching a request, and that application's policies
   * alone decide — nothing is inherited from the broader one. Both spellings, because a
   * wildcard in a path does not cover the path it sits under.
   */
  new cloudflare.ZeroTrustAccessApplication(
    `${pair.key}-webhooks`,
    {
      accountId,
      name: `${pair.key} webhooks`,
      type: 'self_hosted',
      destinations: [
        { type: 'public', uri: `${hostname}${WEBHOOKS_PATH}` },
        { type: 'public', uri: `${hostname}${WEBHOOKS_PATH}/*` },
      ],
      policies: [{ id: webhookSenders.id, precedence: 1 }],
    },
    options,
  );

  /**
   * One Access application per app environment, answering for its whole hostname.
   *
   * Each has its own audience, which is what keeps a token issued for staging from being
   * accepted by production: the sign-in is shared, the tokens are not.
   */
  const accessApplication = new cloudflare.ZeroTrustAccessApplication(
    pair.key,
    {
      accountId,
      name: pair.key,
      type: 'self_hosted',
      destinations: [{ type: 'public', uri: hostname }],
      allowedIdps: [identityProvider.id],

      // There is one way to sign in, so there is nothing to choose between.
      autoRedirectToIdentity: true,

      policies: [
        { id: organizationMembers.id, precedence: 1 },
        { id: deploySmokeTest.id, precedence: 2 },
      ],
    },
    options,
  );

  /**
   * The app's own Cloudflare credential, minted here so the app never sees the token
   * this stack holds. One per environment rather than per app, so revoking staging's
   * leaves production alone.
   */
  const apiToken = new cloudflare.AccountToken(
    pair.key,
    {
      accountId,
      name: pair.key,
      policies: [
        {
          effect: 'allow',
          permissionGroups: [{ id: WORKERS_SCRIPTS_WRITE }],
          // Typed as a string despite the schema calling it a json object.
          resources: JSON.stringify({
            [`com.cloudflare.api.account.${accountId}`]: '*',
          }),
        },
      ],
    },
    options,
  );

  return { apiToken, accessApplication };
};
