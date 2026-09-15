import * as cloudflare from '@pulumi/cloudflare';
import { accessIdentityProviderClientSecret, cloudflareAccountId as accountId } from './config.ts';
import {
  accessIdentityProviderClientId,
  accessTeamDomain,
  organizationDomain,
} from './organization.ts';

/**
 * Who may reach an app, decided before a request reaches anything of the app's.
 *
 * Cloudflare Access stands in front of every app hostname and signs people in through the
 * organization's Google Workspace — once for all of them, because a session belongs to the
 * team and not to an app.
 *
 * What an app is handed is what checking a token takes: who issues them, where the keys
 * that sign them are published, and which of them are meant for this app. Not the fact
 * that Cloudflare is the answer. An app's Worker checks those three and knows nothing of
 * the product behind them, so replacing this with another login is a change here and to
 * what apps are handed, and to no app.
 */

/** Whoever signs the tokens an app is handed: the team's own login address. */
export const accessIssuer = `https://${accessTeamDomain}`;

/** Where the keys those tokens are signed with are published. */
export const accessKeysUrl = `${accessIssuer}/cdn-cgi/access/certs`;

/**
 * Where every app's webhooks arrive, and the one part of an app's hostname nobody signs
 * in to.
 *
 * One path for every app, decided here, so that an app being able to receive webhooks is
 * a property of the platform rather than a request made of it.
 */
export const WEBHOOKS_PATH = '/webhooks';

export interface PlatformCloudflareResources {
  /** The one way to sign in to any app. */
  readonly identityProvider: cloudflare.ZeroTrustAccessIdentityProvider;

  /** Admits anyone in the organization. */
  readonly organizationMembers: cloudflare.ZeroTrustAccessPolicy;

  /** Admits anyone at all, unasked — for the webhook path. */
  readonly webhookSenders: cloudflare.ZeroTrustAccessPolicy;

  /** The token the deploy workflow's smoke test presents, and the policy admitting it. */
  readonly smokeTestToken: cloudflare.ZeroTrustAccessServiceToken;
  readonly deploySmokeTest: cloudflare.ZeroTrustAccessPolicy;
}

/** The sign-in every app shares, and the policies an app's Access applications are built from. */
export const provisionPlatformCloudflareResources = (): PlatformCloudflareResources => {
  /**
   * The organization's Google Workspace, as the one way to sign in.
   *
   * Workspace rather than plain Google because it brings group membership along, which a
   * policy naming a group rather than a whole domain will need. It asks two things of the
   * Google side: the Admin SDK enabled on the project holding the OAuth client, and that
   * client trusted as an internal app in the Admin console.
   *
   * The client lives in central and was made in the Cloud console, which has no API for
   * it. Its secret arrives from the environment, like every credential this stack holds.
   */
  const identityProvider = new cloudflare.ZeroTrustAccessIdentityProvider('google-workspace', {
    accountId,
    name: 'Google Workspace',
    type: 'google-apps',
    config: {
      appsDomain: organizationDomain,
      clientId: accessIdentityProviderClientId,
      clientSecret: accessIdentityProviderClientSecret,
    },
  });

  /**
   * Anyone in the organization.
   *
   * The domain rather than a group, because nothing here tells one person from another
   * yet. The identity provider's consent screen is internal, so an address in the domain
   * is an account the organization manages and not one somebody registered under its name.
   */
  const organizationMembers = new cloudflare.ZeroTrustAccessPolicy('organization-members', {
    accountId,
    name: 'Organization members',
    decision: 'allow',
    includes: [{ emailDomain: { domain: organizationDomain } }],
  });

  /**
   * Anyone at all, unasked.
   *
   * For senders that cannot sign in and never will. Access enforces nothing on what this
   * matches and logs none of it, so whatever arrives this way is unauthenticated by
   * construction, and an app checks it by other means — the signature a sender puts on
   * what it sends.
   */
  const webhookSenders = new cloudflare.ZeroTrustAccessPolicy('webhook-senders', {
    accountId,
    name: 'Webhook senders',
    decision: 'bypass',
    includes: [{ everyone: {} }],
  });

  /**
   * What the deploy workflow presents to see an app it has just deployed.
   *
   * A person signs in; a workflow cannot, so it carries a token Access admits without asking who
   * is holding it. That is also the whole of what it gets: it names nobody, so a Worker checking
   * who signed in refuses it anything but the page and its files — which is exactly what a check
   * that an app answers needs to see.
   *
   * Never expiring, deliberately. It unlocks the one thing about an app nobody would call secret,
   * and a token that lapses is a deploy that fails a year from now for a reason nobody remembers.
   * Rotating it is `clientSecretVersion`, when there is a reason to.
   */
  const smokeTestToken = new cloudflare.ZeroTrustAccessServiceToken('deploy-smoke-test', {
    accountId,
    name: 'Deploy smoke test',
    duration: 'forever',
  });

  /** The deploy workflow's token, admitted without an identity — as a service, not a person. */
  const deploySmokeTest = new cloudflare.ZeroTrustAccessPolicy('deploy-smoke-test', {
    accountId,
    name: 'Deploy smoke test',
    decision: 'non_identity',
    includes: [{ serviceToken: { tokenId: smokeTestToken.id } }],
  });

  return {
    identityProvider,
    organizationMembers,
    webhookSenders,
    smokeTestToken,
    deploySmokeTest,
  };
};
